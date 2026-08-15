/**
 * BẢN TIN CẬP NHẬT — thứ người dùng đọc, không phải thứ lập trình viên đọc.
 *
 * Tệp này KHÔNG phải `CHANGELOG.md`. Hai thứ khác nhau về người đọc, nên khác nhau về mọi thứ
 * còn lại:
 *
 *   `CHANGELOG.md`   người sửa mã đọc  · dài, sâu, kể tên bảng/hàm/lần hỏng việc
 *   tệp này          đạo hữu đọc       · ngắn, nói cái họ THẤY, không có chữ nào của máy móc
 *
 * Luật viết đầy đủ nằm trong bản ghi nhớ `changelog-cho-nguoi-dung.md`; gọn lại: ngắn, đủ ý,
 * nói bằng tiếng người, không nhắc tên thành phần bên dưới, và đừng viết như một cái máy.
 *
 * VÌ SAO LÀ MỘT TỆP MÃ, không phải một bảng trong database: mục tin ở đây tả đúng cái commit
 * chở nó. Đi cùng một lượt phát hành thì nó không bao giờ lệch — trang đang chạy bản nào thì
 * bản tin đúng bản ấy. Cất trong database thì nó thành một thứ sống riêng: sửa được lúc nào
 * cũng được, và có ngày tả một tính năng chưa lên, hoặc lên rồi mà chưa ai chép vào.
 *
 * KHÔNG import gì cả, và phải giữ như vậy: `ChangelogTag` là component `"use client"`, nên mọi
 * thứ tệp này chạm vào đều đi thẳng vào bundle trình duyệt. Cùng bài học đã viết ở
 * `worker/version.ts` và `validation/retention.ts`.
 */

export type ReleaseNote = {
  /** Đúng chuỗi trong `package.json` của lượt phát hành ấy. */
  version: string;
  /** `YYYY-MM-DD`, ngày phát hành. */
  date: string;
  /** Mỗi dòng một ý, đọc là hiểu. Một mục thường 1–3 dòng. */
  lines: string[];
};

/**
 * Mới nhất ĐỨNG ĐẦU. `verify:changelog` giữ ba điều: thứ tự giảm dần, không trùng số bản, và
 * mục đầu phải trùng `package.json` — tức bump bản mà quên viết tin là lưới kiểm đỏ.
 */
export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: "0.86.0",
    date: "2026-08-14",
    lines: [
      "Số hiệu bản ở góc màn hình nay bấm được, mở ra đúng danh sách này.",
      "Có bản mới thì cạnh số hiệu hiện một chấm vàng, xem xong là tắt.",
    ],
  },
  {
    version: "0.85.0",
    date: "2026-08-14",
    lines: [
      "Khoáng Mạch có thêm ô「Ngưỡng % tu vi để đào」: mỏ đang cho ít hơn mức đặt thì để dành, phần đã đào vẫn treo nguyên và lát sau ghé lại.",
      "Để ngưỡng ở 0 thì mọi thứ chạy y như trước.",
    ],
  },
  {
    version: "0.84.0",
    date: "2026-08-14",
    lines: [
      "Khoáng Mạch nay chạy được cho cả tài khoản thường, không riêng tài khoản VIP.",
      "Bảng Hàng Đợi bỏ bớt một đoạn giải thích cũ đã không còn đúng.",
    ],
  },
  {
    version: "0.83.0",
    date: "2026-08-14",
    lines: [
      "Việc được chia đều cho mọi máy đang trực thay vì dồn vào máy hỏi nhanh nhất, nên đàn tới giờ ít phải chờ hơn.",
      "Đàn đang nghỉ thôi hiện tên máy sẽ chạy nó — cái tên ấy trước đây chỉ là phỏng đoán.",
    ],
  },
  {
    version: "0.82.0",
    date: "2026-08-13",
    lines: [
      "Luyện Đan: nhật ký nói rõ viên đan nào được giữ lại và viên nào đem phân giải, thay vì chỉ im lặng làm.",
    ],
  },
];

/** Mục mới nhất, hoặc `null` khi chưa có tin nào. */
export const LATEST_NOTE: ReleaseNote | null = RELEASE_NOTES[0] ?? null;

/**
 * Khoá localStorage nhớ số bản người dùng đã đọc tin.
 *
 * Có tiền tố vì localStorage là một không gian tên phẳng dùng chung cho cả tên miền — và tên
 * miền này còn chở trang game trong iframe ở vài chỗ.
 */
export const CHANGELOG_SEEN_KEY = "jvz.changelog.seen";

/**
 * Có tin CHƯA ĐỌC không?
 *
 * `seen` là thứ đọc từ localStorage, nên nó có ba trạng thái thật chứ không phải hai:
 *
 *   chuỗi bản   → so với bản mới nhất
 *   `null`      → chưa từng mở bản tin: người mới, hoặc vừa xoá dữ liệu trình duyệt
 *   `undefined` → KHÔNG ĐỌC ĐƯỢC localStorage (Safari riêng tư, cookie bị chặn)
 *
 * Hai ca cuối phải xử khác nhau. Chưa từng mở thì báo có tin — đó đúng là sự thật. Còn không
 * đọc nổi kho thì im: một chấm đỏ không bao giờ tắt được vì không ghi nổi trạng thái là thứ
 * người ta học cách phớt lờ, và một khi đã phớt lờ thì nó hết tác dụng cho mọi lần sau.
 */
export function hasUnseenNote(seen: string | null | undefined, latestVersion: string | null): boolean {
  if (!latestVersion) return false;
  if (seen === undefined) return false;
  return seen !== latestVersion;
}
