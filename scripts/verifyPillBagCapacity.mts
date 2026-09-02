#!/usr/bin/env node
/**
 * The bag capacities belong to the currently loaded game account. Read all four
 * denominators from the live stored-pill summary, never from fixture defaults,
 * inventory cells, modal counts, or the monthly-use summary.
 *
 * Run: npx tsx scripts/verifyPillBagCapacity.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { pillBagCapacityProbe } from "../src/lib/quest-engine/boardScripts.mjs";
import { observePillBagCapacity } from "../src/lib/quest-engine/runCycle.mjs";

type Tier = "ha" | "trung" | "thuong" | "cuc";
type Capacities = Record<Tier, number>;
type BagRow = { tier: Tier; label: string; nums: string };

const TIERS: Tier[] = ["ha", "trung", "thuong", "cuc"];
const LABELS: Record<Tier, string> = {
  ha: "Hạ Phẩm",
  trung: "Trung Phẩm",
  thuong: "Thượng Phẩm",
  cuc: "Cực Phẩm",
};
const ACCOUNT_A: Capacities = { ha: 10, trung: 6, thuong: 4, cuc: 2 };
const ACCOUNT_B: Capacities = { ha: 29, trung: 17, thuong: 11, cuc: 7 };

const rowsFor = (capacities: Capacities): BagRow[] =>
  TIERS.map((tier, index) => ({ tier, label: LABELS[tier], nums: `${index}/${capacities[tier]}` }));

// Keep the production DOM structure used by verifyLuyenDanStars.mts. Text values
// deliberately vary independently from the defaults seen in recorded accounts.
const rowHtml = ({ label, nums }: BagRow): string => `
  <li class="ld-bag-usage__row ld-bag-usage__row--stored">
    <span class="ld-bag-usage__name">${label}</span>
    <span class="ld-bag-usage__bar"></span>
    <span class="ld-bag-usage__nums">${nums}</span>
  </li>`;

const summaryHtml = (rows: BagRow[]): string => `
  <section class="ld-bag-usage ld-bag-usage--stored">
    <h3 class="ld-bag-usage__title">Đan trong túi</h3>
    <ul class="ld-bag-usage__list">${rows.map(rowHtml).join("")}</ul>
  </section>`;

const bagHtml = (rows: BagRow[]): string => `
  <div id="ldBagPillStats" class="ld-bag-pill-stats">${summaryHtml(rows)}</div>`;

const documentHtml = (body: string): string => `<!doctype html>
  <html lang="vi"><head><meta charset="utf-8"></head><body>${body}</body></html>`;

let passed = 0;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const expectProbe = async (name: string, html: string, expected: Capacities | null): Promise<void> => {
    await page.setContent(documentHtml(html));
    assert.deepEqual(await page.evaluate(pillBagCapacityProbe), expected, name);
    console.log(`✓ ${name}`);
    passed += 1;
  };

  await expectProbe("account A: read every tier's denominator", bagHtml(rowsFor(ACCOUNT_A)), ACCOUNT_A);
  await expectProbe("account B: same page does not retain account A's capacities", bagHtml(rowsFor(ACCOUNT_B)), ACCOUNT_B);
  await expectProbe("missing next account: do not retain previous account or invent defaults", "<p>Đang tải túi</p>", null);
  await expectProbe("account A can be read again after an unavailable account", bagHtml(rowsFor(ACCOUNT_A)), ACCOUNT_A);

  await expectProbe("row order does not assign capacities to the wrong tier", bagHtml(rowsFor(ACCOUNT_B).reverse()), ACCOUNT_B);
  await expectProbe(
    "normalize decomposed Vietnamese, whitespace, and case in labels",
    bagHtml(rowsFor(ACCOUNT_B).map((row) => ({
      ...row,
      label: ` \n ${row.label.toLocaleUpperCase("vi").normalize("NFD").replace(" ", "\n\t")} \t `,
    }))),
    ACCOUNT_B,
  );
  await expectProbe(
    "take the denominator, even when the numerator exceeds it",
    bagHtml(rowsFor(ACCOUNT_B).map((row, index) => ({ ...row, nums: `${900 + index} / ${ACCOUNT_B[row.tier]}` }))),
    ACCOUNT_B,
  );
  await expectProbe(
    "optional displayed unit does not affect capacity",
    bagHtml(rowsFor(ACCOUNT_B).map((row) => ({ ...row, nums: `${row.nums} viên` }))),
    ACCOUNT_B,
  );
  await expectProbe(
    "zero capacity is an observed value, not a missing value",
    bagHtml(rowsFor({ ha: 0, trung: 0, thuong: 0, cuc: 0 }).map((row) => ({ ...row, nums: "0/0" }))),
    { ha: 0, trung: 0, thuong: 0, cuc: 0 },
  );
  await expectProbe(
    "capacity upper bound is valid",
    bagHtml(rowsFor({ ha: Number.MAX_SAFE_INTEGER, trung: Number.MAX_SAFE_INTEGER, thuong: Number.MAX_SAFE_INTEGER, cuc: Number.MAX_SAFE_INTEGER })),
    { ha: Number.MAX_SAFE_INTEGER, trung: Number.MAX_SAFE_INTEGER, thuong: Number.MAX_SAFE_INTEGER, cuc: Number.MAX_SAFE_INTEGER },
  );

  const decoys = `
    <div id="ldInventory">
      <div class="ld-cell ld-cell--pill ld-tier-ha" data-tier="ha" title="Hạ Phẩm Đan Dược · túi 98/99"><span class="ld-qty">98</span></div>
    </div>
    <div id="ldModalBody"><dl><dt>Đan trong túi (phẩm)</dt><dd>97/99 viên</dd></dl></div>
    <div class="ld-bag-usage ld-bag-usage--stored"><ul>${rowsFor({ ha: 101, trung: 102, thuong: 103, cuc: 104 }).map(rowHtml).join("")}</ul></div>`;
  const monthly = `<section class="ld-bag-usage ld-bag-usage--monthly">
    <h3>Đã sử dụng tháng này</h3><ul>${rowsFor({ ha: 201, trung: 202, thuong: 203, cuc: 204 }).map(rowHtml).join("")}</ul>
  </section>`;
  await expectProbe(
    "ignore inventory, modal, other containers, and monthly-use limits",
    `${decoys}<div id="ldBagPillStats">${monthly}${summaryHtml(rowsFor(ACCOUNT_B))}</div>`,
    ACCOUNT_B,
  );
  await expectProbe("decoys are not a fallback when the bag summary is absent", `${decoys}${monthly}`, null);
  await expectProbe("monthly-only bag summary is not storage capacity", `<div id="ldBagPillStats">${monthly}</div>`, null);

  for (const tier of TIERS) {
    await expectProbe(`missing ${tier} row rejects the incomplete snapshot`, bagHtml(rowsFor(ACCOUNT_B).filter((row) => row.tier !== tier)), null);
    const repeated = rowsFor(ACCOUNT_B).find((row) => row.tier === tier)!;
    await expectProbe(`duplicate ${tier} row rejects the ambiguous snapshot`, bagHtml([...rowsFor(ACCOUNT_B), repeated]), null);
  }

  await expectProbe(
    "unknown label cannot replace one of the four required tiers",
    bagHtml(rowsFor(ACCOUNT_B).map((row) => row.tier === "cuc" ? { ...row, label: "Đan chưa rõ phẩm" } : row)),
    null,
  );
  await expectProbe(
    "duplicate tier labels are rejected even if the table still has four rows",
    bagHtml(rowsFor(ACCOUNT_B).map((row) => row.tier === "cuc" ? { ...row, label: LABELS.ha } : row)),
    null,
  );
  await expectProbe(
    "missing numeric element does not fall back to unrelated row text",
    bagHtml(rowsFor(ACCOUNT_B)).replace('<span class="ld-bag-usage__nums">0/29</span>', '<span class="other">0/29</span>'),
    null,
  );

  for (const nums of ["", "?", "1", "1/", "/29", "1/no-limit", "1/-29", "1/2.9", "-1/29", "1.5/29", "1/9007199254740992", "1/9007199254740993", "1/Infinity", "1/NaN", "1/2/29"]) {
    await expectProbe(
      `malformed capacity ${JSON.stringify(nums)} rejects the entire snapshot`,
      bagHtml(rowsFor(ACCOUNT_B).map((row) => row.tier === "ha" ? { ...row, nums } : row)),
      null,
    );
  }

  // The game updates the summary in-place after a bag upgrade or account refresh.
  await page.setContent(documentHtml(bagHtml(rowsFor(ACCOUNT_A))));
  await page.locator("#ldBagPillStats").evaluate((element, html) => { element.innerHTML = html; }, summaryHtml(rowsFor(ACCOUNT_B)));
  assert.deepEqual(await page.evaluate(pillBagCapacityProbe), ACCOUNT_B, "fresh evaluation reads updated DOM capacities");
  console.log("✓ fresh evaluation reads updated DOM capacities");
  passed += 1;
} finally {
  await browser.close();
}

const checkObservation = async (name: string, check: () => Promise<void>): Promise<void> => {
  await check();
  console.log(`✓ ${name}`);
  passed += 1;
};

for (const questId of ["luyen-dan-duong", "luyen-dan-duong-thuong"]) {
  await checkObservation(`${questId}: report the current account's own capacity snapshot`, async () => {
    const reports: Capacities[] = [];
    let evaluations = 0;
    const session = {
      evaluate: async (probe: unknown) => {
        assert.equal(probe, pillBagCapacityProbe, "use the real browser probe");
        evaluations += 1;
        return ACCOUNT_B;
      },
    };
    const observed = await observePillBagCapacity(session, questId, async (caps: Capacities) => { reports.push(caps); });
    assert.equal(observed, true);
    assert.equal(evaluations, 1);
    assert.deepEqual(reports, [ACCOUNT_B]);
  });
}

await checkObservation("unrelated quests do not probe or report pill storage", async () => {
  let evaluations = 0;
  let reports = 0;
  const observed = await observePillBagCapacity(
    { evaluate: async () => { evaluations += 1; return ACCOUNT_A; } },
    "me-cung",
    async () => { reports += 1; },
  );
  assert.equal(observed, false);
  assert.equal(evaluations, 0);
  assert.equal(reports, 0);
});

await checkObservation("a missing snapshot does not send a fallback report", async () => {
  let reports = 0;
  const observed = await observePillBagCapacity(
    { evaluate: async () => null },
    "luyen-dan-duong",
    async () => { reports += 1; },
  );
  assert.equal(observed, false);
  assert.equal(reports, 0);
});

await checkObservation("a failed probe cannot fail the quest or submit defaults", async () => {
  let reports = 0;
  const observed = await observePillBagCapacity(
    { evaluate: async () => { throw new Error("page closed"); } },
    "luyen-dan-duong",
    async () => { reports += 1; },
  );
  assert.equal(observed, false);
  assert.equal(reports, 0);
});

await checkObservation("an asynchronous reporting failure cannot fail the quest", async () => {
  const observed = await observePillBagCapacity(
    { evaluate: async () => ACCOUNT_B },
    "luyen-dan-duong",
    async () => { throw new Error("report endpoint unavailable"); },
  );
  assert.equal(observed, false);
});

await checkObservation("sequential account reports do not reuse the previous snapshot", async () => {
  const reportsA: Capacities[] = [];
  const reportsB: Capacities[] = [];
  const session = { evaluate: async () => ACCOUNT_A };
  await observePillBagCapacity(session, "luyen-dan-duong", async (caps: Capacities) => { reportsA.push(caps); });
  session.evaluate = async () => ACCOUNT_B;
  await observePillBagCapacity(session, "luyen-dan-duong-thuong", async (caps: Capacities) => { reportsB.push(caps); });
  assert.deepEqual(reportsA, [ACCOUNT_A]);
  assert.deepEqual(reportsB, [ACCOUNT_B]);
});

await checkObservation("runCycle forwards live capacities to its injected report callback", async () => {
  const source = readFileSync(new URL("../src/lib/quest-engine/runCycle.mjs", import.meta.url), "utf8");
  assert.match(source, /await\s+observePillBagCapacity\(session,\s*quest\.id,\s*reportPillBagCaps\)/);
});

await checkObservation("worker capacity report is bound to the current job", async () => {
  const source = readFileSync(new URL("./worker.mjs", import.meta.url), "utf8");
  assert.match(source, /reportPillBagCaps:\s*\(caps\)\s*=>\s*call\("pillBagCaps",\s*\{\s*jobId:\s*job\.id,\s*caps\s*\}\)/);
});

console.log(`\n${passed} pill bag capacity checks passed.`);
