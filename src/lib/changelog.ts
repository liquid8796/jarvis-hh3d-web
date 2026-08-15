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
 * ── HAI NGUỒN, VÀ AI THẮNG AI (14/08/2026) ───────────────────────────────────────────────
 *
 * Bản đầu chỉ có một nguồn: chính tệp này, cố ý không sửa được từ giao diện. Tông chủ bác điều
 * ấy ngay hôm sau — sửa một dòng tin không đáng phải chờ một lượt phát hành. Nay có hai:
 *
 *   `DEFAULT_RELEASE_NOTES` (tệp này)   mục viết lúc phát hành, đi cùng commit chở nó
 *   `app_settings.changelog.notes`      mục Gia chủ sửa trên trang Tông Môn
 *
 * `mergeReleaseNotes` gộp chúng theo đúng MỘT luật: **cùng số bản thì sổ thắng, số bản chỉ có
 * trong tệp mã thì lấy nguyên**. Luật ấy chọn vì cái nó CHỐNG: nếu sổ thắng trọn gói thì một
 * lượt sửa tay hôm nay chôn sống mọi mục viết ở những lượt phát hành sau — bản tin đứng im
 * vĩnh viễn mà không ai hiểu vì sao.
 *
 * ── BIA MỘ: XOÁ LÀ XOÁ THẬT (14/08/2026) ─────────────────────────────────────────────────
 *
 * Bản đầu của luật gộp có một giới hạn: xoá một mục vốn có trong tệp mã thì lượt dựng sau nó
 * mọc lại. Tông chủ bác — xoá phải dính. Nhưng "sổ thắng trọn gói" vẫn là cái bẫy cũ, nên chỗ
 * giải không nằm ở luật gộp mà ở một danh sách thứ hai: **`hidden`, những số bản đã bị gỡ**.
 *
 * Nó được tính lúc LƯU, từ chính những mục ĐANG CÓ trong tệp mã (`hiddenVersionsFor`): mục nào
 * của tệp mã mà bài Gia chủ vừa gõ không nhắc tới thì coi như đã gỡ. Một số bản RA ĐỜI SAU lượt
 * lưu ấy không nằm trong phép tính, nên nó vẫn tự hiện — hai điều cùng đúng, không phải chọn một.
 *
 * Gỡ nhầm thì gõ lại số bản ấy vào ô là xong: nó thôi vắng mặt, nên bia mộ tự rụng ở lượt lưu kế.
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

/** Trần số mục. Bản tin là thứ người ta liếc qua, không phải sử biên niên. */
export const MAX_NOTES = 50;
/** Trần số dòng mỗi mục — dài hơn thì không ai đọc hết. */
export const MAX_LINES_PER_NOTE = 5;
/** Một dòng phải đủ thành câu, và đủ ngắn để đọc một hơi. */
export const MIN_LINE_LENGTH = 15;
export const MAX_LINE_LENGTH = 160;

/**
 * Mục viết lúc phát hành. Mới nhất ĐỨNG ĐẦU.
 *
 * `verify:changelog` giữ ba điều ở đây: thứ tự giảm dần, không trùng số bản, và mục đầu phải
 * trùng `package.json` — tức bump bản mà quên viết tin là lưới kiểm đỏ. Ba điều ấy KHÔNG áp cho
 * phần Gia chủ sửa trong sổ: ở đó người ta sửa lời, không phát hành.
 */
