/**
 * Source bundle for the two ordinary repositories created beside a GitHub worker repository.
 *
 * These are intentionally real, buildable web applications rather than a README plus filler.
 * Every generated project has a typed domain model, validation, persistence, planning analytics,
 * import/export, a responsive UI, and unit tests. The subject is selected from unrelated parts of
 * everyday life so repositories created by different runs do not all tell the same story.
 *
 * Keep this file as `.mjs`: `newGithubKhoiloi.mjs` is executed by plain Node.
 */
import { createHash } from "node:crypto";

export const COMPANION_REPO_COUNT = 2;
export const REVISION_LEDGER_PATH = "src/generated/revision-ledger.ts";

export const LIFE_PROJECT_THEMES = Object.freeze([
  {
    id: "pantry",
    product: "Pantry Compass",
    tagline: "Plan pantry turnover before good food becomes waste.",
    itemLabel: "Pantry item",
    dateLabel: "Use-by date",
    effortLabel: "Minutes",
    impactLabel: "Waste risk",
    categories: ["Produce", "Dry goods", "Dairy", "Frozen", "Prepared"],
    seeds: [
      ["Spinach", "Produce", 20, 5],
      ["Brown rice", "Dry goods", 30, 2],
      ["Vegetable soup", "Prepared", 45, 4],
    ],
  },
  {
    id: "garden",
    product: "Garden Rhythm",
    tagline: "Coordinate seasonal care without losing the small recurring jobs.",
    itemLabel: "Garden task",
    dateLabel: "Next care date",
    effortLabel: "Minutes",
    impactLabel: "Plant impact",
    categories: ["Watering", "Pruning", "Feeding", "Harvest", "Soil"],
    seeds: [
      ["Water herb boxes", "Watering", 15, 4],
      ["Turn compost", "Soil", 25, 3],
      ["Harvest tomatoes", "Harvest", 20, 5],
    ],
  },
  {
    id: "study",
    product: "Study Current",
    tagline: "Turn a learning backlog into balanced, reviewable study sessions.",
    itemLabel: "Study session",
    dateLabel: "Target date",
    effortLabel: "Minutes",
    impactLabel: "Learning value",
    categories: ["Read", "Practice", "Review", "Project", "Discussion"],
    seeds: [
      ["Review chapter notes", "Review", 30, 4],
      ["Build a small prototype", "Project", 75, 5],
      ["Practice recall cards", "Practice", 20, 3],
    ],
  },
  {
    id: "pets",
    product: "Pet Care Atlas",
    tagline: "Keep routine care, supplies, and appointments visible in one calm view.",
    itemLabel: "Care item",
    dateLabel: "Due date",
    effortLabel: "Minutes",
    impactLabel: "Care priority",
    categories: ["Health", "Grooming", "Exercise", "Supplies", "Training"],
    seeds: [
      ["Restock dry food", "Supplies", 20, 5],
      ["Brush coat", "Grooming", 15, 3],
      ["Practice recall cue", "Training", 20, 4],
    ],
  },
  {
    id: "home",
    product: "Home Steward",
    tagline: "Schedule preventative household care before repairs become emergencies.",
    itemLabel: "Maintenance job",
    dateLabel: "Service date",
    effortLabel: "Minutes",
    impactLabel: "Failure impact",
    categories: ["Safety", "Appliances", "Cleaning", "Utilities", "Exterior"],
    seeds: [
      ["Test smoke alarms", "Safety", 20, 5],
      ["Clean refrigerator coils", "Appliances", 35, 4],
      ["Inspect window seals", "Exterior", 45, 3],
    ],
  },
  {
    id: "community",
    product: "Neighborly Board",
    tagline: "Balance community commitments by urgency, effort, and local value.",
    itemLabel: "Volunteer activity",
    dateLabel: "Event date",
    effortLabel: "Minutes",
    impactLabel: "Community value",
    categories: ["Food", "Education", "Environment", "Outreach", "Logistics"],
    seeds: [
      ["Sort pantry donations", "Food", 60, 5],
      ["Prepare reading materials", "Education", 45, 4],
      ["Map cleanup supplies", "Environment", 30, 3],
    ],
  },
  {
    id: "travel",
    product: "Departure Canvas",
    tagline: "Organize trip preparation with dependency-aware priorities.",
    itemLabel: "Trip task",
    dateLabel: "Complete by",
    effortLabel: "Minutes",
    impactLabel: "Trip impact",
    categories: ["Documents", "Packing", "Transport", "Lodging", "Health"],
    seeds: [
      ["Verify travel documents", "Documents", 20, 5],
      ["Build a capsule packing list", "Packing", 35, 3],
      ["Confirm airport transfer", "Transport", 15, 4],
    ],
  },
  {
    id: "recovery",
    product: "Recovery Margin",
    tagline: "Plan low-friction recovery habits around energy and consistency.",
    itemLabel: "Recovery practice",
    dateLabel: "Planned date",
    effortLabel: "Minutes",
    impactLabel: "Expected benefit",
    categories: ["Mobility", "Sleep", "Nutrition", "Reflection", "Outdoors"],
    seeds: [
      ["Evening mobility set", "Mobility", 15, 4],
      ["Prepare tomorrow's breakfast", "Nutrition", 20, 3],
      ["Take a quiet outdoor walk", "Outdoors", 30, 5],
    ],
  },
]);

