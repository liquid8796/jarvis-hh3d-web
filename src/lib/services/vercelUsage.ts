/**
 * MỨC DÙNG VERCEL của một trạm — đọc qua `/v2/usage`, gấp lại thành vài con số người đọc được.
 *
 * VÌ SAO LÀ `/v2/usage`. Đo ngày 11/08/2026 bằng token thật của cả bốn tài khoản (đều hobby):
 *
 *   `/v1/usage`            400 plan_upgrade_required — "only available to Teams on the Pro or
 *                          Enterprise plan". Cửa đóng ở cổng.
 *
 *   `/v1/billing/charges`  404 costs_not_found, trên CẢ 16 lượt thử: 4 tài khoản × 4 cửa sổ
 *                          (30 ngày, tháng 6 và tháng 7 đã chốt, cả một năm). KHÔNG phải lỗi
 *                          tham số — bỏ trống `from` thì nó trả 400 đòi đúng trường ấy, và
 *                          một lượt cửa sổ-một-năm trả 500 `usage_data_fetch_failed`, tức nó
 *                          có chạy vào trong đọc usage thật. Nó đơn giản là endpoint của HOÁ
 *                          ĐƠN: hobby là 0 đồng nên không có bản ghi chi phí nào để trả.
 *
 *   `/v2/usage?type=requests`   200 kèm số liệu thật trên hobby. Đường duy nhất còn mở.
 *
 * ĐÁNG ĐỌC LẠI NGÀY NÀO CÓ TÀI KHOẢN LÊN PRO: schema FOCUS v1.3 của `/v1/billing/charges` mang
 * `ConsumedQuantity` + `ConsumedUnit` (số lượng thật kèm đơn vị, hết cảnh đoán mapping),
 * `ServiceName` (tên meter do chính Vercel đặt — gồm cả Fluid Active CPU, thứ v2 không có), và
 * `Tags.ProjectId` (hẹp được xuống từng project). Tức nó xoá được CẢ HAI lời thú nhận mà tệp
 * này đang phải mang: thiếu meter, và số đo là của cả tài khoản chứ không riêng project.
 *
 * Đừng "nâng cấp" sang v1 mà không đo lại — hôm nay nó 404/400 im lặng và bảng usage hoá trắng.
 *
 * PHẠM VI LÀ CẢ TÀI KHOẢN, không phải một project. Token Vercel không hẹp xuống project được ở
 * endpoint này. Với tông môn thì hai thứ ấy trùng nhau — lệ §9 của deploy/mirror/README.md là
 * mỗi trạm một tài khoản riêng — nhưng nếu ai đó nuôi thêm project khác trong cùng tài khoản
 * thì con số này gộp cả chúng. Giao diện phải nói ra điều đó, đừng để người đọc tự suy.
 */

/** Cửa sổ đọc: 30 ngày, đúng như bảng Usage trên dashboard Vercel. */
const WINDOW_DAYS = 30;

/** Trần chờ một lượt gọi. Đây là một cú bấm trên trang admin, không phải một job nền. */
const TIMEOUT_MS = 12_000;

const GB = 1024 ** 3;

/**
 * Hạn mức gói Hobby, chép từ bảng Usage của chính dashboard (ảnh chụp 11/08/2026).
 *
 * Để ở đây dưới dạng hằng số vì API KHÔNG phát ra hạn mức — nó chỉ trả số đã dùng. Nghĩa là
 * ngày nào Vercel đổi hạn mức, bảng này nói sai cho tới khi có người sửa. Đó là cái giá đã
 * cân nhắc: một cột「đã dùng」trần trụi không trả lời được câu hỏi thật sự cần hỏi —「còn bao
 * xa thì trạm bị cắt」.
 */
export type UsageMetric = {
  key: string;
  label: string;
  /** Đã dùng, theo đơn vị của `unit`. */
  used: number;
  /** Hạn mức gói Hobby, hoặc null khi chỉ số này không có hạn công bố. */
  limit: number | null;
  unit: "bytes" | "count" | "gbHours";
  /** Chỉ số này gộp từ những trường nào của API — để người soi số biết nó từ đâu ra. */
  from: string;
  /**
   * Đã ĐỐI CHIẾU KHỚP với bảng Usage trên dashboard chưa.
   *
   * Trường này tồn tại vì một bài học đắt ngày 11/08/2026: bản đầu đoán mapping theo TÊN
   * TRƯỜNG nghe cho hợp lý, rồi báo động「Function Duration 388,5 GB-Hrs — vượt 389% hạn」
   * trong khi bảng thật ghi Function Duration = 0. Cái tên `function_execution_*_gb_hours`
   * nghe y hệt cột ấy nhưng KHÔNG phải nó.
   *
   * Nên từ nay: chỉ chỉ số nào đã đặt cạnh bảng thật và khớp con số mới được đeo hạn mức và
   * được tô cảnh báo. Còn lại là số thô — vẫn hiện ra vì vẫn có ích, nhưng không dám nói nó
   * là cột nào của Vercel.
   */
  matchesDashboard: boolean;
};

