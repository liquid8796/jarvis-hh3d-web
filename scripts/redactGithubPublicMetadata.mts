#!/usr/bin/env node
/** Metadata-only endpoint cleanup. Default is dry-run; never writes source or workflows. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnv } from "./loadEnv.mjs";
import { redactKnownBackendUrls } from "./githubPublicMetadata.mjs";
import { decryptSecret, isEncrypted } from "../src/lib/crypto/secretBox";

type Station = { owner: string; repo: string; pat: string; workflowFile?: string };
type Reply = { status: number; body: unknown };
export type MetadataRequest = (method: "GET" | "PUT" | "PATCH", route: string, body?: unknown) => Promise<Reply>;
type RepoInfo = { id: number; full_name: string; default_branch: string; description: string | null; homepage: string | null };
type Readme = { sha: string; path: string; text: string };
export type MetadataResult = { slug: string; status: "planned" | "updated" | "unchanged" | "failed"; changedFields: number; writes: number; note?: string };
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_README_BYTES = 512 * 1024;
class MetadataError extends Error {}

function originOf(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch { return null; }
}

/** Fixed-host transport. Response bodies and authentication material never enter diagnostics. */
export function metadataRequest(pat: string, transport: typeof fetch = fetch): MetadataRequest {
  return async (method, route, body) => {
    if (!route.startsWith("/repos/")) throw new MetadataError("Unexpected GitHub metadata route.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await transport(`https://api.github.com${route}`, {
        method, redirect: "error", signal: controller.signal,
        headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "github-metadata-maintenance", "Content-Type": "application/json" },
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
          if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new MetadataError("GitHub metadata response exceeds the size limit."); }
          chunks.push(chunk.value);
        }
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      let decoded: unknown = null;
      if (raw) { try { decoded = JSON.parse(raw); } catch { throw new MetadataError("GitHub returned invalid metadata JSON."); } }
      return { status: response.status, body: decoded };
    } catch (error) {
      if (error instanceof MetadataError) throw error;
      throw new MetadataError("GitHub metadata request failed or timed out.");
    } finally { clearTimeout(timeout); }
  };
}

async function demand(request: MetadataRequest, route: string, method: "GET" | "PUT" | "PATCH" = "GET", body?: unknown, accepted = [200]) {
  const reply = await request(method, route, body);
  if (!accepted.includes(reply.status)) throw new MetadataError(`GitHub metadata HTTP ${reply.status}.`);
  return reply;
}
function repoInfo(body: unknown, slug: string): RepoInfo {
  const value = body as Partial<RepoInfo> | null;
  if (!value || !Number.isSafeInteger(value.id) || Number(value.id) <= 0 || value.full_name?.toLowerCase() !== slug.toLowerCase() ||
      typeof value.default_branch !== "string" || !value.default_branch || value.default_branch.length > 200 ||
      (value.description !== null && typeof value.description !== "string") || (value.homepage !== null && typeof value.homepage !== "string")) {
    throw new MetadataError("GitHub repository identity or metadata is invalid.");
  }
  return value as RepoInfo;
}
function decodeFile(body: unknown, readmeOnly: boolean): Readme {
  const file = body as { type?: string; sha?: string; path?: string; encoding?: string; content?: string; size?: number } | null;
  if (!file || file.type !== "file" || !/^[a-f0-9]{40,64}$/i.test(file.sha ?? "") || typeof file.path !== "string" ||
      file.encoding !== "base64" || typeof file.content !== "string" || Number(file.size) > MAX_README_BYTES ||
      file.path.startsWith("/") || file.path.split("/").some((part) => !part || part === "." || part === ".." || part.includes("\\")) ||
      (readmeOnly && !/^(?:README|readme)(?:\.[a-z0-9]+)?$/i.test(file.path.split("/").at(-1)!))) {
    throw new MetadataError("GitHub README or workflow metadata is invalid or too large.");
  }
  const bytes = Buffer.from(file.content, "base64");
  if (bytes.length > MAX_README_BYTES || bytes.includes(0)) throw new MetadataError("GitHub README or workflow is not bounded text.");
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) throw new MetadataError("GitHub README or workflow is not valid UTF-8.");
  return { sha: file.sha!, path: file.path, text };
}

