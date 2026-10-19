"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/permissions";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secretBox";
import { mutateGithubState } from "@/lib/services/companionState";
import { deleteManagedCompanion } from "@/lib/services/companionNurture";
import { parseGithubRepositoryVisibility, promoteGithubCompanionToPrimary } from "@/lib/services/githubPrimaryPromotion";
import { getAppSettings, type AppSettings } from "@/lib/services/settings";
import { githubStationsForAdmin, type StationResult, type StationView } from "@/app/actions/githubStations";
import { stationSlug } from "@/lib/validation/githubStations";
import {
  effectiveCompanionCount,
  MAX_KEY_IMPORT_BYTES,
  MAX_OLLAMA_API_KEYS,
  MIN_OLLAMA_CONTEXT_WINDOW,
  MAX_OLLAMA_CONTEXT_WINDOW,
  parseCompanionCount,
  parseOllamaKeyImport,
  DEFAULT_WEB_SEARCH_ENABLED,
  DEFAULT_SEARXNG_BASE_URL,
  parseWebSearchSettings,
} from "@/lib/validation/githubNurture";

export type GithubNurtureView = {
  defaultCompanionCount: number;
  provider: "ollama" | "reflection";
  model: string;
  reflectionModel: string;
  contextWindow: number;
  webSearchEnabled?: boolean;
  searxngBaseUrl?: string;
  apiKeys: Array<{
    id: string;
    label: string;
    maskedKey: string;
    disabled: boolean;
    cooldownUntil: string | null;
    lastUsedAt: string | null;
    health: "disabled" | "cooldown" | "error" | "ready" | "unused";
    errorDetail: string | null;
  }>;
  reflectionApiKeys: GithubNurtureView["apiKeys"];
};

export type GithubStationDetailView = {
  station: StationView;
  defaultCompanionCount: number;
  effectiveCompanionCount: number;
};

async function requireManage() {
  const viewer = await requireAdmin();
  if (!hasPermission(viewer, "github_station.manage")) {
    throw new Error("Chỉ Gia chủ mới quản lý được kho GitHub và API key AI.");
  }
}

/**
 * Expose only adapter-owned diagnostic categories to authorized administrators.
 * Never forward arbitrary provider response text, secret values or stored payloads.
 */
function safeKeyError(error: string): string | null {
  if (!error) return null;
  const status = /^Reflection HTTP error (400|404|409|413|415|422|500|502|503|504)$/.exec(error);
  if (status) return "Reflection HTTP " + status[1];
  const detailed = /^Reflection HTTP ([0-9]{3}) \(([a-z][a-z0-9_]{1,60})(?:; ([^)]+))?\)$/.exec(error);
  if (detailed && (!detailed[3] || (detailed[3].length <= 100 && /^[A-Za-z_]/.test(detailed[3]) &&
      [...detailed[3]].every(char => char === "[" || char === "]" || /^[A-Za-z0-9_.-]$/.test(char)))))
    return "Reflection HTTP " + detailed[1] + " — " + detailed[2] + (detailed[3] ? " · " + detailed[3] : "");
  const messages: Record<string, string> = {
    "Reflection request timed out.": "Reflection: request timeout.",
    "Reflection request could not reach provider.": "Reflection: lỗi kết nối tới provider.",
    "Reflection invalid response JSON.": "Reflection: response JSON không hợp lệ.",
    "Reflection returned no usable response.": "Reflection: response trống hoặc chưa hoàn tất.",
    "Reflection response too large.": "Reflection: response vượt giới hạn.",
    "Reflection quota exhausted.": "Reflection: hết credit/quota.",
    "Reflection rate limit reached.": "Reflection: bị giới hạn tốc độ (429).",
    "Reflection authentication rejected key.": "Reflection: xác thực/tài khoản bị từ chối (401/403).",
    "Unable to decrypt Reflection key.": "Reflection: không giải mã được khóa.",
    "Empty Reflection key.": "Reflection: khóa trống.",
  };
  return messages[error] ?? "Không thể xác định chi tiết từ lỗi cũ.";
}