export const DEFAULT_RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: "0.92.0",
    date: "2026-08-15",
    lines: [
      "Bảng Hàng Đợi chỉ ghi tên khôi lỗi khi thật sự có máy đang chạy đàn ấy; dòng đang nghỉ để trống.",
    ],
  },
  {
    version: "0.91.1",
    date: "2026-08-15",
    lines: [
      "Khoáng Mạch: ô mua Linh Quang Phù và ô ngưỡng đoạt nay nằm gọn trong khối「Đoạt mỏ」, và mờ đi khi không đoạt.",
      "Không bật đoạt mỏ thì khôi lỗi cũng thôi mua phù. Ngưỡng đã chọn vẫn giữ nguyên, bật lại là thấy đúng con số cũ.",
    ],
  },
  {
    version: "0.91.0",
    date: "2026-08-15",
    lines: [
      "Bảng Hàng Đợi nay ghi rõ ở từng dòng: máy nào đang chạy đàn ấy, hoặc nó đang chờ loại máy nào.",
    ],
  },
  {
    version: "0.90.0",
    date: "2026-08-15",
    lines: [
      "Các khôi lỗi trọ nay khai đúng số bản đang chạy trên bảng Khôi Lỗi, thay vì cùng hiện một con số cũ.",
    ],
  },
  {
    version: "0.89.0",
    date: "2026-08-15",
    lines: [
      "Khoáng Mạch: thêm ô chọn có mua Linh Quang Phù hay không — nếu bật, mỗi ngày chỉ mua đúng một lá.",
      "Khôi lỗi chỉ mua phù hay đoạt mỏ khi khai thác đã đạt tối đa, và đào tới khi đầy giới hạn ngày.",
    ],
  },
  {
    version: "0.88.0",
    date: "2026-08-14",
    lines: [
      "Chỗ soạn bản tin của tông môn chỉnh lại cách gỡ mục; với đạo hữu thì màn hình không đổi gì.",
    ],
  },
  {
    version: "0.87.0",
    date: "2026-08-14",
    lines: [
      "Gia chủ sửa được thẳng nội dung bản tin này ngay trên trang Tông Môn, không phải chờ bản sau.",
    ],
  },
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

/**
 * Khoá localStorage nhớ số bản người dùng đã đọc tin.
 *
 * Có tiền tố vì localStorage là một không gian tên phẳng dùng chung cho cả tên miền — và tên
 * miền này còn chở trang game trong iframe ở vài chỗ.
 */
export const CHANGELOG_SEEN_KEY = "jvz.changelog.seen";

