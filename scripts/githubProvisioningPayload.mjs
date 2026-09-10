/** Child-only payload staging: synchronous source adapters never block the Next process. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildKhoiloiPayload, filesystemPayloadSource, gitHeadPayloadSource, GITHUB_PROVISIONING_LOCK_ARTIFACT_PATH } from "./khoiloiPayload.mjs";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
try {
  const { root, directory, workerId, workflowFile, sourceMode = "filesystem" } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const source = sourceMode === "git-head" ? gitHeadPayloadSource(root) : sourceMode === "filesystem" ? filesystemPayloadSource(root) : null;
  if (!source) throw Error("unknown payload source");
  let lockfile;
  if (sourceMode === "filesystem") {
    // Web requests must use the immutable prebuild artifact and never invoke npm.
    const artifact = JSON.parse(await readFile(path.join(root, GITHUB_PROVISIONING_LOCK_ARTIFACT_PATH), "utf8"));
    const pkg = JSON.parse(source.read("package.json").toString("utf8"));
    if (artifact.schemaVersion !== 1 || artifact.packageVersion !== pkg.version || artifact.lockfile?.version !== pkg.version || artifact.lockfile?.packages?.[""]?.version !== pkg.version) throw Error("stale lock artifact");
    lockfile = Buffer.from(JSON.stringify(artifact.lockfile));
  }
  // CLI git-head mode deliberately omits lockfile: buildKhoiloiPayload generates it from the
  // same committed package bytes. This works in a clean ops clone with no ignored artifact and
  // cannot mix a dirty working-tree version into the staged payload.
  const files = buildKhoiloiPayload({ repoRoot: root, source, workerId, workflowFile, webUrl: "https://158.180.59.36.sslip.io", lockfile });
  for (const [relative, bytes] of files) {
    const target = path.resolve(directory, relative);
    const within = path.relative(directory, target);
    if (within.startsWith("..") || path.isAbsolute(within)) throw Error("payload escape");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "wx" });
  }
} catch {
  process.stderr.write("Payload preparation failed.\n");
  process.exitCode = 1;
}