export type VercelUsage =
  | {
      ok: true;
      /** Số NGÀY có số liệu trong cửa sổ — Vercel chỉ phát ra ngày nào có lưu lượng. */
      daysWithData: number;
      /** Mốc `lastUpdate` do chính Vercel khai. */
      lastUpdate: string | null;
      windowDays: number;
      metrics: UsageMetric[];
    }
  | { ok: false; error: string };

/** Một dòng ngày trong `/v2/usage?type=requests`. Chỉ khai những trường thật sự dùng. */
type UsageRow = Record<string, number | string | null | undefined>;

const sum = (rows: UsageRow[], ...fields: string[]): number =>
  rows.reduce(
    (total, row) => total + fields.reduce((n, f) => n + (typeof row[f] === "number" ? (row[f] as number) : 0), 0),
    0,
  );

/**
 * Gấp các dòng-theo-ngày thành bảng chỉ số.
 *
 * Tách khỏi phần gọi mạng để phép thử đóng đinh được phép cộng mà không cần token hay Internet.
 * Mọi nhãn dùng đúng chữ của dashboard Vercel, để người đọc đối chiếu được hai bên bằng mắt.
 */
export function foldUsageRows(rows: UsageRow[]): UsageMetric[] {
  return [
    /**
     * HAI CỘT ĐẦU đã đặt cạnh bảng thật và khớp tới từng nghìn (đo 11/08/2026, tài khoản
     * namcourse): bảng ghi Edge Requests 303K và Function Invocations 317K, API trả
     * `monitoring_metric_count` = 302.835 và `function_invocation_*` = 317.023.
     *
     * Cái tên `monitoring_metric_count` chẳng gợi gì tới Edge Requests, và đó chính là lý do
     * phải ĐỐI CHIẾU chứ không được đọc tên trường mà suy: `request_hit_count +
     * request_miss_count` = 329.186 nghe mới giống「số request」, nhưng bảng thật không có con
     * số nào bằng nó.
     */
    {
      key: "edgeRequests",
      label: "Edge Requests",
      used: sum(rows, "monitoring_metric_count"),
      limit: 1_000_000,
      unit: "count",
      from: "monitoring_metric_count",
      matchesDashboard: true,
    },
    {
      key: "functionInvocations",
      label: "Function Invocations",
      used: sum(
        rows,
        "function_invocation_successful_count",
        "function_invocation_error_count",
        "function_invocation_timeout_count",
        "function_invocation_throttle_count",
      ),
      limit: 1_000_000,
      unit: "count",
      from: "function_invocation_* (successful + error + timeout + throttle)",
      matchesDashboard: true,
    },

    /**
     * PHẦN CÒN LẠI là số thô: có ích để nhìn xu hướng, nhưng KHÔNG khớp cột nào trong bảng
     * thật, nên không đeo hạn mức và không tô cảnh báo.
     *
     *   bandwidth_outgoing_bytes   0,87 GB  ≠  Fast Data Transfer   1,29 GB
     *   bandwidth_incoming_bytes   344 MB   ≠  Fast Origin Transfer 246 MB
     *   function_execution_*_gb_hours 388,5 ≠  Function Duration    0 GB-Hrs
     *
     * Cột cuối là cái bẫy tệ nhất: dưới Fluid compute, Function Duration của gói Hobby đứng
     * yên ở 0 và áp lực thật dồn sang `Fluid Active CPU` với `Fluid Provisioned Memory` — hai
     * meter mà `/v2/usage` KHÔNG phát ra ở bất kỳ `type` nào (đã quét cả 13 loại).
     */
    {
      key: "bandwidthOut",
      label: "Băng thông ra (số thô)",
      used: sum(rows, "bandwidth_outgoing_bytes"),
      limit: null,
      unit: "bytes",
      from: "bandwidth_outgoing_bytes — KHÔNG bằng Fast Data Transfer",
      matchesDashboard: false,
    },
    {
      key: "bandwidthIn",
      label: "Băng thông vào (số thô)",
      used: sum(rows, "bandwidth_incoming_bytes"),
      limit: null,
      unit: "bytes",
      from: "bandwidth_incoming_bytes — KHÔNG bằng Fast Origin Transfer",
      matchesDashboard: false,
    },
    {
      key: "cdnLookups",
      label: "Lượt tra CDN (hit + miss)",
      used: sum(rows, "request_hit_count", "request_miss_count"),
      limit: null,
      unit: "count",
      from: "request_hit_count + request_miss_count",
      matchesDashboard: false,
    },
    {
      key: "functionGbHours",
      label: "Giờ-GB thực thi hàm (số thô)",
      used: sum(
        rows,
        "function_execution_successful_gb_hours",
        "function_execution_error_gb_hours",
        "function_execution_timeout_gb_hours",
      ),
      limit: null,
      unit: "gbHours",
      from: "function_execution_*_gb_hours — KHÔNG bằng Function Duration (Fluid làm cột ấy đứng ở 0)",
      matchesDashboard: false,
    },
  ];
}

