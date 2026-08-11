/**
 * Đối chiếu bản của MỘT khôi lỗi với bản của trạm đang phục vụ — luật thuần, dùng ở giao diện.
 *
 * Tệp này KHÔNG import gì cả và phải giữ nguyên như vậy: mục Khôi Lỗi là component `"use client"`,
 * nên mọi thứ nó nhập đều đi thẳng vào bundle trình duyệt. Cùng bài học đã viết ở
 * `validation/tags.ts` và `validation/retention.ts`.
 *
 * VÌ SAO SO BẰNG PHÉP BẰNG, không so thứ tự semver: trạm đang phục vụ có thể là một trạm gương
 * mang bản CŨ HƠN gói mà người dùng đã cài (đúng cảnh sau một lượt chuyển trạm). Một phép so
 * "cũ hơn / mới hơn" sẽ nói sai trong đúng cái ca ấy, còn「lệch bản, đây là hai con số」thì không
 * bao giờ sai. Người đọc cần biết PHẢI LÀM GÌ, và câu trả lời trong cả hai chiều đều là cài lại.
 *
 * GIỚI HẠN nói thẳng: số bản là tín hiệu THÔ, không phải dấu vân tay nội dung. Nhiều lượt phát
 * hành không nâng số bản, nên hai bên trùng số vẫn có thể lệch mã. Nó bắt được đúng cái nó sinh
 * ra để bắt: một máy nhà cài từ tháng trước rồi quên.
 */

export type WorkerVersionState = "unknown" | "current" | "mismatch";

export type WorkerVersionView = {
  state: WorkerVersionState;
  /** Câu ngắn hiện ngay cạnh tên khôi lỗi. */
  label: string;
  /** `true` khi người dùng cần làm gì đó — giao diện tô màu nhắc theo cờ này. */
  stale: boolean;
};

export function describeWorkerVersion(
  workerVersion: string | null | undefined,
  webVersion: string | null | undefined,
): WorkerVersionView {
  const worker = workerVersion?.trim() ?? "";
  const web = webVersion?.trim() ?? "";

  // Không khai gì = bản trước 0.71.0. Đây là ca ĐÁNG NÓI NHẤT, vì đó chính là những bản chưa
  // biết đi theo bảng điều phối khi chuyển trạm.
  if (!worker) {
    return { state: "unknown", label: "bản cũ (không khai số) — nên cài lại", stale: true };
  }
  // Không biết web đang ở bản nào thì không có gì để đối chiếu; nói ra con số đang có là đủ,
  // và tuyệt đối không được đoán là cũ.
  if (!web) return { state: "unknown", label: `bản ${worker}`, stale: false };

  if (worker === web) return { state: "current", label: `bản ${worker}`, stale: false };
  return { state: "mismatch", label: `bản ${worker} — web đang ở ${web}, nên cài lại`, stale: true };
}
