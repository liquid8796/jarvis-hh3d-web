#!/usr/bin/env node
import { loadEnv } from "./loadEnv.mjs";
import {
  parseGithubRepositoryVisibility,
  previewGithubCompanionPromotion,
  promoteGithubCompanionToPrimary,
} from "../src/lib/services/githubPrimaryPromotion";

loadEnv();

const argv = process.argv.slice(2);
const valueOf = (name: string): string | undefined => {
  const index = argv.indexOf("--" + name);
  const value = argv[index + 1];
  return index >= 0 && value && !value.startsWith("--") ? value.trim() : undefined;
};
const station = valueOf("station") ?? "";
const repo = valueOf("repo") ?? "";
const visibility = parseGithubRepositoryVisibility(valueOf("visibility") ?? "keep");
const dryRun = argv.includes("--dry-run");

if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(station)) {
  console.error("--station phải có dạng owner/repo-chinh-hien-tai.");
  process.exit(2);
}
if (!/^[A-Za-z0-9_.-]{1,100}$/.test(repo) || repo === "." || repo === "..") {
  console.error("--repo phải là tên repo phụ hợp lệ trong station.");
  process.exit(2);
}
if (!visibility) {
  console.error("--visibility chỉ nhận keep, public hoặc private.");
  process.exit(2);
}

try {
  const preview = await previewGithubCompanionPromotion(station, repo, { visibility });
  console.log("\nKẾ HOẠCH PROMOTE");
  console.log("  station hiện tại : " + preview.oldSlug);
  console.log("  repo được chọn    : " + preview.newSlug);
  console.log("  quyền hiện tại    : " + preview.currentVisibility);
  console.log("  quyền sau promote : " + preview.desiredVisibility);
  console.log("  repo chính cũ     : " + (preview.oldPrimaryRepo ?? "không có — station đang hoãn primary"));
  console.log("  source dự án      : GIỮ NGUYÊN; chỉ thêm/cập nhật workflow khôi lỗi");

  if (dryRun) {
    console.log("\n--dry-run: chưa thay đổi GitHub hoặc sổ station.");
    process.exit(0);
  }

  const result = await promoteGithubCompanionToPrimary(station, repo, { visibility });
  for (const warning of result.warnings) console.warn("CẢNH BÁO: " + warning);
  if (!result.ok) {
    console.error("\nPROMOTE THẤT BẠI: " + result.message);
    process.exit(1);
  }
  console.log("\nPROMOTE THÀNH CÔNG: " + result.message);
  console.log("  station mới       : " + result.newSlug);
  console.log("  quyền repo mới    : " + (result.visibility ?? preview.desiredVisibility));
} catch {
  console.error("Không đọc hoặc promote được repo. Kiểm tra station/repo, PAT, WORKER_TOKEN và kết nối GitHub rồi thử lại.");
  process.exit(1);
}
