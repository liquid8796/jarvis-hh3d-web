#!/usr/bin/env node
/**
 * Reconcile missing companion repositories through the configured Ollama runtime.
 *
 * npm run github:companions:backfill -- --dry-run
 * npm run github:companions:backfill -- --repo owner/repo
 *
 * Dry-run reads only the application settings and prints counts. It never decrypts a PAT,
 * calls GitHub/Ollama/control APIs, stages projects, or writes settings. Live runs reuse the
 * same model validation, repository publication, and persistence path as the companion cron.
 */
import { appDatabaseUrl } from "./activeStationPg.mts";
import { planStations } from "./companionBackfillPlan.mjs";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const arg = (name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  return at > -1 && argv[at + 1] && !argv[at + 1].startsWith("--") ? argv[at + 1] : undefined;
};
const onlyRepo = arg("repo") ?? null;
const RUN_BUDGET_MS = 120_000;

async function main(): Promise<void> {
  if (argv.includes("--help")) {
    console.log("Bù kho phụ bằng Ollama đã cấu hình trong tab Kho GitHub.\n" +
      "  --dry-run          chỉ đọc sổ và in số kho còn thiếu; không gọi GitHub/Ollama\n" +
      "  --repo owner/repo  giới hạn một trạm (cũng nhận tên repo nếu không trùng)\n" +
      "Mỗi lượt tối đa 120 giây; chạy lại hoặc để cron tiếp tục nếu vẫn còn thiếu.");
    return;
  }
  if (argv.includes("--repo") && !onlyRepo) throw new Error("Cờ --repo cần một tên kho hoặc owner/repo.");

  // Resolve the authoritative app database before importing its lazily initialized client.
  process.env.DATABASE_URL = appDatabaseUrl();
  const { getAppSettings } = await import("../src/lib/services/settings");
  const settings = await getAppSettings();
  const plan = planStations(settings.githubStations, onlyRepo, settings.githubNurture.defaultCompanionCount);
  if (plan.error) throw new Error(plan.error);
  const missing = plan.targets.reduce((total, target) => total + target.need, 0);
  console.log(
    `\n── Bù kho phụ bằng Ollama ${dryRun ? "· XEM TRƯỚC" : ""}\n` +
    `  model       ${settings.githubNurture.model}\n` +
    `  mặc định    ${settings.githubNurture.defaultCompanionCount} kho phụ/trạm\n` +
    `  cần bù      ${missing} kho phụ của ${plan.targets.length} trạm\n`,
  );
  for (const target of plan.targets) {
    console.log(`  ↻ ${target.slug}: hiện có ${target.have}, mục tiêu ${target.target}, còn thiếu ${target.need}`);
  }
  for (const skipped of plan.skipped) {
    console.log(`  = ${skipped.slug}: ${skipped.reason}`);
  }

  if (dryRun) {
    console.log("\n--dry-run: chỉ đọc cấu hình. KHÔNG gọi GitHub/Ollama, KHÔNG tạo repo, KHÔNG ghi sổ.");
    return;
  }
  if (missing === 0) {
    console.log("\nKhông có kho phụ cần bù.");
    return;
  }
  if (!process.env.ENCRYPTION_KEY) throw new Error("Thiếu ENCRYPTION_KEY — không giải mã được PAT/API key trong sổ.");

  // Import only after the dry-run exit: there is no template generator or alternative provider.
  const { runLlmCompanionNurture } = await import("../src/lib/services/companionNurture");
  const deadlineAt = Date.now() + RUN_BUDGET_MS;
  let failed = 0;
  for (const target of plan.targets) {
    if (Date.now() >= deadlineAt) {
      console.log("\nĐã hết ngân sách 120 giây; phần còn thiếu sẽ tiếp tục ở lượt sau.");
      break;
    }
    const result = await runLlmCompanionNurture({ stationSlug: target.slug, deadlineAt });
    failed += result.failed;
    console.log(`\n  ${target.slug}: đã xét ${result.checked}, đã push ${result.pushed}, ` +
      `hoàn tất ${result.completed}, lỗi ${result.failed}, bỏ qua ${result.skipped}`);
    for (const row of result.results) {
      if (!row.ok) console.log(`    ✖ ${row.note}`);
    }
  }

  // Report observed persisted repository counts rather than treating a model response as success.
  const fresh = await getAppSettings();
  const remaining = planStations(fresh.githubStations, onlyRepo, fresh.githubNurture.defaultCompanionCount);
  if (remaining.error) throw new Error(remaining.error);
  const stillMissing = remaining.targets.reduce((total, target) => total + target.need, 0);
  console.log(`\nCòn thiếu ${stillMissing} kho phụ theo cấu hình hiện tại. Số lỗi runtime: ${failed}.`);
  if (stillMissing > 0) {
    console.log("Chạy lại lệnh này hoặc để cron tiếp tục. Nếu có lỗi Ollama/PAT, sửa cấu hình trước khi chạy lại.");
  }
  if (failed > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(`\n✖ ${err instanceof Error ? err.message : "Không hoàn tất được lượt bù kho phụ."}`);
  process.exitCode = 1;
});
