/** Child-only payload staging: synchronous source adapters never block the Next process. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildWorkflowOnlyPayload, filesystemPayloadSource, gitHeadPayloadSource } from "./khoiloiPayload.mjs";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
try {
  const { root, directory, workerId, workflowFile, sourceMode = "filesystem" } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const source = sourceMode === "git-head" ? gitHeadPayloadSource(root) : sourceMode === "filesystem" ? filesystemPayloadSource(root) : null;
  if (!source) throw Error("unknown payload source");
  const files = buildWorkflowOnlyPayload({
    source,
    workerId,
    workflowFile,
    webUrl: "https://158.180.59.36.sslip.io",
  });
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
