import { z } from "zod";
import { createOllamaChatClient } from "./ollamaChat";
import { getAppSettings } from "./settings";

const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  bio: z.string().trim().min(1).max(160),
  company: z.enum(["", "Independent"]),
  location: z.enum(["", "Remote"]),
  blog: z.literal(""),
});

function oneJsonObject(raw: string): unknown {
  const text = raw.trim().replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/i, "");
  try { return JSON.parse(text); } catch { /* fall through */ }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("profile JSON missing");
  return JSON.parse(text.slice(start, end + 1));
}

async function githubPatchProfile(
  pat: string,
  profile: z.infer<typeof profileSchema>,
  deadlineAt: number,
): Promise<void> {
  const remaining = deadlineAt - Date.now();
  if (remaining < 1000) throw new Error("profile deadline expired");
  const response = await fetch("https://api.github.com/user", {
    method: "PATCH",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(Math.min(20_000, remaining)),
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "jarvis-profile-enricher",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(profile),
  });
  await response.body?.cancel();
  if (response.status !== 200) throw new Error(`profile update HTTP ${response.status}`);
}

/**
 * Làm profile GitHub mới bớt trống bằng một bộ mô tả NHẤT QUÁN do model viết.
 *
 * Không bịa công ty/địa điểm thật: company chỉ "Independent", location chỉ "Remote", website để
 * trống. Mục tiêu là một profile dev gọn gàng chứ không mạo danh một con người hay tổ chức có thật.
 *
 * GitHub REST/PAT không có API upload avatar. Vì vậy avatar là warning cố định, không giả thành công.
 */
export async function enrichNewGithubProfile(options: {
  pat: string;
  login: string;
  deadlineAt: number;
}): Promise<string[]> {
  const warnings: string[] = [];
  try {
    const settings = await getAppSettings({ deadlineAt: options.deadlineAt });
    const ownedStations = settings.githubStations.filter(
      (station) => station.owner.toLowerCase() === options.login.toLowerCase(),
    );
    // Profile enrichment is for a NEW GitHub account. Adding another station later must never
    // rewrite an established public profile just because the same PAT owns one more repo.
    if (ownedStations.length > 1) return [];
    const languages = ownedStations
      .flatMap((station) => station.companionRepos.map((repo) => repo.language).filter(Boolean))
      .slice(-8);

    const client = createOllamaChatClient({
      config: settings.githubNurture,
      deadlineAt: options.deadlineAt,
      outputTokens: 320,
      maxResponseBytes: 12_000,
      requestTimeoutMs: 25_000,
    });
    const reply = await client.request([
      {
        role: "system",
        content:
          "Create one concise public GitHub profile for a pseudonymous independent software developer. " +
          "Do not impersonate any real person, employer, company, school, or location. " +
          "Return exactly one JSON object with keys name,bio,company,location,blog. " +
          "company must be either Independent or empty; location must be Remote or empty; blog must be empty. " +
          "Make the bio natural and specific to software building, 50-140 characters, no emojis, no unverifiable awards/history.",
      },
      {
        role: "user",
        content: JSON.stringify({
          githubLogin: options.login,
          recentProjectLanguages: languages,
          nonce: Math.floor(Math.random() * 1_000_000),
        }),
      },
    ], { temperature: 0.9 });

    const profile = profileSchema.parse(oneJsonObject(reply.content));
    await githubPatchProfile(options.pat, profile, options.deadlineAt);
  } catch {
    warnings.push("Kho đã tạo nhưng chưa cập nhật được bio/profile GitHub bằng Ollama; có thể chạy lại sau.");
  }

  warnings.push("Avatar GitHub chưa đổi tự động: API PAT chính thức không hỗ trợ upload avatar, nên hệ thống giữ avatar hiện tại/default.");
  return warnings;
}
