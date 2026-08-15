/**
 * TÊN KHÔI LỖI ĐANG CẦM MỘT DÒNG — luật thuần, dùng cho nhãn ở đuôi mỗi dòng bảng Hàng Đợi.
 *
 * Tệp này KHÔNG import gì cả và phải giữ như vậy: `QueueBoard` là component `"use client"`, nên
 * mọi thứ nó chạm vào đều đi thẳng vào bundle trình duyệt. Đó cũng là lý do luật này không nằm
 * trong `services/queue.ts` — tệp ấy kéo theo cả client database. Cùng bài học đã viết ở
 * `validation/retention.ts` và `worker/version.ts`.
 *
 * ── CHỈ NÓI KHI CÓ MÁY THẬT ĐANG CẦM ────────────────────────────────────────────────────
 *
 * Nhãn này trả lời đúng MỘT câu: "khôi lỗi nào đang chạy đàn này". Nó im ở mọi dòng chưa có ai
 * cầm — đang nghỉ theo cooldown, đang xếp hàng, hay đã tắt.
 *
 * Bản 0.91.0 từng cho dòng chưa ai cầm một nhãn dự đoán (`chờ tông môn`, `chờ máy nào rảnh`,
 * suy từ lựa chọn「Giao đàn cho」). Tông chủ bác ngay: chỗ ấy cần TÊN khôi lỗi, mà một dòng
 * chưa ai nhận thì chưa có tên nào để mà nói — và bảng đã có cột trạng thái kể chuyện chờ đợi
 * rồi (`Chờ máy nhà · thứ 2`, `Đang nghỉ — tới lượt lúc …`). Hai chỗ cùng kể một chuyện là một
 * chỗ thừa, và cái thừa ấy còn mang hình dạng của một lời hứa.
 *
 * Đây cũng đúng bài học bản 0.83.0: dòng đang nghỉ KHÔNG được đeo tên máy, vì cái tên ấy chỉ là
 * phỏng đoán. Nay thì nó không đeo gì cả.
 */

/** Hạng của khôi lỗi đang cầm đàn. `personal` = máy nhà của một đạo hữu. */
export type WorkerClass = "sect" | "personal";

export type AssignmentView = {
  /** Nhãn ở đuôi dòng — luôn mở đầu bằng「khôi lỗi …」để một chuỗi id không đứng trơ trọi. */
  label: string;
  /** Câu đầy đủ cho `title` — chỗ duy nhất còn nói dài được. */
  title: string;
};

/**
 * Trả `null` khi KHÔNG có khôi lỗi nào đang cầm dòng này — và đó là phần lớn các dòng trên
 * bảng. Ba ca im lặng, ba lý do khác nhau:
 *
 *   đang nghỉ / xếp hàng → chưa ai nhận, chưa có tên nào để nói.
 *   đã tắt               → dòng chỉ nán lại để có chỗ bấm Bắt Đầu; cột `worker_id` có thể còn
 *                          sót tên của lượt chạy vừa rồi, mà nói ra là kể một việc đã xong như
 *                          thể đang diễn ra.
 */
export function describeAssignment(input: {
  /** Hạng của máy đang cầm; `null` = chưa ai cầm. */
  workerKind: WorkerClass | null;
  /** Tên máy, nếu người xem được phép biết (luật ở `visibleWorkerId`). */
  workerId: string | null;
  /** Đàn đã tắt hẳn (`stopped` / `failed`). */
  finished: boolean;
}): AssignmentView | null {
  if (input.finished || input.workerKind === null) return null;

  const name = input.workerKind === "sect" ? "khôi lỗi tông môn" : "khôi lỗi máy nhà";
  return {
    // Tên máy đứng SAU tên hạng, không thay nó: một chuỗi id trần trụi không nói được nó là máy
    // của tông môn hay máy nhà ai đó, mà đó mới là điều dòng này sinh ra để trả lời.
    label: input.workerId ? `${name} · ${input.workerId}` : name,
    title:
      input.workerKind === "sect"
        ? "Khôi lỗi tông môn đang chạy đàn này."
        : "Khôi lỗi máy nhà đang chạy đàn này.",
  };
}
