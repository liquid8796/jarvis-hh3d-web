/**
 * LUẬT ĐẶT TÊN cho những cái tên mà lượt dựng khôi lỗi GitHub TỰ SINH RA — thuần, không mạng,
 * không database, không đọc `.env`.
 *
 * `.mjs` chứ không `.ts` là BẮT BUỘC chứ không phải tuỳ thích: hai script phải cùng nghe MỘT luật,
 * mà `newGithubKhoiloi.mjs` chạy bằng `node` trần — xem `spawnSync(process.execPath, …)` bên
 * `newGithubStation.mts` — nên nó không nhập nổi một tệp TypeScript. Chiều ngược lại thì thông:
 * `.mts` nhập `.mjs` được. Cùng lối `loadEnv.mjs` đang đi.
 *
 * VÌ SAO TÁCH RA: trước tệp này, tiền tố tên kho nằm ở HAI bản chép tay (`REPO_PREFIX` bên
 * `newGithubStation.mts` và giá trị mặc định của `--repo` bên `newGithubKhoiloi.mjs`) — hai chuỗi
 * bằng nhau vì may, không vì có gì buộc chúng bằng nhau. Đổi một bên là đẻ ra hai họ tên kho sống
 * song song, mà tên kho lại là thứ lượt XOÁ dùng để khoanh vùng ứng viên.
 */

/**
 * NHỮNG TỪ KHÔNG ĐƯỢC PHÉP CÓ TRONG MỘT CÁI TÊN TA TỰ ĐẶT.
 *
 * Hai nhóm, hai lý do khác hẳn nhau — trộn chúng vào một danh sách là để tiện kiểm, không phải vì
 * chúng cùng loại:
 *
 *   • `auto`, `hh3d`, `hoathinh3d` — buộc kho vào đúng cái trò nó đang cày. Kho là CÔNG KHAI và
 *     GitHub có ô tìm kiếm: một lượt gõ「hh3d」là ra sạch cả đàn, kèm nhật ký Actions của từng cái.
 *   • `worker`, `action`, `workflow`, `github` — không buộc vào trò nào, nhưng chúng dựng đúng
 *     chân dung「kho sinh ra để xài quỹ phút Actions」. GitHub đã gỡ `gautamkrishnar/keepalive-workflow`
 *     vì hành vi chứ không vì cái tên, nhưng cái tên là thứ đưa người ta tới chỗ nhìn hành vi.
 *
 * SO KHỚP THEO CHUỖI CON, KHÔNG THEO TỪ, và cố ý: `actions` chứa `action`, `Auto` chứa `auto`,
 * `my-github-bot` chứa `github`. Ranh giới từ ở đây chỉ tổ để lọt.
 *
 * `hh3d` KHÔNG nằm trong `hoathinh3d` (hoat-hin-h3d → có `nh3d`, không có `hh3d`), nên cả hai
 * đều phải có mặt. Đừng rút gọn danh sách.
 */
export const FORBIDDEN_NAME_WORDS = Object.freeze([
  "auto",
  "hh3d",
  "hoathinh3d",
  "worker",
  "action",
  "workflow",
  "github",
]);

/**
 * Tiền tố tên kho mà lượt dựng đặt. Tên đầy đủ là `<tiền tố>-<mốc thời gian>-<4 ký tự hex>`.
 *
 * Bản trước là `auto-hh3d-linh-su`, và lời bình cũ ở đó biện hộ cho nó bằng câu「nói ra nó là cái
 * gì thay vì cố giấu: một cái tên vô nghĩa không làm kho khó tìm hơn」. Lý lẽ ấy ĐÃ BỊ BÁC ngày
 * 13/08/2026, và chỗ nó sai là chữ「vô nghĩa」: không ai đòi một cái tên vô nghĩa. `linh-su` vẫn
 * nói đủ cho người vận hành nhận ra kho của mình giữa danh sách — nó chỉ thôi nói cho một ô tìm
 * kiếm biết kho này thuộc về trò gì. Hai việc ấy khác nhau, và lời bình cũ gộp chúng làm một.
 */
export const REPO_NAME_PREFIX = "linh-su";

