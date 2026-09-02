#!/usr/bin/env node
/** Offline rendering checks: npx tsx scripts/verifyPillBagCapacityUi.mts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PillBagCapacitySummary } from "../src/app/dashboard/PillBagCapacitySummary";
import type { AccountTier, DashboardAccount } from "../src/lib/realtime/dashboardTypes";

const observedAt = "2026-09-02T02:00:00.000Z";
const account = (overrides: Partial<DashboardAccount>): DashboardAccount => ({
  id: "vip-a",
  label: "VIP A",
  accountTier: "vip",
  enabled: true,
  pillBagCaps: { ha: 13, trung: 7, thuong: 5, cuc: 3 },
  pillBagCapsObservedAt: observedAt,
  ...overrides,
});
const render = (accounts: DashboardAccount[], accountTier: AccountTier = "vip") =>
  renderToStaticMarkup(createElement(PillBagCapacitySummary, { accounts, accountTier }));
const asText = (html: string) => html.replace(/<[^>]+>/g, "");

let checks = 0;
function check(label: string, test: () => void) {
  test();
  checks += 1;
  console.log(`✓ ${label}`);
}

const vipA = account({});
const vipB = account({
  id: "vip-b",
  label: "VIP B",
  pillBagCaps: { ha: 20, trung: 11, thuong: 8, cuc: 4 },
});
const free = account({
  id: "free-a",
  label: "Thường A",
  accountTier: "free",
  pillBagCaps: { ha: 5, trung: 3, thuong: 2, cuc: 1 },
});
const unknownTier = account({ id: "unknown", label: "Chưa rõ hạng", accountTier: null });
const mixed = [vipA, free, vipB, unknownTier];

check("different capacities remain associated with each account", () => {
  const html = render(mixed);
  const rows = [...html.matchAll(/<li\b[^>]*>(.*?)<\/li>/g)].map((match) => asText(match[1]));
  assert.equal(rows.length, 2);
  assert.match(rows[0], /VIP A: Hạ 13 · Trung 7 · Thượng 5 · Cực 3/);
  assert.match(rows[1], /VIP B: Hạ 20 · Trung 11 · Thượng 8 · Cực 4/);
  assert.doesNotMatch(html, /Thường A|Chưa rõ hạng/);
});

check("free tab only lists free accounts, without guessing unknown tiers", () => {
  const text = asText(render(mixed, "free"));
  assert.match(text, /Thường A: Hạ 5 · Trung 3 · Thượng 2 · Cực 1/);
  assert.doesNotMatch(text, /VIP A|VIP B|Chưa rõ hạng/);
});

check("empty groups distinguish missing accounts from missing observations", () => {
  for (const [tier, label] of [["vip", "VIP"], ["free", "Thường"]] as const) {
    const html = render([unknownTier], tier);
    assert.ok(asText(html).includes(`Chưa có tài khoản được xác định là hạng ${label}.`));
    assert.doesNotMatch(html, /<li\b|Chưa dò sức chứa|Hạ 10/);
  }
});

check("unknown capacities never fall back to shared hard-coded limits", () => {
  const html = render([account({ pillBagCaps: null, pillBagCapsObservedAt: null })]);
  assert.match(asText(html), /VIP A: Chưa dò sức chứa\./);
  assert.doesNotMatch(html, /<time\b|Hạ \d|Trung \d|Thượng \d|Cực \d/);
  assert.match(asText(html), /Tự cập nhật sau mỗi lượt Luyện Đan/);
});

check("old payloads with missing observation fields remain safe", () => {
  const { pillBagCaps: _caps, pillBagCapsObservedAt: _at, ...legacy } = vipA;
  const html = render([legacy as DashboardAccount]);
  assert.match(asText(html), /Chưa dò sức chứa\./);
  assert.doesNotMatch(html, /undefined|Invalid Date|<time\b/);
});

check("zero is a real capacity, not a missing value", () => {
  const html = render([account({ pillBagCaps: { ha: 0, trung: 0, thuong: 0, cuc: 0 } })]);
  assert.match(asText(html), /Hạ 0 · Trung 0 · Thượng 0 · Cực 0/);
  assert.doesNotMatch(html, /Chưa dò sức chứa/);
});

check("valid timestamps use a stable Vietnam timezone", () => {
  const html = render([vipA]);
  assert.ok(html.includes(`<time dateTime="${observedAt}">`));
  assert.match(asText(html), /Dò gần nhất:.*09:00/);
});

check("cached and undated observations are clearly not promised as live data", () => {
  const old = render([account({ pillBagCapsObservedAt: "2025-01-01T00:00:00.000Z" })]);
  assert.match(asText(old), /Hạ 13 · Trung 7 · Thượng 5 · Cực 3/);
  assert.match(asText(old), /Dò gần nhất:/);
  assert.match(asText(old), /Số đã dò có thể đã cũ nếu túi vừa được nâng/);
  for (const timestamp of [null, "not-a-date"]) {
    const html = render([account({ pillBagCapsObservedAt: timestamp })]);
    assert.match(asText(html), /Chưa có thời điểm dò\./);
    assert.match(asText(html), /Hạ 13 · Trung 7 · Thượng 5 · Cực 3/);
    assert.doesNotMatch(html, /<time\b|Invalid Date/);
  }
});

check("new snapshots update displayed values without changing form controls", () => {
  const before = render([vipA]);
  const after = render([account({ pillBagCaps: { ha: 18, trung: 9, thuong: 6, cuc: 4 } })]);
  assert.notEqual(before, after);
  assert.match(asText(after), /Hạ 18 · Trung 9 · Thượng 6 · Cực 4/);
  assert.doesNotMatch(after, /Hạ 13|<(?:input|select|textarea)\b/);
  const escaped = render([account({ label: "<script>bad</script>" })]);
  assert.doesNotMatch(escaped, /<script>/);
  assert.match(escaped, /&lt;script&gt;bad&lt;\/script&gt;/);
});

check("both fieldsets use live accounts and the correct group mapping", () => {
  const source = readFileSync(new URL("../src/app/dashboard/ConfigForm.tsx", import.meta.url), "utf8");
  assert.match(source, /const\s+\{\s*accounts\s*\}\s*=\s*useDashboardAccountLive\(\)/);
  assert.match(source, /<PillBagCapacitySummary\s+accounts=\{accounts\}\s+accountTier=\{prefix === "luyenDan" \? "vip" : "free"\}/);
  const fieldsets = [...source.matchAll(/<LuyenDanFieldset\b([\s\S]*?)\/>/g)];
  assert.equal(fieldsets.length, 2);
  for (const fieldset of fieldsets) assert.match(fieldset[1], /\baccounts=\{accounts\}/);
  assert.doesNotMatch(source, /sức chứa hiện tại: Hạ 10/);
});

console.log(`\n${checks} pill bag capacity UI checks passed.`);
