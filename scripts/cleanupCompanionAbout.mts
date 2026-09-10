#!/usr/bin/env node
/** Registered companion About cleanup. Dry-run by default; never edits repository files. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnv } from "./loadEnv.mjs";
import { stripCompanionMarker } from "../src/lib/validation/companionMetadata";

type Companion = { repo: string; githubId?: number; language?: string; pendingDelete?: boolean };
type Pending = { repo: string; operationId: string; githubId?: number; kind: "create" | "fork"; metadataVersion?: 2 };
type Station = { owner: string; repo: string; pat: string; companionRepos: Companion[]; nurturePending?: Pending };
export type CompanionAboutRegistry = { githubStations: Station[] };
export type CompanionAboutTarget = { stationSlug: string; repo: string; pendingOperationId?: string };
type Reply = { status: number; body: unknown };
export type CompanionAboutRequest = (method: "GET" | "PATCH", route: string, body?: { description: string }) => Promise<Reply>;
type Info = { id: number; full_name: string; description: string | null; language?: string | null };
export type CompanionAboutResult = {
  slug: string; status: "planned" | "updated" | "unchanged" | "skipped" | "failed";
  markers: number; checkpoints: number; writes: number; note?: string;
};
type Dependencies = {
  apply?: boolean;
  read: () => Promise<CompanionAboutRegistry>;
  mutate: (change: (settings: CompanionAboutRegistry) => void) => Promise<void>;
  request: CompanionAboutRequest;
};
const MAX_BODY_BYTES = 1024 * 1024;
const validOwner = (owner: string) => /^[a-z0-9-]{1,39}$/i.test(owner);
const validRepo = (repo: string) => /^[\w.-]{1,100}$/.test(repo) && repo !== "." && repo !== "..";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const stationSlug = (station: Station) => `${station.owner}/${station.repo}`;
const validSlug = (slug: string) => slug.split("/").length === 2 && validOwner(slug.split("/")[0]) && validRepo(slug.split("/")[1]);
class CleanupError extends Error {}

/** Fixed GitHub host, repository metadata endpoint only, with bounded time/body and no redirects. */
export function companionAboutRequest(pat: string, transport: typeof fetch = fetch, deadlineAt = Date.now() + 90_000): CompanionAboutRequest {
  return async (method, route, body) => {
    const slug = route.slice("/repos/".length);
    if (!route.startsWith("/repos/") || !validSlug(slug) || !["GET", "PATCH"].includes(method) ||
        (method === "GET" ? body !== undefined : !body || Object.keys(body).length !== 1 || typeof body.description !== "string" || body.description.length > 1000)) {
      throw new CleanupError("Unexpected companion metadata request.");
    }
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new CleanupError("Companion metadata time limit reached.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(15_000, remaining));
    try {
      const response = await transport(`https://api.github.com${route}`, {
        method, redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "companion-about-maintenance", "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new CleanupError("GitHub metadata response exceeds the size limit."); }
          chunks.push(chunk.value);
        }
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      let decoded: unknown = null;
      if (raw) { try { decoded = JSON.parse(raw); } catch { throw new CleanupError("GitHub returned invalid metadata JSON."); } }
      return { status: response.status, body: decoded };
    } catch (error) {
      if (error instanceof CleanupError) throw error;
      throw new CleanupError("GitHub metadata request failed or timed out.");
    } finally { clearTimeout(timeout); }
  };
}

function registered(settings: CompanionAboutRegistry, target: CompanionAboutTarget) {
  if (!validSlug(target.stationSlug) || !validRepo(target.repo)) throw new CleanupError("Registered repository name is invalid.");
  const parents = settings.githubStations.filter((station) => same(stationSlug(station), target.stationSlug));
  if (parents.length !== 1) throw new CleanupError("The parent station is missing or duplicated.");
  const station = parents[0];
  const slug = `${station.owner}/${target.repo}`;
  if (settings.githubStations.some((item) => same(stationSlug(item), slug))) throw new CleanupError("Primary repositories cannot be changed by companion cleanup.");
  const entries = station.companionRepos.filter((entry) => same(entry.repo, target.repo));
  const pending = station.nurturePending && same(station.nurturePending.repo, target.repo) ? station.nurturePending : undefined;
  if (entries.length > 1 || (!entries.length && !pending)) throw new CleanupError("The companion is missing or duplicated in its parent register.");
  if (pending?.operationId !== target.pendingOperationId) throw new CleanupError("The pending creation changed; rerun the cleanup plan.");
  if (settings.githubStations.some((item) => item !== station && same(item.owner, station.owner) &&
      (item.companionRepos.some((entry) => same(entry.repo, target.repo)) || same(item.nurturePending?.repo ?? "", target.repo)))) {
    throw new CleanupError("The companion is also registered under another parent.");
  }
  if (entries[0]?.pendingDelete) throw new CleanupError("The companion is awaiting deletion; cleanup was not attempted.");
  return { station, companion: entries[0] as Companion | undefined, pending, slug };
}

function repoInfo(body: unknown, slug: string): Info {
  const value = body as Partial<Info> | null;
  if (!value || !Number.isSafeInteger(value.id) || Number(value.id) <= 0 || typeof value.full_name !== "string" || !same(value.full_name, slug) ||
      (value.description !== null && (typeof value.description !== "string" || value.description.length > 1000)) ||
      (value.language !== undefined && value.language !== null && (typeof value.language !== "string" || value.language.length > 80))) {
    throw new CleanupError("GitHub repository identity or metadata is invalid.");
  }
  return value as Info;
}

function verifyIdentity(row: ReturnType<typeof registered>, info: Info, requireCheckpoint = false) {
  for (const entry of [row.companion, row.pending]) {
    if (entry?.githubId !== undefined && entry.githubId !== info.id) throw new CleanupError("The registered GitHub repository ID does not match.");
    if (entry && requireCheckpoint && entry.githubId !== info.id) throw new CleanupError("The verified repository ID was not saved; cleanup was not attempted.");
  }
  if (row.pending && row.pending.githubId === undefined) {
    const description = info.description ?? "";
    if (row.pending.metadataVersion === 2 || row.pending.kind !== "create" || stripCompanionMarker(description) === description || !description.endsWith(`[companion:${row.pending.operationId}]`)) {
      throw new CleanupError("Pending creation has no matching operation marker or verified repository ID.");
    }
  }
}

async function demand(request: CompanionAboutRequest, route: string, method: "GET" | "PATCH" = "GET", body?: { description: string }) {
  const reply = await request(method, route, body);
  if (reply.status !== 200) throw new CleanupError(`GitHub metadata HTTP ${reply.status}.`);
  return reply.body;
}

/** Targets are exclusively explicit companion/pending registrations; no GitHub discovery or adoption. */
export function companionAboutTargets(settings: CompanionAboutRegistry, onlyRepo?: string): CompanionAboutTarget[] {
  if (onlyRepo && !validSlug(onlyRepo)) throw new CleanupError("--repo must be a valid owner/repo.");
  const targets: CompanionAboutTarget[] = [];
  for (const station of settings.githubStations) {
    const names = new Set(station.companionRepos.map((entry) => entry.repo));
    if (station.nurturePending && ![...names].some((repo) => same(repo, station.nurturePending!.repo))) names.add(station.nurturePending.repo);
    for (const repo of names) {
      if (onlyRepo && !same(`${station.owner}/${repo}`, onlyRepo)) continue;
      const pending = station.nurturePending && same(station.nurturePending.repo, repo) ? station.nurturePending : undefined;
      targets.push({ stationSlug: stationSlug(station), repo, ...(pending ? { pendingOperationId: pending.operationId } : {}) });
    }
  }
  if (onlyRepo && !targets.length) throw new CleanupError("The requested repository is not a registered companion or pending creation.");
  return targets;
}

export async function cleanupCompanionAbout(target: CompanionAboutTarget, options: Dependencies): Promise<CompanionAboutResult> {
  const candidateSlug = `${target.stationSlug.split("/")[0]}/${target.repo}`;
  const result: CompanionAboutResult = { slug: validSlug(candidateSlug) ? candidateSlug : "[invalid repository]", status: "failed", markers: 0, checkpoints: 0, writes: 0 };
  try {
    const initial = registered(await options.read(), target);
    result.slug = initial.slug;
    const route = `/repos/${initial.slug}`;
    const info = repoInfo(await demand(options.request, route), initial.slug);
    verifyIdentity(initial, info);
    const description = info.description === null ? null : stripCompanionMarker(info.description);
    result.markers = Number(description !== info.description);
    const language = info.language?.trim();
    const needsCheckpoint = [initial.companion, initial.pending].some((entry) => entry && entry.githubId === undefined) ||
      !!(initial.companion && !initial.companion.language?.trim() && language);
    if (!options.apply) return { ...result, status: result.markers || needsCheckpoint ? "planned" : "unchanged" };

    if (needsCheckpoint) {
      await options.mutate((settings) => {
        const fresh = registered(settings, target);
        verifyIdentity(fresh, info);
        if (fresh.companion) {
          fresh.companion.githubId = info.id;
          if (!fresh.companion.language?.trim() && language) fresh.companion.language = language;
        }
        // Save identity before removing the legacy recovery marker, retaining the operation itself.
        if (fresh.pending) fresh.pending.githubId = info.id;
      });
      result.checkpoints++;
    }
    const current = registered(await options.read(), target);
    verifyIdentity(current, info, true);
    if (!result.markers) return { ...result, status: result.checkpoints ? "updated" : "unchanged" };

    // GitHub description has no content SHA. Re-read immediately before PATCH and skip any edit.
    const beforePatch = repoInfo(await demand(options.request, route), initial.slug);
    if (beforePatch.id !== info.id || beforePatch.description !== info.description) {
      return { ...result, status: "skipped", note: "Repository identity or description changed; rerun the cleanup plan." };
    }
    const response = await demand(options.request, route, "PATCH", { description: description! });
    result.writes++;
    const patched = repoInfo(response, initial.slug);
    const verified = repoInfo(await demand(options.request, route), initial.slug);
    if (patched.id !== info.id || verified.id !== info.id || patched.description !== description || verified.description !== description ||
        stripCompanionMarker(verified.description ?? "") !== verified.description) {
      throw new CleanupError("The About update could not be verified; rerun the cleanup plan.");
    }
    return { ...result, status: "updated" };
  } catch (error) {
    return { ...result, status: "failed", note: error instanceof CleanupError ? error.message : "Companion cleanup failed locally; private details were not logged." };
  }
}

async function main() {
  const args = process.argv.slice(2);
  let apply = false;
  let onlyRepo: string | undefined;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--apply") apply = true;
    else if (args[index] === "--dry-run") continue;
    else if (args[index] === "--repo") {
      const value = args[++index];
      if (!value || !validSlug(value)) throw new CleanupError("--repo must be a valid owner/repo.");
      onlyRepo = value;
    } else if (args[index] === "--help") {
      console.log("Companion About marker cleanup: default --dry-run; --apply writes; optional --repo owner/repo. Run beside the authoritative application database on the VM.");
      return;
    } else throw new CleanupError("Unsupported companion cleanup option.");
  }
  if (apply && args.includes("--dry-run")) throw new CleanupError("Use either --apply or --dry-run.");
  loadEnv();
  let host: string;
  try { host = new URL(process.env.DATABASE_URL ?? "").hostname; } catch { throw new CleanupError("The application database is not configured."); }
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) throw new CleanupError("Run companion cleanup beside the authoritative application database on the VM.");
  const { getAppSettings } = await import("../src/lib/services/settings");
  const { mutateGithubState, withCompanionLease } = await import("../src/lib/services/companionState");
  const { decryptSecret, isEncrypted } = await import("../src/lib/crypto/secretBox");
  const settings = await getAppSettings({ deadlineAt: Date.now() + 30_000 });
  const targets = companionAboutTargets(settings, onlyRepo);
  console.log(`Companion About ${apply ? "apply" : "dry-run"}: repositories=${targets.length}.`);
  const totals = { markers: 0, checkpoints: 0, writes: 0, failed: 0, skipped: 0 };
  for (const target of targets) {
    const deadlineAt = Date.now() + 90_000;
    let result: CompanionAboutResult;
    try {
      const station = registered(await getAppSettings({ deadlineAt }), target).station;
      let pat: string;
      try { pat = isEncrypted(station.pat) ? decryptSecret(station.pat) : station.pat; if (!pat.trim()) throw new Error(); }
      catch { throw new CleanupError("The parent station credential cannot be opened."); }
      const run = () => cleanupCompanionAbout(target, {
        apply, read: () => getAppSettings({ deadlineAt }), mutate: (change) => mutateGithubState(change, { deadlineAt }),
        request: companionAboutRequest(pat, fetch, deadlineAt),
      });
      const leased = apply ? await withCompanionLease(target.stationSlug, run, { deadlineAt }) : await run();
      result = leased ?? { slug: `${station.owner}/${target.repo}`, status: "skipped", markers: 0, checkpoints: 0, writes: 0, note: "The parent station is active; rerun when its current operation finishes." };
    } catch (error) {
      const slug = `${target.stationSlug.split("/")[0]}/${target.repo}`;
      result = { slug: validSlug(slug) ? slug : "[invalid repository]", status: "failed", markers: 0, checkpoints: 0, writes: 0, note: error instanceof CleanupError ? error.message : "Companion cleanup failed locally; private details were not logged." };
    }
    totals.markers += result.markers;
    totals.checkpoints += result.checkpoints;
    totals.writes += result.writes;
    if (result.status === "failed") totals.failed++;
    if (result.status === "skipped") totals.skipped++;
    console.log(`${result.slug}: ${result.status}; markers=${result.markers}; checkpoints=${result.checkpoints}; writes=${result.writes}${result.note ? `; ${result.note}` : ""}`);
  }
  console.log(`Summary: repositories=${targets.length}; markers=${totals.markers}; checkpoints=${totals.checkpoints}; writes=${totals.writes}; skipped=${totals.skipped}; failed=${totals.failed}.`);
  if (totals.failed || totals.skipped) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error: unknown) => { console.error(error instanceof CleanupError ? error.message : "Companion cleanup could not start; private details were not logged."); process.exitCode = 1; });
}