/**
 * Tiền tố `WORKER_ID`. Tên đầy đủ là `<tiền tố>-<mốc thời gian>` (hoặc `<tiền tố>-<tài khoản>` khi
 * gọi thẳng `newGithubKhoiloi.mjs` không truyền `--worker-id`).
 *
 * `tro` là「ở trọ」: khôi lỗi này sống nhờ trên máy của người ta và bị đuổi lúc nào cũng được —
 * khác hẳn `tong-mon-khoiloi` trên VM, thứ tông môn tự nuôi. Phân biệt được hai loại NGAY TRÊN
 * DASHBOARD là công dụng thật của tiền tố, và nó phải sống sót qua lượt đổi tên này: bản trước
 * dùng `github-khoiloi-…`, tức nói đúng điều ấy bằng một từ nằm trong danh sách cấm.
 */
export const KHOILOI_ID_PREFIX = "khoiloi-tro";

/**
 * Những tiền tố tên kho mà các bản TRƯỚC từng đặt.
 *
 * Có mặt ở đây vì lượt XOÁ dùng tiền tố làm bộ lọc rẻ để khoanh vùng ứng viên trên một tài khoản.
 * Bỏ tiền tố cũ đi là làm những kho đã dựng trước 13/08/2026 tàng hình trước chính công cụ dọn của
 * mình — mà đúng cảnh cần dọn nhất, kho rỗng dựng dở (`gh repo create --push` chết giữa chừng),
 * lại là cảnh KHÔNG có dòng nào trong sổ để bắt bằng đường khác.
 *
 * Nới bộ lọc thì an toàn theo đúng thiết kế: tiền tố chưa bao giờ là giấy phép xoá, `Evidence` mới
 * là — xem `reviewRemoval` bên `githubKhoiloi.mts`.
 */
export const LEGACY_REPO_NAME_PREFIXES = Object.freeze(["auto-hh3d-linh-su"]);

/** Mọi tiền tố tên kho từng dùng, mới trước cũ sau. Dùng cho bộ lọc của lượt xoá. */
export const ALL_REPO_NAME_PREFIXES = Object.freeze([REPO_NAME_PREFIX, ...LEGACY_REPO_NAME_PREFIXES]);

/** Những từ cấm có mặt trong `value` — mảng rỗng nghĩa là sạch. */
export function forbiddenWordsIn(value) {
  const lower = String(value).toLowerCase();
  return FORBIDDEN_NAME_WORDS.filter((word) => lower.includes(word));
}

/**
 * Trả về lời từ chối, hoặc `null` nếu tên dùng được — cùng hình dạng với `reviewStationIdentity`
 * bên `src/lib/validation/githubStations.ts`, và cố ý trả CHUỖI thay vì ném: hai script gọi nó có
 * hai lối từ chối khác nhau (`die()` ném `Stop`, còn bên kia in rồi `process.exit`), nên chỗ này
 * chỉ nói cái sai, không giành quyền quyết định chết thế nào.
 *
 * KIỂM CẢ TÊN NGƯỜI VẬN HÀNH GÕ TAY qua `--repo` / `--worker-id`, không chỉ tên tự sinh. Đó là
 * toàn bộ khác biệt giữa「một luật」và「một hằng số vừa được sửa」: hằng số thì lượt sau ai gõ tay
 * một cái tên là lọt, còn luật thì không.
 *
 * KHÔNG áp cho `owner`. Tên tài khoản GitHub nằm sẵn trong đường dẫn kho — `github.com/<owner>/…`
 * — nên không cái tên nào ta đặt giấu được nó, và từ chối vì nó là bắt người ta đổi tài khoản để
 * chạy một script. Khi `owner` lọt vào một cái tên tự sinh (mặc định `--worker-id` bên
 * `newGithubKhoiloi.mjs`) thì lời từ chối ở dưới đã chỉ đúng lối thoát: truyền tay một id khác.
 */
export function reviewGeneratedName(what, value) {
  const hits = forbiddenWordsIn(value);
  if (hits.length === 0) return null;
  return (
    `${what}「${value}」mang từ cấm: ${hits.join(", ")}.\n` +
    `  Kho khôi lỗi là kho CÔNG KHAI, nên cái tên là thứ duy nhất người lạ thấy trước khi mở nhật\n` +
    `  ký Actions ra đọc. Danh sách đầy đủ: ${FORBIDDEN_NAME_WORDS.join(", ")}.\n` +
    `  Bỏ cờ --repo/--worker-id để script tự đặt tên hợp luật, hoặc gõ một cái tên không chứa\n` +
    `  những từ ấy.`
  );
}