function safeView(config: AppSettings["githubNurture"]): GithubNurtureView {
  const mapKeys = (keys: AppSettings["githubNurture"]["apiKeys"], name: string) =>
    keys.map((key) => ({
      id: key.id, label: name + " " + key.id.slice(0, 8), maskedKey: "••••••••",
      disabled: key.disabled, cooldownUntil: key.cooldownUntil, lastUsedAt: key.lastUsedAt,
      errorDetail: name === "Reflection" ? safeKeyError(key.lastError) : null,
      health: (key.disabled ? "disabled" : key.cooldownUntil && Date.parse(key.cooldownUntil) > Date.now() ? "cooldown"
          : key.lastError ? "error" : key.lastUsedAt ? "ready" : "unused") as GithubNurtureView["apiKeys"][number]["health"],
    }));
  return {
    defaultCompanionCount: config.defaultCompanionCount,
    provider: config.provider ?? "ollama",
    model: config.model,
    reflectionModel: config.reflectionModel ?? "Beam-1.0-501B-A23B",
    contextWindow: config.contextWindow,
    webSearchEnabled: config.webSearchEnabled ?? DEFAULT_WEB_SEARCH_ENABLED,
    searxngBaseUrl: config.searxngBaseUrl ?? DEFAULT_SEARXNG_BASE_URL,
    apiKeys: mapKeys(config.apiKeys, "Ollama"),
    reflectionApiKeys: mapKeys(config.reflectionApiKeys ?? [], "Reflection"),
  };
}