/**
 * Hỏi Vercel mức dùng 30 ngày của tài khoản giữ token này.
 *
 * KHÔNG BAO GIỜ NÉM: mọi ngả hỏng đều về `{ ok: false, error }` với một câu đọc được. Bảng
 * usage là thứ trang trí cho trang admin — một token hết hạn không được phép làm sập cả tab
 * Gương Trạm, nơi còn có nút chuyển trạm.
 */
export async function fetchVercelUsage(token: string): Promise<VercelUsage> {
  const to = new Date();
  const from = new Date(to.getTime() - WINDOW_DAYS * 24 * 3600 * 1000);
  const url =
    `https://api.vercel.com/v2/usage?type=requests` +
    `&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "lỗi lạ";
    return { ok: false, error: `Không gọi được API Vercel: ${reason.slice(0, 120)}` };
  }

  if (!res.ok) {
    // Đọc `error.message` của Vercel nếu có — nó nói thẳng "token hết hạn" hay "cần gói Pro",
    // hai câu mà admin xử lý được ngay, khác hẳn một con số 403 trần trụi.
    const detail = await res
      .json()
      .then((body: unknown) =>
        typeof body === "object" && body !== null && "error" in body
          ? String((body as { error?: { message?: string } }).error?.message ?? "")
          : "",
      )
      .catch(() => "");
    return {
      ok: false,
      error: `Vercel trả HTTP ${res.status}${detail ? ` — ${detail.slice(0, 160)}` : ""}`,
    };
  }

  let body: { data?: UsageRow[]; lastUpdate?: string };
  try {
    body = (await res.json()) as { data?: UsageRow[]; lastUpdate?: string };
  } catch {
    return { ok: false, error: "Vercel trả về thứ không phải JSON." };
  }

  const rows = Array.isArray(body.data) ? body.data : [];
  return {
    ok: true,
    daysWithData: rows.length,
    lastUpdate: typeof body.lastUpdate === "string" ? body.lastUpdate : null,
    windowDays: WINDOW_DAYS,
    metrics: foldUsageRows(rows),
  };
}

/** Số đã dùng thành chữ người đọc — dùng chung cho cả dòng tóm tắt lẫn popup. */
export function formatUsed(metric: UsageMetric): string {
  if (metric.unit === "bytes") {
    const gb = metric.used / GB;
    return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(metric.used / 1024 ** 2).toFixed(1)} MB`;
  }
  if (metric.unit === "gbHours") return `${metric.used.toFixed(1)} GB-Hrs`;
  return metric.used.toLocaleString("vi-VN");
}

/** Hạn mức thành chữ, hoặc null khi chỉ số này không có hạn công bố. */
export function formatLimit(metric: UsageMetric): string | null {
  if (metric.limit == null) return null;
  if (metric.unit === "bytes") return `${Math.round(metric.limit / GB)} GB`;
  if (metric.unit === "gbHours") return `${metric.limit} GB-Hrs`;
  return metric.limit >= 1_000_000
    ? `${metric.limit / 1_000_000}M`
    : metric.limit.toLocaleString("vi-VN");
}

/** Phần trăm đã dùng, hoặc null khi không có hạn để mà chia. */
export function usedRatio(metric: UsageMetric): number | null {
  return metric.limit && metric.limit > 0 ? metric.used / metric.limit : null;
}
