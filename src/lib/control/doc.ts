import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Bảng điều phối gương trạm — LÕI THUẦN: hình dạng, chữ ký, và phép quyết định chuyển hướng.
 *
 * Tệp này cố ý KHÔNG import SDK nào (không @aws-sdk, không db): middleware nuốt nó vào bundle
 * chạy trên mọi request, nên nó phải nhẹ như một chiếc lá. Phần đọc-qua-mạng nằm ở read.ts;
 * phần ghi (cần S3 SDK) nằm ở scripts/mirrorControl.mts cho tới khi trang admin cần (phase 3).
 *
 * Toàn cảnh hệ gương trạm: deploy/mirror/README.md. Tóm tắt phần bảng: một JSON duy nhất trên
 * OCI Object Storage (mảnh đất không đổi chủ) nói "trạm nào đang hoạt động"; mọi trạm và VM
 * khôi lỗi poll nó; trạm thấy mình KHÔNG phải trạm hoạt động thì chuyển hướng người dùng sang
 * trạm đang hoạt động.
 */

/** Key của bảng trong bucket media — cạnh `chat/`, `backdrop/` của tàng khố sẵn có. */
export const CONTROL_DOC_KEY = "control/site.json";

/** Trần tuổi cache một lượt đọc — cũng là trần độ trễ lan truyền khi lật trạm. */
export const CONTROL_CACHE_MS = 30_000;

export const controlDocSchema = z.object({
  /**
   * Đơn điệu tăng, và bên đọc chỉ chấp nhận số KHÔNG NHỎ HƠN số đã thấy — hàng rào chống
   * một bản cũ (cache CDN, PUT đua nhau) kéo cả hệ về trạng thái trước.
   */
  revision: z.number().int().positive(),
  /** SITE_ID của trạm đang hoạt động — trùng `id` trong sổ gương của app_settings. */
  activeSiteId: z.string().min(1).max(64),
  /** Gốc URL của trạm ấy. Bắt buộc https tuyệt đối: nó là đích của một cú redirect công khai. */
  activeUrl: z.string().url().startsWith("https://"),
  switchedAt: z.string(),
  switchedBy: z.string(),
  sig: z.string().min(1),
});

export type ControlDoc = z.infer<typeof controlDocSchema>;

/**
 * Chuỗi đem ký — thứ tự trường CỐ ĐỊNH, viết tay từng trường chứ không JSON.stringify cả
 * object: thứ tự khoá của stringify đi theo thứ tự chèn, mà bảng thì đi qua JSON.parse của
 * nhiều phía — trông cùng một object nhưng chuỗi ra khác nhau là chữ ký thành xổ số.
 */
function canonical(doc: Omit<ControlDoc, "sig">): string {
  return JSON.stringify([doc.revision, doc.activeSiteId, doc.activeUrl, doc.switchedAt, doc.switchedBy]);
}

/**
 * Ký bằng HMAC-SHA256, khoá là WORKER_TOKEN — cố ý dùng lại bí mật sẵn có thay vì phát minh
 * khoá mới: mọi bên cần XÁC MINH (các trạm, VM khôi lỗi) đều đã cầm WORKER_TOKEN trong env,
 * và thứ chữ ký này bảo vệ trước hết chính là WORKER_TOKEN — VM đi theo `activeUrl` của bảng
 * và gửi token trong header tới đó, nên một tấm bảng giả là cách rẻ nhất câu trộm token.
 * Bucket đọc công khai; quyền GHI (khoá OCI) là hàng rào thứ nhất, chữ ký là hàng rào thứ hai.
 */
export function signControlDoc(doc: Omit<ControlDoc, "sig">, workerToken: string): ControlDoc {
  const sig = createHmac("sha256", workerToken).update(canonical(doc)).digest("base64url");
  return { ...doc, sig };
}

export function verifyControlDoc(doc: ControlDoc, workerToken: string): boolean {
  const expected = createHmac("sha256", workerToken).update(canonical(doc)).digest("base64url");
  const a = Buffer.from(doc.sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Phân tích + xác minh một payload lạ (từ mạng). Trả null thay vì ném — bên đọc fail-open. */
export function parseControlDoc(raw: unknown, workerToken: string): ControlDoc | null {
  const parsed = controlDocSchema.safeParse(raw);
  if (!parsed.success) return null;
  return verifyControlDoc(parsed.data, workerToken) ? parsed.data : null;
}

// ---------------------------------------------------------------------------------------
// Phép quyết định của middleware — THUẦN, để verify:control bao được từng nhánh.
// ---------------------------------------------------------------------------------------

export type RedirectDecision =
  | { kind: "serve" }
  /** Người dùng thường trên trạm không hoạt động → 307 sang trạm đang hoạt động, giữ path+query. */
  | { kind: "redirect"; location: string }
  /** Khôi lỗi không đi theo redirect mù (POST + Authorization) — trả 409 kèm địa chỉ để nó tự đọc lại bảng. */
  | { kind: "worker-conflict"; activeUrl: string }
  /** Cron của trạm không hoạt động — 204, đừng để hai trạm đua nhau dọn dẹp. */
  | { kind: "cron-skip" };

/**
 * Đường miễn trừ chuyển hướng — admin phải VÀO ĐƯỢC trạm cũ để thao tác và quay lui, nên
 * cửa admin (và cửa đăng nhập dẫn tới nó) không bao giờ bị đá đi. Guard quyền thật vẫn là
 * requireAdmin() phía trong; miễn trừ ở đây chỉ là "không đá", không phải "cho vào".
 */
const EXEMPT_PREFIXES = ["/admin", "/login", "/api/admin"] as const;

export function decideRequest(input: {
  siteId: string | undefined;
  doc: ControlDoc | null;
  pathname: string;
  search: string;
}): RedirectDecision {
  const { siteId, doc, pathname, search } = input;

  // Fail-open có chủ ý, cả hai vế: trạm chưa khai SITE_ID (deploy cũ, máy dev) hay bảng chưa
  // đọc được (bucket nghẽn, chưa init) — thà phục vụ như thường còn hơn cả trạm quỳ theo
  // một biến env thiếu hay một lượt GET hỏng.
  if (!siteId || !doc) return { kind: "serve" };
  if (doc.activeSiteId === siteId) return { kind: "serve" };

  if (pathname === "/api/worker") return { kind: "worker-conflict", activeUrl: doc.activeUrl };
  if (pathname === "/api/cron") return { kind: "cron-skip" };
  if (EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return { kind: "serve" };
  }

  return { kind: "redirect", location: `${doc.activeUrl.replace(/\/$/, "")}${pathname}${search}` };
}
