/**
 * AI ĐANG ĐẢM NHẬN DÒNG NÀY — luật thuần, dùng cho nhãn ở đuôi mỗi dòng bảng Hàng Đợi.
 *
 * Tệp này KHÔNG import gì cả và phải giữ như vậy: `QueueBoard` là component `"use client"`, nên
 * mọi thứ nó chạm vào đều đi thẳng vào bundle trình duyệt. Đó cũng là lý do luật này không nằm
 * trong `services/queue.ts` — tệp ấy kéo theo cả client database. Cùng bài học đã viết ở
 * `validation/retention.ts` và `worker/version.ts`.
 *
 * ── HAI SỰ THẬT KHÁC HẲN NHAU, VÀ ĐÓ LÀ TOÀN BỘ CÁI KHÓ ──────────────────────────────────
 *
 * Một dòng ĐANG CHẠY có một khôi lỗi thật đang cầm nó: tên máy ấy là một sự kiện.
 * Một dòng ĐANG NGHỈ thì chưa ai cầm — thứ duy nhất biết được là HẠNG máy nào đủ tư cách nhận,
 * suy từ lựa chọn「Giao đàn cho」của chủ đàn. Đó là một DỰ ĐỊNH.
 *
 * Trộn hai thứ ấy vào một câu chữ là đúng cái sai bản 0.83.0 phải đi vá: hồi đó dòng đang nghỉ
 * vẫn đeo tên máy sẽ chạy nó, và người đọc kết luận rằng đàn đã được đặt chỗ trước — trong khi
 * cái tên ấy chỉ là phỏng đoán. Nên ở đây chúng mang hai hình dạng khác nhau, và `planned` là
 * cờ để giao diện vẽ chúng khác nhau: dự định thì nhạt hơn và luôn mở đầu bằng chữ「chờ」.
 */

/** Hạng của khôi lỗi đang cầm đàn. `personal` = máy nhà của một đạo hữu. */
export type WorkerClass = "sect" | "personal";

/** Lựa chọn「Giao đàn cho」của chủ đàn, sau khi đã gạn. */
export type OwnerPref = "sect" | "mine" | "any";

/**
 * Gạn `workerPref` thô từ database về ba giá trị biết trước.
 *
 * FAIL-OPEN: chuỗi lạ đọc như `any` — cùng lối `queuePoolOf` bên services/queue.ts và `mayServe`
 * bên dispatch.ts. Sửa tay database ra một giá trị không ai biết thì đàn vẫn được kể là ở hàng
 * chung; đọc theo chiều ngược lại là nhốt nó vào một hàng riêng không máy nào của chủ nó trực.
 */
export function normalizeOwnerPref(raw: string | null | undefined): OwnerPref {
  return raw === "mine" ? "mine" : raw === "sect" ? "sect" : "any";
}

export type AssignmentView = {
  /** Nhãn ngắn ở đuôi dòng. */
  label: string;
  /** Câu đầy đủ cho `title` — chỗ duy nhất còn nói dài được. */
  title: string;
  /** `true` khi đây mới là DỰ ĐỊNH: chưa máy nào cầm đàn này. */
  planned: boolean;
};

/**
 * Trả `null` khi dòng không còn ai đảm nhận NỮA — đàn đã tắt, dòng chỉ nán lại để có chỗ bấm
 * Bắt Đầu. Gán cho nó một câu「chờ …」là hứa một lượt chạy sẽ không bao giờ tới.
 */
export function describeAssignment(input: {
  /** Hạng của máy đang cầm; `null` = chưa ai cầm. */
  workerKind: WorkerClass | null;
  /** Tên máy, nếu người xem được phép biết (luật ở `visibleWorkerId`). */
  workerId: string | null;
  /** `workerPref` của CHỦ đàn: `sect` | `mine` | `any`. Giá trị lạ đọc như `any`. */
  ownerPref: string;
  /** Đàn đã tắt hẳn (`stopped` / `failed`). */
  finished: boolean;
}): AssignmentView | null {
  if (input.finished) return null;

  if (input.workerKind === "sect") {
    return {
      label: input.workerId ? `tông môn · ${input.workerId}` : "tông môn",
      title: "Khôi lỗi tông môn đang chạy đàn này.",
      planned: false,
    };
  }
  if (input.workerKind === "personal") {
    return {
      label: input.workerId ?? "máy nhà",
      title: "Một khôi lỗi riêng (máy nhà) đang chạy đàn này.",
      planned: false,
    };
  }

  // Chưa ai cầm: nói HẠNG nào đủ tư cách, theo lựa chọn của chủ đàn.
  //
  // Giá trị lạ đọc như `any` — fail-open, cùng lối `queuePoolOf` bên services/queue.ts và
  // `mayServe` bên dispatch.ts: sửa tay database ra một chuỗi không ai biết thì đàn vẫn được kể
  // là ở hàng chung, thay vì mang một nhãn hẹp hơn sự thật.
  if (input.ownerPref === "mine") {
    return { label: "chờ máy nhà", title: "Đàn này chỉ giao cho khôi lỗi riêng của chủ nó.", planned: true };
  }
  if (input.ownerPref === "sect") {
    return { label: "chờ tông môn", title: "Đàn này chỉ giao cho khôi lỗi tông môn.", planned: true };
  }
  return {
    label: "chờ máy nào rảnh",
    title: "Đàn này giao cho khôi lỗi tông môn hay máy nhà đều được — máy nào rảnh trước thì nhận.",
    planned: true,
  };
}