function refresh(slug?: string) {
  revalidatePath("/admin");
  if (slug) {
    const [owner, repo] = slug.split("/");
    revalidatePath(`/admin/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  } else {
    revalidatePath("/admin/github/[owner]/[repo]", "page");
  }
}

export async function githubNurtureForAdmin(): Promise<GithubNurtureView> {
  await requireManage();
  return safeView((await getAppSettings()).githubNurture);
}

export async function githubStationDetailForAdmin(slug: string): Promise<GithubStationDetailView | null> {
  await requireManage();
  const [stations, settings] = await Promise.all([githubStationsForAdmin(), getAppSettings()]);
  const station = stations.find((entry) => entry.slug.toLowerCase() === slug.toLowerCase());
  if (!station) return null;
  return {
    station,
    defaultCompanionCount: settings.githubNurture.defaultCompanionCount,
    effectiveCompanionCount: effectiveCompanionCount(station, settings.githubNurture),
  };
}

export async function saveGithubNurtureSettingsAction(
  _prev: StationResult | null, formData: FormData,
): Promise<StationResult> {
  await requireManage();
  let defaultCompanionCount: number;
  try {
    defaultCompanionCount = parseCompanionCount(String(formData.get("defaultCompanionCount") ?? ""))!;
  } catch {
    return { ok: false, message: "Số kho phụ mặc định phải là số nguyên từ 0 đến 20." };
  }
  const provider = formData.get("provider") === "reflection" ? "reflection" : "ollama";
  const model = String(formData.get("model") ?? "").trim();
  const reflectionModel = String(formData.get("reflectionModel") ?? "Beam-1.0-501B-A23B").trim();
  if (!reflectionModel || reflectionModel.length > 200 || /[\r\n\x00-\x1f]/.test(reflectionModel))
    return { ok:false, message:"Model Reflection không hợp lệ." };
  const rawContext = String(formData.get("contextWindow") ?? "").trim();
  const contextWindow = Number(rawContext);
  if (!model || model.length > 200 || /[\r\n\x00-\x1f]/.test(model)) {
    return { ok: false, message: "Nhập tên model Ollama từ 1 đến 200 ký tự trên một dòng." };
  }
  if (!/^\d+$/.test(rawContext) || !Number.isSafeInteger(contextWindow)
    || contextWindow < MIN_OLLAMA_CONTEXT_WINDOW || contextWindow > MAX_OLLAMA_CONTEXT_WINDOW) {
    return { ok: false, message: `Context window phải là số nguyên từ ${MIN_OLLAMA_CONTEXT_WINDOW} đến ${MAX_OLLAMA_CONTEXT_WINDOW}.` };
  }
  // The marker distinguishes an unchecked checkbox from a form rendered before search
  // settings existed. Old forms must not silently switch off an existing configuration.
  let webSearchSettings: ReturnType<typeof parseWebSearchSettings>;
  try { webSearchSettings = parseWebSearchSettings(formData); }
  catch { return { ok: false, message: "SearXNG cần URL HTTPS công khai, không chứa tài khoản, query, fragment, cổng riêng hay địa chỉ nội bộ. Instance phải bật kết quả JSON." }; }
  await mutateGithubState((settings) => {
    Object.assign(settings.githubNurture, { defaultCompanionCount, provider, model, reflectionModel, contextWindow }, webSearchSettings);
  });
  refresh();
  return { ok: true, message: "Đã lưu provider, model và số kho phụ mặc định." };
}

export async function importGithubNurtureKeysAction(
  _prev: StationResult | null, formData: FormData,
): Promise<StationResult> {
  await requireManage();
  const provider = formData.get("provider") === "reflection" ? "reflection" : "ollama";
  const pasted = String(formData.get("apiKeys") ?? "");
  const file = formData.get("apiKeyFile");
  let imported: string[];
  try {
    if (file && typeof file !== "string" && file.size > MAX_KEY_IMPORT_BYTES) {
      return { ok: false, message: "Tệp API key vượt quá 256 KiB." };
    }
    const uploaded = file && typeof file !== "string" && file.size > 0 ? await file.text() : "";
    imported = [...new Set([...parseOllamaKeyImport(pasted, provider === "reflection" ? 4096 : 512),
      ...parseOllamaKeyImport(uploaded, provider === "reflection" ? 4096 : 512)])];
  } catch {
    return { ok: false, message: "Không đọc được danh sách API key. Dùng mỗi dòng một key, JSON dạng [\"key\"], hoặc {\"keys\":[{\"key\":\"…\"}]}; tối đa 100 key, 256 KiB, mỗi key Ollama tối đa 512 ký tự, Reflection tối đa 4096 ký tự." };
  }
  if (imported.length === 0) return { ok: false, message: "Dán danh sách API key hoặc chọn tệp TXT/JSON trước khi nhập." };
  let added = 0;
  try {
    await mutateGithubState((settings) => {
      const known = new Set<string>();
      const collection = provider === "reflection" ? (settings.githubNurture.reflectionApiKeys ??= []) : settings.githubNurture.apiKeys;
      for (const entry of collection) {
        try { known.add(decryptSecret(entry.secret)); } catch { /* Keep unreadable envelopes for explicit admin deletion. */ }
      }
      const fresh = imported.filter((key) => !known.has(key));
      if (collection.length + fresh.length > MAX_OLLAMA_API_KEYS) {
        throw new Error("key-limit");
      }
      const entries = fresh.map((secret) => {
        const id = randomUUID();
        return {
          id, label: (provider === "reflection" ? "Reflection " : "Ollama ") + id.slice(0, 8), secret: encryptSecret(secret),
          disabled: false, cooldownUntil: null, lastUsedAt: null, lastError: "",
        };
      });
      collection.push(...entries);
      added = entries.length;
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error && error.message === "key-limit"
      ? `Sổ chỉ giữ tối đa ${MAX_OLLAMA_API_KEYS} API key. Xoá key không dùng rồi nhập lại.`
      : "Không mã hoá hoặc lưu được API key. Kiểm tra cấu hình ENCRYPTION_KEY của máy chủ rồi thử lại." };
  }
  refresh();
  return { ok: true, message: `Đã mã hoá và thêm ${added} API key; bỏ qua ${imported.length - added} key trùng. Key được kiểm tra khi provider được chọn sử dụng.` };
}

/**
 * Fetch a single Ollama key only after an explicit click by a permitted admin.
 * Never include decrypted values in initial page props, settings views or logs.
 * Next.js server actions use POST and are authorized on every invocation.
 */
export async function revealGithubNurtureKeyAction(
  id: string,
  provider: "ollama" | "reflection" = "ollama",
): Promise<{ ok: true; key: string } | { ok: false; message: string }> {
  await requireManage();
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { ok: false, message: "Mã API key không hợp lệ." };
  }
  const config = (await getAppSettings()).githubNurture;
  const entry = (provider === "reflection" ? config.reflectionApiKeys ?? [] : config.apiKeys).find((key) => key.id === id);
  if (!entry) return { ok: false, message: "API key không còn trong danh sách." };
  try {
    const plain = decryptSecret(entry.secret);
    if (!plain) throw new Error("empty-key");
    return { ok: true, key: plain };
  } catch {
    // Do not disclose encrypted content, crypto errors or secrets in responses.
    return { ok: false, message: "Không thể giải mã API key. Kiểm tra ENCRYPTION_KEY của máy chủ." };
  }
}

export async function deleteGithubNurtureKeyAction(
  _prev: StationResult | null, formData: FormData,
): Promise<StationResult> {
  await requireManage();
  const id = String(formData.get("id") ?? "");
  const provider = formData.get("provider") === "reflection" ? "reflection" : "ollama";
  let found = false;
  await mutateGithubState((settings) => {
    const field = provider === "reflection" ? "reflectionApiKeys" : "apiKeys";
    const collection = settings.githubNurture[field] ?? [];
    found = collection.some((key) => key.id === id);
    settings.githubNurture[field] = collection.filter((key) => key.id !== id);
  });
  refresh();
  return { ok: found, message: found ? "Đã xoá API key khỏi sổ provider." : "API key này không còn trong sổ." };
}

export async function setGithubNurtureKeyDisabledAction(
  _prev: StationResult | null, formData: FormData,
): Promise<StationResult> {
  await requireManage();
  const id = String(formData.get("id") ?? "");
  const provider = formData.get("provider") === "reflection" ? "reflection" : "ollama";
  const disabled = formData.get("disabled") === "true";
  let found = false;
  await mutateGithubState((settings) => {
    const collection = provider === "reflection" ? settings.githubNurture.reflectionApiKeys ?? [] : settings.githubNurture.apiKeys;
    const key = collection.find((entry) => entry.id === id);
    if (!key) return;
    key.disabled = disabled;
    found = true;
  });
  refresh();
  return { ok: found, message: found ? (disabled ? "Đã tạm tắt API key." : "Đã bật API key; thời gian chờ hiện tại vẫn được giữ.") : "API key này không còn trong sổ." };
}

export async function saveGithubCompanionSettingsAction(
  _prev: StationResult | null, formData: FormData,
): Promise<StationResult> {
  await requireManage();
  const slug = String(formData.get("slug") ?? "");
  let override: number | null;
  try { override = parseCompanionCount(String(formData.get("companionCountOverride") ?? ""), true); }
  catch { return { ok: false, message: "Để trống để dùng mặc định chung, hoặc nhập số nguyên từ 0 đến 20." }; }
  let found = false;
  await mutateGithubState((settings) => {
    const station = settings.githubStations.find((entry) => stationSlug(entry) === slug);
    if (!station) return;
    station.companionCountOverride = override;
    station.allowCompanionFork = formData.get("allowCompanionFork") === "on";
    station.allowCompanionDelete = formData.get("allowCompanionDelete") === "on";
    found = true;
  });
  refresh(slug);
  return { ok: found, message: found ? "Đã lưu cấu hình riêng của kho. Giảm số lượng không tự xoá repo; quyền xoá chỉ áp dụng cho quyết định tiếp theo của model." : "Kho này không còn trong sổ." };
}

export async function promoteGithubCompanionAction(
  _prev: StationResult | null, formData: FormData,
): Promise<StationResult> {
  await requireManage();
  const slug = String(formData.get("slug") ?? "");
  const repo = String(formData.get("repo") ?? "");
  const visibility = parseGithubRepositoryVisibility(formData.get("visibility") ?? "keep");
  if (!slug || !repo) return { ok: false, message: "Thiếu định danh kho cần promote." };
  if (!visibility) return { ok: false, message: "Quyền truy cập repo phải là giữ nguyên, public hoặc private." };

  const result = await promoteGithubCompanionToPrimary(slug, repo, { visibility });
  if (!result.ok || !result.newSlug) {
    return {
      ok: false,
      message: [result.message, ...result.warnings].filter(Boolean).join(" "),
    };
  }

  refresh(result.oldSlug);
  refresh(result.newSlug);
  const [owner, nextRepo] = result.newSlug.split("/");
  redirect(`/admin/github/${encodeURIComponent(owner)}/${encodeURIComponent(nextRepo)}`);
}

export async function deleteGithubCompanionAction(
  _prev: StationResult | null, formData: FormData,
): Promise<StationResult> {
  await requireManage();
  const slug = String(formData.get("slug") ?? "");
  const repo = String(formData.get("repo") ?? "");
  if (formData.get("confirmedRepo") !== repo || !repo) {
    return { ok: false, message: "Nhập đúng tên kho phụ để xác nhận xoá vĩnh viễn." };
  }
  try {
    await deleteManagedCompanion(slug, repo);
  } catch {
    // GitHub response bodies may include sensitive credentials or request details.
    return { ok: false, message: "Không xoá được kho phụ. Kiểm tra kho còn được đăng ký, PAT có quyền xoá repo và vòng nuôi không đang xử lý kho này, rồi thử lại." };
  }
  refresh(slug);
  return { ok: true, message: `Đã xoá vĩnh viễn kho phụ ${repo}. Nếu thiếu số lượng đã cấu hình, model có thể tự tạo kho thay thế ở vòng tiếp theo.` };
}
