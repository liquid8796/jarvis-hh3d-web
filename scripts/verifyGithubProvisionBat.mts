/** Run the real Windows launcher against an inert npm shim, without SSH or GitHub calls. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

if (process.platform !== "win32") {
  console.log("SKIP: real cmd.exe launcher test runs on Windows.");
} else {
  const root = process.cwd();
  const directory = mkdtempSync(path.join(realpathSync(tmpdir()), "github-bat-fixture-"));
  const argsFile = path.join(directory, "arguments.txt");
  writeFileSync(path.join(directory, "npm.cmd"), [
    "@echo off", 'if not "%GITHUB_PAT%"=="fixture-pat-for-bat-test" exit /b 19',
    '> "%BAT_FIXTURE_ARGS%" echo %*', "exit /b %BAT_FIXTURE_EXIT%", "",
  ].join("\r\n"));
  let cases = 0;
  try {
    for (const entry of [
      { input: ["", "", ""], exit: 0, name: null, workflow: "linh-su.yml", daily: "5" },
      { input: ["console-kit", "nightly.yaml", "0"], exit: 0, name: "console-kit", workflow: "nightly.yaml", daily: "0" },
      { input: ["console-kit", "nightly.yaml", "24"], exit: 7, name: "console-kit", workflow: "nightly.yaml", daily: "24" },
      { input: ["", "", ""], exit: 9, name: null, workflow: "linh-su.yml", daily: "5" },
    ]) {
      rmSync(argsFile, { force: true });
      const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn("cmd.exe", ["/d", "/c", `call "${path.join(root, "new-github-khoiloi.bat")}" --no-pause`], {
          cwd: root, windowsHide: true, windowsVerbatimArguments: true, stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, PATH: `${directory};${process.env.PATH ?? ""}`, GITHUB_PAT: "fixture-pat-for-bat-test", BAT_FIXTURE_ARGS: argsFile, BAT_FIXTURE_EXIT: String(entry.exit) },
        });
        let stdout = "", stderr = "", step = 0;
        const prompts = ["Repository [random]:", "Workflow [linh-su.yml]:", "Daily pushes [5]:"];
        const timer = setTimeout(() => { child.kill(); reject(Error("Launcher prompt timed out")); }, 20_000);
        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
          // cmd's SET /P consumes a buffered read, so answer each actual prompt individually.
          while (step < prompts.length && stdout.includes(prompts[step])) child.stdin.write(entry.input[step++] + "\r\n");
          if (step === prompts.length && !child.stdin.writableEnded) child.stdin.end();
        });
        child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
        child.on("error", error => { clearTimeout(timer); reject(error); });
        child.on("close", status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
      });
      assert.equal(result.status, entry.exit, `batch exit code: ${result.stdout} ${result.stderr}`);
      assert(existsSync(argsFile), "inert npm shim was called");
      const args = readFileSync(argsFile, "utf8");
      assert(args.includes(`--workflow-file "${entry.workflow}"`), args);
      assert(args.includes(`--daily-pushes "${entry.daily}"`), args);
      assert.equal(args.includes("--repo "), entry.name !== null);
      if (entry.name) assert(args.includes(`--repo "${entry.name}"`));
      assert(!args.includes("fixture-pat-for-bat-test"));
      cases++;
    }
    console.log(`PASS: ${cases} real BAT runs verify Enter defaults, custom workflow, daily limits, secret environment and exit-code propagation; no network.`);
  } finally {
    const resolved = realpathSync(directory);
    assert.equal(path.dirname(resolved), realpathSync(tmpdir()));
    assert(path.basename(resolved).startsWith("github-bat-fixture-"));
    rmSync(resolved, { recursive: true, force: true });
  }
}
