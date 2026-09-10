"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/permissions";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secretBox";
import { mutateGithubState } from "@/lib/services/companionState";
import { deleteManagedCompanion } from "@/lib/services/companionNurture";
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
  model: string;
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
  }>;
};

export type GithubStationDetailView = {
  station: StationView;
  defaultCompanionCount: number;
  effectiveCompanionCount: number;
};

async function requireManage() {
  const viewer = await requireAdmin();
  if (!hasPermission(viewer, "github_station.manage")) {
    throw new Error("Chỉ Gia chủ mới quản lý được kho GitHub và API key Ollama.");
  }
}

function safeView(config: AppSettings["githubNurture"]): GithubNurtureView {
  return {
    defaultCompanionCount: config.defaultCompanionCount,
    model: config.model,
    contextWindow: config.contextWindow,
    webSearchEnabled: config.webSearchEnabled ?? DEFAULT_WEB_SEARCH_ENABLED,
    searxngBaseUrl: config.searxngBaseUrl ?? DEFAULT_SEARXNG_BASE_URL,
    apiKeys: config.apiKeys.map((key) => ({
      id: key.id,
      // Generated labels prevent a legacy label or an upstream error from exposing a key.
      label: `Ollama ${key.id.slice(0, 8)}`,
      maskedKey: "••••••••",
      disabled: key.disabled,
      cooldownUntil: key.cooldownUntil,
      lastUsedAt: key.lastUsedAt,
      health: key.disabled ? "disabled"
        : key.cooldownUntil && Date.parse(key.cooldownUntil) > Date.now() ? "cooldown"
          : key.lastError ? "error" : key.lastUsedAt ? "ready" : "unused",
    })),
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
  const model = String(formData.get("model") ?? "").trim();
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
    Object.assign(settings.githubNurture, { defaultCompanionCount, model, contextWindow }, webSearchSettings);
  });
  refresh();
  return { ok: true, message: "Đã lưu cấu hình Ollama và số kho phụ mặc định." };
}

export async function importGithubNurtureKeysAction(
  _prev: StationResult | null, formData: FormData,
): Promise<StationResult> {
  await requireManage();
  const pasted = String(formData.get("apiKeys") ?? "");
  const file = formData.get("apiKeyFile");
  let imported: string[];
  try {
    if (file && typeof file !== "string" && file.size > MAX_KEY_IMPORT_BYTES) {
      return { ok: false, message: "Tệp API key vượt quá 256 KiB." };
    }
    const uploaded = file && typeof file !== "string" && file.size > 0 ? await file.text() : "";
    imported = [...new Set([...parseOllamaKeyImport(pasted), ...parseOllamaKeyImport(uploaded)])];
  } catch {
    return { ok: false, message: "Không đọc được danh sách API key. Dùng mỗi dòng một key, JSON dạng [\"key\"], hoặc {\"keys\":[{\"key\":\"…\"}]}; tối đa 100 key, 256 KiB, mỗi key 8–512 ký tự không có khoảng trắng." };
  }
  if (imported.length === 0) return { ok: false, message: "Dán danh sách API key hoặc chọn tệp TXT/JSON trước khi nhập." };
  let added = 0;
  try {
    await mutateGithubState((settings) => {
      const known = new Set<string>();
      for (const entry of settings.githubNurture.apiKeys) {
        try { known.add(decryptSecret(entry.secret)); } catch { /* Keep unreadable envelopes for explicit admin deletion. */ }
      }
      const fresh = imported.filter((key) => !known.has(key));
      if (settings.githubNurture.apiKeys.length + fresh.length > MAX_OLLAMA_API_KEYS) {
        throw new Error("key-limit");
      }
      const entries = fresh.map((secret) => {
        const id = randomUUID();
        return {
          id, label: `Ollama ${id.slice(0, 8)}`, secret: encryptSecret(secret),
          disabled: false, cooldownUntil: null, lastUsedAt: null, lastError: "",
        };
      });
      settings.githubNurture.apiKeys.push(...entries);
      added = entries.length;
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error && error.message === "key-limit"
      ? `Sổ chỉ giữ tối đa ${MAX_OLLAMA_API_KEYS} API key. Xoá key không dùng rồi nhập lại.`
      : "Không mã hoá hoặc lưu được API key. Kiểm tra cấu hình ENCRYPTION_KEY của máy chủ rồi thử lại." };
  }
  refresh();
  return { ok: true, message: `Đã mã hoá và thêm ${added} API key; bỏ qua ${imported.length - added} key trùng. Key được kiểm tra khi vòng Ollama sử dụng.` };
}

export async function deleteGithubNurtureKeyAction(
  _prev: StationResult | null, formData: FormData,
): Promise<StationResult> {
  await requireManage();
  const id = String(formData.get("id") ?? "");
  let found = false;
  await mutateGithubState((settings) => {
    found = settings.githubNurture.apiKeys.some((key) => key.id === id);
    settings.githubNurture.apiKeys = settings.githubNurture.apiKeys.filter((key) => key.id !== id);
  });
  refresh();
  return { ok: found, message: found ? "Đã xoá API key khỏi sổ Ollama." : "API key này không còn trong sổ." };
}

export async function setGithubNurtureKeyDisabledAction(
  _prev: StationResult | null, formData: FormData,
): Promise<StationResult> {
  await requireManage();
  const id = String(formData.get("id") ?? "");
  const disabled = formData.get("disabled") === "true";
  let found = false;
  await mutateGithubState((settings) => {
    const key = settings.githubNurture.apiKeys.find((entry) => entry.id === id);
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