/** Origins come only from explicit configuration, the registered workflow, or the known old README template. */
export function publicMetadataOrigins(input: { explicit?: string[]; environment?: string[]; workflow?: string; readme?: string }): string[] {
  const result = new Set<string>();
  for (const value of [...(input.explicit ?? []), ...(input.environment ?? [])]) {
    const origin = originOf(value);
    if (origin) result.add(origin);
  }
  for (const line of (input.workflow ?? "").split(/\r?\n/)) {
    const match = /^\s*(?:WEB_URL|WEB_FALLBACK_URL|WORKER_FALLBACK_URL)\s*:\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const expression = /\$\{\{\s*vars\.(?:WEB_URL|WEB_FALLBACK_URL|WORKER_FALLBACK_URL)\s*\|\|\s*['"](https?:\/\/[^'"]+)['"]\s*\}\}/.exec(match[1]);
    const literal = /^['"]?(https?:\/\/[^\s'"]+)['"]?(?:\s+#.*)?$/.exec(match[1]);
    const origin = originOf(expression?.[1] ?? literal?.[1]);
    if (origin) result.add(origin);
  }
  const readme = input.readme ?? "";
  if (readme.includes("Scheduled background task runner.") && readme.includes("Generated from an upstream template")) {
    for (const match of readme.matchAll(/^Endpoint:[ \t]*(https?:\/\/\S+)[ \t]*\r?$/gm)) {
      const origin = originOf(match[1]);
      if (origin) result.add(origin);
    }
  }
  return [...result];
}

export async function redactStationPublicMetadata(station: Station, options: {
  apply?: boolean; origins?: string[]; environmentOrigins?: string[]; request: MetadataRequest;
}): Promise<MetadataResult> {
  const slug = `${station.owner}/${station.repo}`;
  let writes = 0;
  let changedFields = 0;
  try {
    if (!/^[a-z0-9-]{1,39}$/i.test(station.owner) || !/^[\w.-]{1,100}$/.test(station.repo) || [".", ".."].includes(station.repo)) throw new MetadataError("Registered repository name is invalid.");
    const base = `/repos/${encodeURIComponent(station.owner)}/${encodeURIComponent(station.repo)}`;
    const info = repoInfo((await demand(options.request, base)).body, slug);
    const readmeRoute = `${base}/readme?ref=${encodeURIComponent(info.default_branch)}`;
    const initialReadme = await demand(options.request, readmeRoute, "GET", undefined, [200, 404]);
    const readme = initialReadme.status === 200 ? decodeFile(initialReadme.body, true) : null;
    let workflow = "";
    if (station.workflowFile && /^[\w.-]+\.ya?ml$/i.test(station.workflowFile)) {
      const route = `${base}/contents/.github/workflows/${encodeURIComponent(station.workflowFile)}?ref=${encodeURIComponent(info.default_branch)}`;
      const response = await demand(options.request, route, "GET", undefined, [200, 404]);
      if (response.status === 200) workflow = decodeFile(response.body, false).text;
    }
    const origins = publicMetadataOrigins({ explicit: options.origins, environment: options.environmentOrigins, workflow, readme: readme?.text });
    const nextReadme = readme ? redactKnownBackendUrls(readme.text, origins) : null;
    const nextDescription = info.description === null ? null : redactKnownBackendUrls(info.description, origins);
    const nextHomepage = info.homepage && redactKnownBackendUrls(info.homepage, origins) !== info.homepage ? "" : info.homepage;
    const readmeChanged = readme !== null && nextReadme !== readme.text;
    const metadata: Record<string, string | null> = {};
    if (nextDescription !== info.description) metadata.description = nextDescription;
    if (nextHomepage !== info.homepage) metadata.homepage = nextHomepage;
    changedFields = Number(readmeChanged) + Object.keys(metadata).length;
    if (!changedFields) return { slug, status: "unchanged", changedFields, writes };
    if (!options.apply) return { slug, status: "planned", changedFields, writes };

    const fresh = repoInfo((await demand(options.request, base)).body, slug);
    if (fresh.id !== info.id || fresh.default_branch !== info.default_branch || fresh.description !== info.description || fresh.homepage !== info.homepage) {
      throw new MetadataError("Repository metadata changed during review; rerun the plan.");
    }
    if (readmeChanged && readme) {
      const latest = decodeFile((await demand(options.request, readmeRoute)).body, true);
      if (latest.sha !== readme.sha || latest.path !== readme.path) throw new MetadataError("README changed during review; rerun the plan.");
      const route = `${base}/contents/${readme.path.split("/").map(encodeURIComponent).join("/")}`;
      await demand(options.request, route, "PUT", { message: "docs: remove backend endpoint from public overview", branch: info.default_branch, sha: readme.sha, content: Buffer.from(nextReadme!, "utf8").toString("base64") }, [200]);
      writes++;
      const verified = decodeFile((await demand(options.request, readmeRoute)).body, true);
      if (verified.text !== nextReadme) throw new MetadataError("README write could not be verified; rerun the plan.");
    }
    if (Object.keys(metadata).length) {
      const beforePatch = repoInfo((await demand(options.request, base)).body, slug);
      if (beforePatch.id !== info.id || beforePatch.default_branch !== info.default_branch || beforePatch.description !== info.description || beforePatch.homepage !== info.homepage) {
        throw new MetadataError("Repository metadata changed before update; rerun the plan.");
      }
      const patched = repoInfo((await demand(options.request, base, "PATCH", metadata)).body, slug);
      writes++;
      const verified = repoInfo((await demand(options.request, base)).body, slug);
      if (patched.id !== info.id || verified.id !== info.id || Object.entries(metadata).some(([key, value]) => verified[key as "description" | "homepage"] !== value)) {
        throw new MetadataError("Repository metadata write could not be verified; rerun the plan.");
      }
    }
    return { slug, status: "updated", changedFields, writes };
  } catch (error) {
    return { slug, status: "failed", changedFields, writes, note: error instanceof MetadataError ? error.message : "Metadata cleanup failed locally; no private details were logged." };
  }
}

async function main() {
  const args = process.argv.slice(2);
  let apply = false;
  let onlyRepo: string | undefined;
  const origins: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === "--apply") apply = true;
    else if (value === "--dry-run" || value === "--plan") continue;
    else if (value === "--repo" || value === "--origin") {
      const next = args[++index];
      if (!next || next.startsWith("--")) throw new MetadataError("A --repo or --origin value is missing.");
      if (value === "--repo") onlyRepo = next.toLowerCase();
      else { const origin = originOf(next); if (!origin) throw new MetadataError("An explicit backend origin is invalid."); origins.push(origin); }
    } else if (value === "--help") {
      console.log("Primary README/About endpoint cleanup: default --dry-run; --apply writes; --repo owner/repo; repeat --origin https://backend-host.");
      return;
    } else throw new MetadataError("Unsupported metadata cleanup option.");
  }
  if (apply && (args.includes("--dry-run") || args.includes("--plan"))) throw new MetadataError("Use either --apply or --dry-run/--plan.");
  loadEnv();
  let host: string;
  try { host = new URL(process.env.DATABASE_URL ?? "").hostname; } catch { throw new MetadataError("The application database is not configured."); }
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) throw new MetadataError("Run metadata cleanup beside the authoritative application database on the VM.");
  const { getAppSettings } = await import("../src/lib/services/settings");
  const settings = await getAppSettings();
  const stations = settings.githubStations.filter((station) => !onlyRepo || `${station.owner}/${station.repo}`.toLowerCase() === onlyRepo);
  if (onlyRepo && !stations.length) throw new MetadataError("The requested owner/repo is not a registered primary station.");
  console.log(`Metadata ${apply ? "apply" : "dry-run"}: ${stations.length} registered primary repositories.`);
  let failed = 0;
  let changedFields = 0;
  let writes = 0;
  for (const station of stations) {
    let pat: string;
    try { pat = isEncrypted(station.pat) ? decryptSecret(station.pat) : station.pat; if (!pat.trim()) throw new Error(); }
    catch { failed++; console.log(`${station.owner}/${station.repo}: failed; credential cannot be opened.`); continue; }
    const result = await redactStationPublicMetadata(station, { apply, origins, environmentOrigins: [process.env.WEB_URL ?? "", process.env.WEB_FALLBACK_URL ?? "", process.env.WORKER_FALLBACK_URL ?? ""], request: metadataRequest(pat) });
    changedFields += result.changedFields;
    writes += result.writes;
    if (result.status === "failed") failed++;
    console.log(`${result.slug}: ${result.status}; fields=${result.changedFields}; writes=${result.writes}${result.note ? `; ${result.note}` : ""}`);
  }
  console.log(`Summary: repositories=${stations.length}; changedFields=${changedFields}; writes=${writes}; failed=${failed}.`);
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error: unknown) => { console.error(error instanceof MetadataError ? error.message : "Metadata cleanup could not start; private details were not logged."); process.exitCode = 1; });
}