/** `0.84.0` → `[0, 84, 0]`; `null` khi chuỗi không phải ba số. */
export function parseVersion(version: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Âm khi `a` cũ hơn `b`. So bằng SỐ: theo chuỗi thì "0.9.0" đứng trên "0.10.0", mà sai. */
export function compareVersion(a: string, b: string): number {
  const x = parseVersion(a) ?? [0, 0, 0];
  const y = parseVersion(b) ?? [0, 0, 0];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/**
 * Gộp hai nguồn: mục trong SỔ thắng theo số bản, mục chỉ có trong TỆP MÃ lấy nguyên. Kết quả
 * xếp giảm dần theo số bản — hộp tin đọc từ trên xuống, nên thứ tự sai là lịch sử sai.
 *
 * Vì sao không để sổ thắng trọn gói: xem khối chú thích đầu tệp. Một lượt sửa tay không được
 * phép chôn sống mọi mục của những lượt phát hành sau nó.
 */
export function mergeReleaseNotes(
  defaults: readonly ReleaseNote[],
  overrides: readonly ReleaseNote[],
  hidden: readonly string[] = [],
): ReleaseNote[] {
  const buried = new Set(hidden);
  const byVersion = new Map<string, ReleaseNote>();
  for (const note of defaults) {
    if (!buried.has(note.version)) byVersion.set(note.version, note);
  }
  // Bia mộ KHÔNG chặn phần ghi đè: gõ lại số bản ấy vào ô là cách người ta lấy lại một mục đã
  // gỡ, và nếu ở đây cũng lọc thì cái cách ấy im lặng không ăn — đúng loại hỏng khiến người
  // dùng tưởng ô nhập bị kẹt.
  for (const note of overrides) byVersion.set(note.version, note);
  return [...byVersion.values()].sort((a, b) => compareVersion(b.version, a.version));
}

/**
 * Những số bản của TỆP MÃ mà bài vừa gõ không nhắc tới — tức đã bị gỡ.
 *
 * Tính từ `defaults` ĐANG CÓ chứ không phải từ một danh sách tích luỹ: số bản ra đời ở những
 * lượt phát hành SAU không nằm trong phép tính này, nên chúng vẫn tự hiện. Đó là toàn bộ mẹo
 * để「xoá dính」và「mục mới tự hiện」cùng đúng một lúc.
 */
export function hiddenVersionsFor(
  defaults: readonly ReleaseNote[],
  kept: readonly ReleaseNote[],
): string[] {
  const keptVersions = new Set(kept.map((note) => note.version));
  return defaults.filter((note) => !keptVersions.has(note.version)).map((note) => note.version);
}

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

/**
 * Soát HÌNH DẠNG một danh sách tin. Trả lời từ chối, hoặc `null` khi hợp lệ.
 *
 * Thuần, và cố ý dùng chung cho CẢ HAI cửa: lưới kiểm soi tệp mã, và server action nhận bài
 * Gia chủ gõ. Một luật viết hai chỗ là hai luật sẽ trôi khỏi nhau — mà chỗ trôi ở đây là thứ
 * người lạ đọc được trên trang.
 *
 * KHÔNG soát văn phong (chữ của máy, khuôn sáo). Lưới kiểm của tệp mã có làm việc ấy, vì đó là
 * bài CHÚNG TA viết; còn bài Gia chủ gõ thì Gia chủ chịu trách nhiệm — chặn chữ trong ô nhập
 * của chính chủ là dựng một cái cũi, không phải một hàng rào.
 */
export function reviewNotes(notes: readonly ReleaseNote[], now: Date = new Date()): string | null {
  if (notes.length > MAX_NOTES) {
    return `Quá nhiều mục (${notes.length}) — trần là ${MAX_NOTES}. Bản tin là thứ để liếc, không phải sử biên niên.`;
  }

  const seen = new Set<string>();
  for (const note of notes) {
    if (parseVersion(note.version) === null) {
      return `Số bản「${note.version}」không đúng dạng x.y.z.`;
    }
    if (seen.has(note.version)) {
      return `Số bản「${note.version}」xuất hiện hai lần — mỗi bản một mục.`;
    }
    seen.add(note.version);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(note.date)) {
      return `Ngày của v${note.version} phải theo dạng YYYY-MM-DD.`;
    }
    const at = new Date(`${note.date}T00:00:00Z`);
    if (Number.isNaN(at.getTime())) {
      return `Ngày「${note.date}」của v${note.version} không phải một ngày có thật.`;
    }
    // Dư 36 giờ vì máy người gõ và máy chạy phép soát có thể lệch múi giờ.
    if (at.getTime() > now.getTime() + 36 * 3600 * 1000) {
      return `Ngày của v${note.version} nằm ở tương lai — gõ nhầm tháng?`;
    }

    if (note.lines.length === 0) {
      return `v${note.version} chưa có dòng tin nào.`;
    }
    if (note.lines.length > MAX_LINES_PER_NOTE) {
      return `v${note.version} có ${note.lines.length} dòng — trần là ${MAX_LINES_PER_NOTE}.`;
    }
    for (const line of note.lines) {
      if (line !== line.trim()) {
        return `Một dòng của v${note.version} thừa khoảng trắng ở đầu hoặc cuối.`;
      }
      if (line.length < MIN_LINE_LENGTH) {
        return `Dòng「${line}」của v${note.version} ngắn quá (dưới ${MIN_LINE_LENGTH} ký tự) — chưa thành câu.`;
      }
      if (line.length > MAX_LINE_LENGTH) {
        return `Một dòng của v${note.version} dài quá (${line.length} ký tự, trần ${MAX_LINE_LENGTH}).`;
      }
    }
  }
  return null;
}

/**
 * Danh sách tin → chữ để đổ vào ô nhập, và ngược lại (`parseNotesText`).
 *
 * Chọn một ô văn bản thay vì một biểu mẫu lặp: sửa lời, thêm mục, bỏ mục, đổi thứ tự — bốn
 * việc, một ô, không nút nào. Dạng chữ giữ đúng thứ người ta vốn viết trong ghi chú, nên không
 * ai phải học cú pháp mới:
 *
 *     0.87.0 · 2026-08-14
 *     - dòng thứ nhất
 *     - dòng thứ hai
 *
 *     0.86.0 · 2026-08-14
 *     - ...
 */
export function formatNotesText(notes: readonly ReleaseNote[]): string {
  return notes
    .map((note) => [`${note.version} · ${note.date}`, ...note.lines.map((line) => `- ${line}`)].join("\n"))
    .join("\n\n");
}

export type ParsedNotes = { ok: true; notes: ReleaseNote[] } | { ok: false; message: string };

/**
 * Chữ trong ô nhập → danh sách tin.
 *
 * Lỗi mang SỐ DÒNG. Một ô văn bản bốn mươi dòng mà báo「sai cú pháp」trơn thì người sửa phải
 * dò bằng mắt từ đầu — đúng loại thông báo khiến người ta bỏ cuộc giữa chừng.
 *
 * Dấu phân cách nhận cả `·` lẫn `-` lẫn `|`: cái dấu giữa là thứ đầu tiên người ta gõ khác đi,
 * và từ chối vì một dấu chấm giữa là một hàng rào không bảo vệ điều gì.
 */
export function parseNotesText(text: string): ParsedNotes {
  const notes: ReleaseNote[] = [];
  let current: ReleaseNote | null = null;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();
    const at = i + 1;
    if (line === "") continue;

    if (line.startsWith("-")) {
      if (!current) {
        return { ok: false, message: `Dòng ${at}: có dòng tin nhưng chưa khai số bản nào ở trên.` };
      }
      const body = line.slice(1).trim();
      if (body === "") {
        return { ok: false, message: `Dòng ${at}: dòng tin rỗng.` };
      }
      current.lines.push(body);
      continue;
    }

    // Dòng KHÔNG bắt đầu bằng gạch đầu dòng = đầu một mục mới: "0.87.0 · 2026-08-14".
    //
    // HAI mẫu, và lý do là NGÀY CÓ DẤU GẠCH NGANG BÊN TRONG. Một mẫu chung `[·\-|]` trông gọn
    // hơn, nhưng với "0.9.0·2026-08-10" (không khoảng trắng) thì phép khớp tham lam lùi tới dấu
    // gạch CUỐI CÙNG — tức cắt ngay giữa cái ngày, ra `0.9.0·2026-08` và `10`. Nên `·` và `|`
    // nhận ở mọi dạng, còn `-` thì ĐÒI khoảng trắng hai bên: ngày không bao giờ có khoảng trắng
    // quanh dấu gạch của nó, nên đòi vậy là đủ để hai thứ không lẫn vào nhau.
    const head = /^(\S+)\s*[·|]\s*(\S+)$/.exec(line) ?? /^(\S+)\s+-\s+(\S+)$/.exec(line);
    if (!head) {
      return {
        ok: false,
        message: `Dòng ${at}: không đọc được. Đầu mục viết「số bản · ngày」(ví dụ: 0.87.0 · 2026-08-14), dòng tin bắt đầu bằng dấu -.`,
      };
    }
    current = { version: head[1], date: head[2], lines: [] };
    notes.push(current);
  }

  const empty = notes.find((note) => note.lines.length === 0);
  if (empty) {
    return { ok: false, message: `v${empty.version} chưa có dòng tin nào — mỗi mục cần ít nhất một dòng.` };
  }

  const complaint = reviewNotes(notes);
  if (complaint) return { ok: false, message: complaint };

  // Xếp hộ, không bắt người gõ tự xếp: thứ tự là luật của phép hiển thị, không phải bài tập
  // của người viết.
  notes.sort((a, b) => compareVersion(b.version, a.version));
  return { ok: true, notes };
}