function asSource(value) {
  return Buffer.from(value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

function assertSafeRepoName(repoName) {
  if (typeof repoName !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/i.test(repoName)) {
    throw new Error(`Invalid companion repository name: ${JSON.stringify(repoName)}`);
  }
}

function themeSource(theme) {
  return `import type { ThemeConfig } from "./types";

export const theme = ${JSON.stringify(theme, null, 2)} as const satisfies ThemeConfig;
`;
}

function ledgerSource(now) {
  const iso = now.toISOString();
  return `/** Updated by the repository maintenance scheduler. */
export type RevisionLedger = Readonly<{
  day: string;
  ordinal: number;
  revision: string;
  generatedAt: string;
  signals: Readonly<{ confidence: number; coverage: number; entropy: number }>;
}>;

export const revisionLedger: RevisionLedger = {
  day: "",
  ordinal: 0,
  revision: "bootstrap",
  generatedAt: "${iso}",
  signals: { confidence: 0, coverage: 0, entropy: 0 },
};
`;
}

function readmeSource(repoName, theme) {
  return `# ${theme.product}

${theme.tagline}

This repository contains a complete, local-first TypeScript web application. It is generated as
an independent project, and its neutral repository name is **${repoName}**.

## What it does

- Captures and validates ${theme.itemLabel.toLowerCase()} records.
- Computes an explainable priority score from urgency, impact, effort, and status.
- Builds a seven-day plan with workload and category summaries.
- Persists data in browser storage with a versioned envelope and safe recovery.
- Imports strictly runtime-validated JSON, produces JSON/CSV exports, and includes deterministic tests.
- Displays the repository revision ledger used by scheduled maintenance commits.

## Run locally

\`\`\`bash
npm install
npm run dev
\`\`\`

Use \`npm run build\` for a production build and \`npm test\` for the planning-engine tests.

## Architecture

- \`src/core/planner.ts\` contains pure validation, scoring, forecasting, and aggregation logic.
- \`src/core/store.ts\` provides versioned local persistence and subscriber notifications.
- \`src/core/exchange.ts\` owns JSON/CSV interchange without coupling it to the interface.
- \`src/main.ts\` renders the application and coordinates user interactions.
- \`${REVISION_LEDGER_PATH}\` is imported by the application and records maintenance revisions.

The application keeps all personal data in the current browser. It does not send records to a
remote service.
`;
}

const TYPES_SOURCE = `export type ItemStatus = "planned" | "active" | "done";

export interface LifeRecord {
  id: string;
  title: string;
  category: string;
  dueDate: string;
  effort: number;
  impact: number;
  status: ItemStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ThemeConfig {
  readonly id: string;
  readonly product: string;
  readonly tagline: string;
  readonly itemLabel: string;
  readonly dateLabel: string;
  readonly effortLabel: string;
  readonly impactLabel: string;
  readonly categories: readonly string[];
  readonly seeds: readonly (readonly [string, string, number, number])[];
}

export interface PlanEntry {
  item: LifeRecord;
  score: number;
  reasons: string[];
  daysUntilDue: number;
}

export interface PlanSummary {
  total: number;
  completed: number;
  overdue: number;
  dueSoon: number;
  effort: number;
  byCategory: Record<string, number>;
}
`;

const PLANNER_SOURCE = `import type { LifeRecord, PlanEntry, PlanSummary, ThemeConfig } from "../types";

const DAY_MS = 86_400_000;

export function localDay(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const start = Date.parse(\`${'${from}'}T00:00:00Z\`);
  const end = Date.parse(\`${'${to}'}T00:00:00Z\`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.POSITIVE_INFINITY;
  return Math.round((end - start) / DAY_MS);
}

export function validateRecord(input: Partial<LifeRecord>, theme: ThemeConfig): string[] {
  const errors: string[] = [];
  if (!input.title?.trim()) errors.push(\`${'${theme.itemLabel}'} needs a title.\`);
  if (!input.category || !theme.categories.includes(input.category)) errors.push("Choose a valid category.");
  if (!input.dueDate || !/^\\d{4}-\\d{2}-\\d{2}$/.test(input.dueDate)) errors.push("Choose a valid date.");
  if (!Number.isFinite(input.effort) || Number(input.effort) < 1 || Number(input.effort) > 480) {
    errors.push(\`${'${theme.effortLabel}'} must be between 1 and 480.\`);
  }
  if (!Number.isInteger(input.impact) || Number(input.impact) < 1 || Number(input.impact) > 5) {
    errors.push(\`${'${theme.impactLabel}'} must be an integer from 1 to 5.\`);
  }
  return errors;
}

export function priorityFor(item: LifeRecord, today = localDay()): PlanEntry {
  const daysUntilDue = daysBetween(today, item.dueDate);
  const reasons: string[] = [];
  let score = item.impact * 12;
  if (daysUntilDue < 0) {
    score += 55 + Math.min(Math.abs(daysUntilDue), 14) * 3;
    reasons.push(\`${'${Math.abs(daysUntilDue)}'} day(s) overdue\`);
  } else if (daysUntilDue === 0) {
    score += 45;
    reasons.push("due today");
  } else if (daysUntilDue <= 7) {
    score += 36 - daysUntilDue * 4;
    reasons.push(\`due in ${'${daysUntilDue}'} day(s)\`);
  }
  const effortPenalty = Math.min(item.effort / 20, 12);
  score -= effortPenalty;
  if (item.status === "active") {
    score += 8;
    reasons.push("already in progress");
  }
  if (item.status === "done") score = -1;
  if (reasons.length === 0) reasons.push("ranked by impact and effort");
  return { item, score: Math.round(score * 10) / 10, reasons, daysUntilDue };
}

export function buildPlan(items: readonly LifeRecord[], today = localDay()): PlanEntry[] {
  return items
    .map((item) => priorityFor(item, today))
    .filter((entry) => entry.item.status !== "done")
    .sort((a, b) => b.score - a.score || a.item.dueDate.localeCompare(b.item.dueDate));
}

export function summarize(items: readonly LifeRecord[], today = localDay()): PlanSummary {
  return items.reduce<PlanSummary>((summary, item) => {
    summary.total += 1;
    summary.effort += item.status === "done" ? 0 : item.effort;
    summary.completed += item.status === "done" ? 1 : 0;
    const days = daysBetween(today, item.dueDate);
    summary.overdue += item.status !== "done" && days < 0 ? 1 : 0;
    summary.dueSoon += item.status !== "done" && days >= 0 && days <= 7 ? 1 : 0;
    summary.byCategory[item.category] = (summary.byCategory[item.category] ?? 0) + 1;
    return summary;
  }, { total: 0, completed: 0, overdue: 0, dueSoon: 0, effort: 0, byCategory: {} });
}

export function suggestDailyLoad(items: readonly LifeRecord[], minutesPerDay: number, today = localDay()) {
  const capacity = Math.max(1, minutesPerDay);
  const days = Array.from({ length: 7 }, (_, offset) => ({
    date: new Date(Date.parse(\`${'${today}'}T00:00:00Z\`) + offset * DAY_MS).toISOString().slice(0, 10),
    used: 0,
    entries: [] as PlanEntry[],
  }));
  for (const entry of buildPlan(items, today)) {
    const candidates = days.filter((day, index) => index <= Math.max(0, Math.min(6, entry.daysUntilDue)));
    const target = (candidates.length > 0 ? candidates : days).sort((a, b) => a.used - b.used)[0];
    if (!target) continue;
    target.entries.push(entry);
    target.used += entry.item.effort;
  }
  return days.map((day) => ({ ...day, overloaded: day.used > capacity }));
}
`;

const STORE_SOURCE = `import type { LifeRecord } from "../types";

interface StoreEnvelope { version: 1; records: LifeRecord[]; savedAt: string }
type Listener = (records: readonly LifeRecord[]) => void;

export class RecordStore {
  private readonly listeners = new Set<Listener>();
  private records: LifeRecord[];

  constructor(private readonly key: string, initial: LifeRecord[]) {
    this.records = this.read(initial);
  }

  all(): readonly LifeRecord[] { return this.records.map((item) => ({ ...item })); }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.all());
    return () => this.listeners.delete(listener);
  }

  upsert(record: LifeRecord): void {
    const at = this.records.findIndex((item) => item.id === record.id);
    if (at >= 0) this.records[at] = { ...record };
    else this.records.push({ ...record });
    this.commit();
  }

  remove(id: string): void {
    this.records = this.records.filter((item) => item.id !== id);
    this.commit();
  }

  replace(records: LifeRecord[]): void {
    this.records = records.map((item) => ({ ...item }));
    this.commit();
  }

  private read(fallback: LifeRecord[]): LifeRecord[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.key) ?? "null") as StoreEnvelope | null;
      if (parsed?.version === 1 && Array.isArray(parsed.records)) return parsed.records;
    } catch {
      localStorage.removeItem(this.key);
    }
    return fallback;
  }

  private commit(): void {
    const envelope: StoreEnvelope = { version: 1, records: this.records, savedAt: new Date().toISOString() };
    localStorage.setItem(this.key, JSON.stringify(envelope));
    for (const listener of this.listeners) listener(this.all());
  }
}
`;

const EXCHANGE_SOURCE = `import type { ItemStatus, LifeRecord, ThemeConfig } from "../types";

export function exportJson(records: readonly LifeRecord[]): string {
  return JSON.stringify({ schema: 1, exportedAt: new Date().toISOString(), records }, null, 2);
}

const STATUSES: readonly ItemStatus[] = ["planned", "active", "done"];

function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
  const parsed = new Date(\`${'${value}'}T00:00:00Z\`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 40 ||
      !/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$/.test(value)) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  // Backups emitted by this app always use UTC. Accept seconds-only input too, but compare the
  // normalized instant so impossible dates (for example February 30) cannot roll into March.
  const canonical = value.includes(".") ? value : value.replace(/Z$/, ".000Z");
  return parsed.toISOString() === canonical;
}

function decodeRecord(value: unknown, index: number, theme: ThemeConfig): LifeRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(\`Record ${'${index + 1}'} is not an object.\`);
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id.length < 1 || raw.id.length > 120) {
    throw new Error(\`Record ${'${index + 1}'} has an invalid id.\`);
  }
  if (typeof raw.title !== "string" || raw.title.trim().length < 1 || raw.title.length > 100) {
    throw new Error(\`Record ${'${index + 1}'} has an invalid title.\`);
  }
  if (typeof raw.category !== "string" || !theme.categories.includes(raw.category)) {
    throw new Error(\`Record ${'${index + 1}'} has an unknown category.\`);
  }
  if (!isCalendarDay(raw.dueDate)) throw new Error(\`Record ${'${index + 1}'} has an invalid due date.\`);
  if (typeof raw.effort !== "number" || !Number.isFinite(raw.effort) || raw.effort < 1 || raw.effort > 480) {
    throw new Error(\`Record ${'${index + 1}'} has invalid effort.\`);
  }
  if (typeof raw.impact !== "number" || !Number.isInteger(raw.impact) || raw.impact < 1 || raw.impact > 5) {
    throw new Error(\`Record ${'${index + 1}'} has invalid impact.\`);
  }
  if (typeof raw.status !== "string" || !STATUSES.includes(raw.status as ItemStatus)) {
    throw new Error(\`Record ${'${index + 1}'} has an invalid status.\`);
  }
  if (typeof raw.notes !== "string" || raw.notes.length > 600) {
    throw new Error(\`Record ${'${index + 1}'} has invalid notes.\`);
  }
  if (!isTimestamp(raw.createdAt) || !isTimestamp(raw.updatedAt)) {
    throw new Error(\`Record ${'${index + 1}'} has invalid timestamps.\`);
  }
  return {
    id: raw.id,
    title: raw.title.trim(),
    category: raw.category,
    dueDate: raw.dueDate,
    effort: raw.effort,
    impact: raw.impact,
    status: raw.status as ItemStatus,
    notes: raw.notes,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export function importJson(source: string, theme: ThemeConfig): LifeRecord[] {
  const parsed = JSON.parse(source) as { schema?: unknown; records?: unknown };
  if (parsed.schema !== 1 || !Array.isArray(parsed.records)) throw new Error("Unsupported backup format.");
  const ids = new Set<string>();
  return parsed.records.map((value, index) => {
    const item = decodeRecord(value, index, theme);
    if (ids.has(item.id)) throw new Error(\`Record ${'${index + 1}'} has a duplicate id.\`);
    ids.add(item.id);
    return item;
  });
}

function csvCell(value: unknown): string { return \`"${'${String(value ?? "").replaceAll("\\\"", "\\\"\\\"")}'}"\`; }

export function exportCsv(records: readonly LifeRecord[]): string {
  const fields: (keyof LifeRecord)[] = ["id", "title", "category", "dueDate", "effort", "impact", "status", "notes"];
  return [fields.join(","), ...records.map((item) => fields.map((field) => csvCell(item[field])).join(","))].join("\\n");
}

export function download(name: string, contents: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = Object.assign(document.createElement("a"), { href: url, download: name });
  anchor.click();
  URL.revokeObjectURL(url);
}
`;

const MAIN_SOURCE = `import "./style.css";
import { exportCsv, exportJson, importJson, download } from "./core/exchange";
import { buildPlan, localDay, suggestDailyLoad, summarize, validateRecord } from "./core/planner";
import { RecordStore } from "./core/store";
import { revisionLedger } from "./generated/revision-ledger";
import { theme } from "./theme";
import type { ItemStatus, LifeRecord } from "./types";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Application root is missing.");

const offsetDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const initial: LifeRecord[] = theme.seeds.map(([title, category, effort, impact], index) => ({
  id: crypto.randomUUID(), title, category, effort, impact,
  dueDate: offsetDay(index + 1), status: index === 0 ? "active" : "planned", notes: "",
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}));
const store = new RecordStore(\`life-board:${'${theme.id}'}:v1\`, initial);
let selectedCategory = "all";

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};
const escapeHtml = (value: unknown): string =>
  String(value).replace(/[&<>"']/g, (character) => HTML_ENTITIES[character] ?? character);

root.innerHTML = \`
  <header class="hero"><div><span class="eyebrow">Local-first planning studio</span><h1>${'${theme.product}'}</h1>
    <p>${'${theme.tagline}'}</p></div><div class="revision" title="Repository revision ledger">
    <span>revision</span><strong>${'${revisionLedger.ordinal}'}</strong><small>${'${revisionLedger.day}'}</small></div></header>
  <section id="summary" class="summary"></section>
  <main class="layout"><section class="panel"><div class="panel-title"><h2>Add ${'${theme.itemLabel.toLowerCase()}'}</h2>
    <button id="seed-export" class="ghost">Export JSON</button></div><form id="record-form" novalidate>
    <label>Title<input name="title" maxlength="100" required></label>
    <div class="form-grid"><label>Category<select name="category">${'${theme.categories.map((x) => `<option>${x}</option>`).join("")}'}</select></label>
    <label>${'${theme.dateLabel}'}<input name="dueDate" type="date" value="${'${localDay()}'}" required></label>
    <label>${'${theme.effortLabel}'}<input name="effort" type="number" min="1" max="480" value="30" required></label>
    <label>${'${theme.impactLabel}'}<input name="impact" type="number" min="1" max="5" value="3" required></label></div>
    <label>Notes<textarea name="notes" rows="3" maxlength="600"></textarea></label><p id="errors" class="errors"></p>
    <button type="submit">Add to plan</button></form><div class="exchange"><button id="csv" class="ghost">Export CSV</button>
    <label class="file">Import JSON<input id="import" type="file" accept="application/json"></label></div></section>
  <section class="panel plan-panel"><div class="panel-title"><h2>Priority plan</h2><select id="filter"><option value="all">All categories</option>
    ${'${theme.categories.map((x) => `<option>${x}</option>`).join("")}'}</select></div><div id="plan"></div></section></main>
  <section class="panel week-panel"><div class="panel-title"><h2>Seven-day load</h2><label>Daily capacity
    <input id="capacity" type="number" min="15" max="480" step="15" value="90"></label></div><div id="week" class="week"></div></section>
\`;

const form = document.querySelector<HTMLFormElement>("#record-form")!;
const errors = document.querySelector<HTMLParagraphElement>("#errors")!;
const capacity = document.querySelector<HTMLInputElement>("#capacity")!;

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const now = new Date().toISOString();
  const item: LifeRecord = {
    id: crypto.randomUUID(), title: String(data.get("title") ?? "").trim(),
    category: String(data.get("category") ?? ""), dueDate: String(data.get("dueDate") ?? ""),
    effort: Number(data.get("effort")), impact: Number(data.get("impact")), status: "planned",
    notes: String(data.get("notes") ?? "").trim(), createdAt: now, updatedAt: now,
  };
  const complaints = validateRecord(item, theme);
  if (complaints.length) { errors.textContent = complaints.join(" "); return; }
  errors.textContent = ""; store.upsert(item); form.reset();
  (form.elements.namedItem("dueDate") as HTMLInputElement).value = localDay();
});

document.querySelector<HTMLSelectElement>("#filter")!.addEventListener("change", (event) => {
  selectedCategory = (event.target as HTMLSelectElement).value; render(store.all());
});
capacity.addEventListener("input", () => render(store.all()));
document.querySelector("#seed-export")!.addEventListener("click", () => download("records.json", exportJson(store.all()), "application/json"));
document.querySelector("#csv")!.addEventListener("click", () => download("records.csv", exportCsv(store.all()), "text/csv"));
document.querySelector<HTMLInputElement>("#import")!.addEventListener("change", async (event) => {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
  try { store.replace(importJson(await file.text(), theme)); errors.textContent = ""; }
  catch (error) { errors.textContent = error instanceof Error ? error.message : "Import failed."; }
});

function render(records: readonly LifeRecord[]): void {
  const summary = summarize(records);
  document.querySelector("#summary")!.innerHTML = [
    ["Open", summary.total - summary.completed], ["Due soon", summary.dueSoon],
    ["Overdue", summary.overdue], [theme.effortLabel, summary.effort],
  ].map(([label, value]) => \`<article><span>${'${label}'}</span><strong>${'${value}'}</strong></article>\`).join("");
  const plan = buildPlan(records).filter((entry) => selectedCategory === "all" || entry.item.category === selectedCategory);
  document.querySelector("#plan")!.innerHTML = plan.length ? plan.map((entry) => \`<article class="record">
    <div><span class="badge">${'${escapeHtml(entry.item.category)}'}</span><h3>${'${escapeHtml(entry.item.title)}'}</h3><p>${'${escapeHtml(entry.reasons.join("; "))}'}</p></div>
    <div class="record-actions"><strong>${'${entry.score}'}</strong><select data-status="${'${escapeHtml(entry.item.id)}'}">
    ${'${(["planned", "active", "done"] as ItemStatus[]).map((status) => `<option ${status === entry.item.status ? "selected" : ""}>${status}</option>`).join("")}'}</select>
    <button class="danger ghost" data-remove="${'${escapeHtml(entry.item.id)}'}">Remove</button></div></article>\`).join("") : "<p class='empty'>No open records match this view.</p>";
  for (const select of document.querySelectorAll<HTMLSelectElement>("[data-status]")) select.onchange = () => {
    const item = records.find((x) => x.id === select.dataset.status); if (!item) return;
    store.upsert({ ...item, status: select.value as ItemStatus, updatedAt: new Date().toISOString() });
  };
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-remove]")) button.onclick = () => store.remove(button.dataset.remove!);
  document.querySelector("#week")!.innerHTML = suggestDailyLoad(records, Number(capacity.value) || 90).map((day) => \`<article class="day ${'${day.overloaded ? "over" : ""}'}">
    <span>${'${new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" })}'}</span><strong>${'${day.used}'} min</strong>
    <small>${'${day.entries.length}'} item(s)</small></article>\`).join("");
}

store.subscribe(render);
`;

const STYLE_SOURCE = `:root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #18302b; background: #edf3ef; font-synthesis: none; }
* { box-sizing: border-box; } body { margin: 0; min-width: 320px; } button, input, select, textarea { font: inherit; }
button, .file { border: 0; border-radius: .7rem; padding: .72rem 1rem; background: #176b55; color: white; cursor: pointer; font-weight: 700; }
button:hover, .file:hover { filter: brightness(.94); } .ghost { color: #176b55; background: #e4f0eb; } .danger { color: #9a3434; }
#app { max-width: 1180px; margin: 0 auto; padding: 2rem; } .hero { display: flex; justify-content: space-between; gap: 2rem; align-items: end; padding: 2.5rem; border-radius: 1.4rem; background: linear-gradient(135deg,#173c34,#28745e); color: white; box-shadow: 0 18px 50px #173c3426; }
.hero h1 { font-size: clamp(2.2rem,6vw,4.6rem); margin: .15rem 0; letter-spacing: -.055em; } .hero p { max-width: 650px; opacity: .84; margin-bottom: 0; }
.eyebrow { text-transform: uppercase; letter-spacing: .14em; font-size: .72rem; font-weight: 800; opacity: .72; } .revision { min-width: 100px; padding: 1rem; text-align: center; border: 1px solid #ffffff38; border-radius: 1rem; background: #ffffff12; }
.revision span,.revision small { display: block; opacity: .72; } .revision strong { display: block; font-size: 2rem; }
.summary { display: grid; grid-template-columns: repeat(4,1fr); gap: 1rem; margin: 1.2rem 0; } .summary article,.panel { background: #fff; border: 1px solid #dce7e1; border-radius: 1rem; box-shadow: 0 8px 24px #173c340c; }
.summary article { padding: 1rem 1.2rem; } .summary span { display: block; color: #668078; font-size: .78rem; text-transform: uppercase; letter-spacing: .08em; } .summary strong { font-size: 1.8rem; }
.layout { display: grid; grid-template-columns: minmax(280px,.8fr) minmax(390px,1.4fr); gap: 1.2rem; } .panel { padding: 1.25rem; } .panel-title { display: flex; justify-content: space-between; gap: 1rem; align-items: center; margin-bottom: 1rem; } h2,h3 { margin: 0; }
label { display: grid; gap: .35rem; color: #526b64; font-size: .82rem; font-weight: 700; } input,select,textarea { width: 100%; border: 1px solid #cbdad3; border-radius: .65rem; padding: .68rem; background: #fbfdfc; color: #18302b; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; margin: .75rem 0; } .errors { color: #a33232; min-height: 1.2rem; } .exchange { display: flex; gap: .6rem; margin-top: .8rem; } .file input { display: none; }
.record { display: flex; justify-content: space-between; gap: 1rem; padding: 1rem 0; border-top: 1px solid #e5ece8; } .record:first-child { border-top: 0; } .record h3 { margin-top: .4rem; } .record p { margin: .3rem 0 0; color: #698078; font-size: .86rem; }
.badge { display: inline-flex; padding: .22rem .5rem; border-radius: 99px; background: #e4f0eb; color: #176b55; font-size: .7rem; font-weight: 800; } .record-actions { display: grid; grid-template-columns: 50px 100px; gap: .5rem; align-items: center; text-align: right; } .record-actions strong { font-size: 1.4rem; }
.week-panel { margin-top: 1.2rem; } .week { display: grid; grid-template-columns: repeat(7,1fr); gap: .65rem; } .day { padding: .8rem; border-radius: .7rem; background: #edf6f2; } .day span,.day small { display: block; } .day strong { display: block; margin: .35rem 0; } .day.over { background: #fff0e3; color: #863f19; } .empty { color: #70877f; padding: 2rem; text-align: center; }
@media (max-width: 820px) { #app { padding: 1rem; } .layout { grid-template-columns: 1fr; } .summary { grid-template-columns: 1fr 1fr; } .week { grid-template-columns: repeat(2,1fr); } .hero { align-items: start; } }
`;

const TEST_SOURCE = `import { describe, expect, it } from "vitest";
import { importJson } from "../src/core/exchange";
import { buildPlan, daysBetween, priorityFor, suggestDailyLoad, summarize } from "../src/core/planner";
import { theme } from "../src/theme";
import type { LifeRecord } from "../src/types";

const item = (overrides: Partial<LifeRecord> = {}): LifeRecord => ({
  id: "one", title: "Example", category: "General", dueDate: "2026-08-20", effort: 30,
  impact: 3, status: "planned", notes: "", createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z", ...overrides,
});

describe("planning engine", () => {
  it("calculates calendar-day distance without local time drift", () => expect(daysBetween("2026-08-19", "2026-08-20")).toBe(1));
  it("ranks overdue high-impact work above distant work", () => {
    const overdue = item({ id: "late", dueDate: "2026-08-18", impact: 5 });
    const distant = item({ id: "later", dueDate: "2026-09-20", impact: 2 });
    expect(buildPlan([distant, overdue], "2026-08-20")[0]!.item.id).toBe("late");
  });
  it("removes completed work from the active plan", () => expect(buildPlan([item({ status: "done" })], "2026-08-19")).toHaveLength(0));
  it("explains the score", () => expect(priorityFor(item(), "2026-08-19").reasons.join(" ")).toContain("due in 1 day"));
  it("summarizes status and workload", () => {
    const result = summarize([item(), item({ id: "two", status: "done", category: "Other" })], "2026-08-19");
    expect(result).toMatchObject({ total: 2, completed: 1, dueSoon: 1, effort: 30 });
  });
  it("flags a day whose assigned effort exceeds capacity", () => {
    const week = suggestDailyLoad([item({ effort: 120 })], 60, "2026-08-19");
    expect(week.some((day) => day.overloaded)).toBe(true);
  });
});

describe("JSON exchange boundary", () => {
  const valid = () => item({ category: theme.categories[0] });
  const backup = (record: unknown) => JSON.stringify({ schema: 1, records: [record] });

  it("accepts a fully valid record", () => {
    expect(importJson(backup(valid()), theme)).toHaveLength(1);
  });

  it.each([
    ["string effort", { effort: "30" }],
    ["out-of-range impact", { impact: 9 }],
    ["unknown status", { status: "paused" }],
    ["impossible calendar date", { dueDate: "2026-02-30" }],
    ["empty title", { title: "" }],
    ["unknown category", { category: "Not in this project" }],
    ["non-string notes", { notes: 42 }],
    ["invalid timestamp", { updatedAt: "yesterday" }],
    ["numeric-looking loose timestamp", { createdAt: "0" }],
    ["normalized impossible timestamp", { updatedAt: "2026-02-30T00:00:00Z" }],
  ])("rejects %s", (_label, patch) => {
    expect(() => importJson(backup({ ...valid(), ...patch }), theme)).toThrow();
  });

  it("rejects duplicate ids instead of silently merging records", () => {
    const record = valid();
    expect(() => importJson(JSON.stringify({ schema: 1, records: [record, record] }), theme)).toThrow(/duplicate id/);
  });
});
`;

function packageSource(repoName, theme) {
  return `${JSON.stringify({
    name: repoName,
    version: "1.0.0",
    private: true,
    type: "module",
    description: theme.tagline,
    scripts: { dev: "vite", build: "tsc --noEmit && vite build", test: "vitest run", preview: "vite preview" },
    devDependencies: { typescript: "^5.9.2", vite: "^7.1.3", vitest: "^3.2.4" },
  }, null, 2)}\n`;
}

const TSCONFIG_SOURCE = `${JSON.stringify({
  compilerOptions: {
    target: "ES2022", useDefineForClassFields: true, module: "ESNext", moduleResolution: "Bundler",
    strict: true, noUncheckedIndexedAccess: true, noUnusedLocals: true, lib: ["ES2022", "DOM", "DOM.Iterable"],
    types: ["vite/client"], skipLibCheck: true, isolatedModules: true, noEmit: true,
  },
  include: ["src", "test"],
}, null, 2)}\n`;

const INDEX_SOURCE = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="description" content="A local-first life planning dashboard"><title>Life Planning Dashboard</title></head>
<body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>
`;

/** Build one complete TypeScript/Vite application as a Map of POSIX paths to Buffers. */
export function buildCompanionProject({ repoName, theme, now = new Date() }) {
  assertSafeRepoName(repoName);
  if (!theme || !LIFE_PROJECT_THEMES.includes(theme)) throw new Error("A known life-project theme is required.");
  const files = new Map([
    ["README.md", asSource(readmeSource(repoName, theme))],
    ["package.json", asSource(packageSource(repoName, theme))],
    ["tsconfig.json", asSource(TSCONFIG_SOURCE)],
    ["index.html", asSource(INDEX_SOURCE)],
    [".gitignore", asSource("node_modules/\ndist/\n*.local\n")],
    ["src/types.ts", asSource(TYPES_SOURCE)],
    ["src/theme.ts", asSource(themeSource(theme))],
    [REVISION_LEDGER_PATH, asSource(ledgerSource(now))],
    ["src/core/planner.ts", asSource(PLANNER_SOURCE)],
    ["src/core/store.ts", asSource(STORE_SOURCE)],
    ["src/core/exchange.ts", asSource(EXCHANGE_SOURCE)],
    ["src/main.ts", asSource(MAIN_SOURCE)],
    ["src/style.css", asSource(STYLE_SOURCE)],
    ["test/planner.test.ts", asSource(TEST_SOURCE)],
  ]);
  if (!files.get("src/main.ts")?.toString("utf8").includes('from "./generated/revision-ledger"')) {
    throw new Error(`Generated app does not import ${REVISION_LEDGER_PATH}.`);
  }
  return { repoName, theme, files };
}

/** Select different themes deterministically from random repository names, then build all apps. */
export function buildCompanionProjects({ repoNames, now = new Date() }) {
  const usedThemes = new Set();
  return repoNames.map((repoName) => {
    assertSafeRepoName(repoName);
    const digest = createHash("sha256").update(repoName).digest();
    let index = digest.readUInt32BE(0) % LIFE_PROJECT_THEMES.length;
    while (usedThemes.has(index)) index = (index + 1) % LIFE_PROJECT_THEMES.length;
    usedThemes.add(index);
    return buildCompanionProject({ repoName, theme: LIFE_PROJECT_THEMES[index], now });
  });
}
