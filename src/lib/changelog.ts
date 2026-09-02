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
    version: "1.3.67",
    date: "2026-09-02",
    lines: [
      "Bí Cảnh Tông Môn: khi boss đã bị hạ mà phần thưởng còn treo, khôi lỗi nay tự nhận thưởng rồi mới khiêu chiến tiếp.",
      "Trước đây gặp màn nhận thưởng thì lượt ghé đứng chờ vô ích cho tới khi hết giờ, và phần thưởng chặn luôn boss kế.",
      "Áp dụng cho cả tài khoản VIP lẫn Thường. Ngày đã hết lượt vẫn dừng sớm như cũ, không tốn thêm lượt tải trang nào.",
    ],
  },
  {
    version: "1.3.66",
    date: "2026-09-02",
    lines: [
      "Sức chứa túi đan nay hiển thị riêng theo từng tài khoản VIP và Thường, không còn dùng chung một bộ số cố định.",
      "Số liệu tự cập nhật sau mỗi lượt Luyện Đan, có thời điểm dò gần nhất; tài khoản chưa dò sẽ được ghi rõ.",
      "Hạn mức giữ đan đã chọn vẫn được giữ nguyên. Khi đổi thông tin đăng nhập, sức chứa cũ được xóa để chờ dò lại.",
    ],
  },
  {
    version: "1.3.65",
    date: "2026-09-01",
    lines: [
      "Hạn mức Luyện Đan nay đếm riêng Hạ, Trung, Thượng hoặc Cực đang chọn; đan của phẩm khác không còn bị cộng nhầm.",
      "Cả tài khoản VIP và Thường đều dùng đúng bộ đếm này, vẫn giữ hai bộ cấu hình riêng.",
      "Phẩm đang khóa không còn làm khôi lỗi luyện nhầm phẩm cũ; chi phí trên form nay ghi đúng 20, 35, 55 hoặc 80 Tiên Ngọc.",
    ],
  },
  {
    version: "1.3.64",
    date: "2026-09-01",
    lines: [
      "Ba nút kẹp tệp, cảm xúc và gửi trong Phòng Chat đã tròn cân đối trở lại, không còn bị bè ngang sau lượt hạ khung.",
      "Bề ngang và chiều cao khung vừa chỉnh vẫn giữ nguyên; giao diện điện thoại không đổi.",
    ],
  },
  {
    version: "1.3.63",
    date: "2026-09-01",
    lines: [
      "Khung Phòng Chat trên máy tính nay thấp xuống đúng một phần tư, còn bề ngang rộng vừa chỉnh vẫn giữ nguyên.",
      "Điện thoại giữ nguyên kích thước cũ để ô nhập và các nút không bị ép quá nhỏ.",
    ],
  },
  {
    version: "1.3.62",
    date: "2026-09-01",
    lines: [
      "Khung Phòng Chat trên máy tính nay rộng thêm đúng một phần tư, cho dòng trò chuyện thoáng và ít xuống hàng hơn.",
      "Trên điện thoại, sảnh vẫn ôm vừa màn hình như trước và không sinh phần tràn ngang.",
    ],
  },
  {
    version: "1.3.61",
    date: "2026-08-31",
    lines: [
      "Mốc giờ trong Phòng Chat sáng lên và to lại một chút — lượt thu gọn ban nãy đã làm nó mờ quá mức đọc thoải mái.",
    ],
  },
  {
    version: "1.3.60",
    date: "2026-08-31",
    lines: [
      "Phòng Chat nay nở theo màn hình: trước đây sảnh đứng yên một cỡ dù màn có lớn tới đâu, giờ màn càng cao sảnh càng rộng.",
      "Chữ, ảnh đại diện và bài vị trong sảnh thu lại một bậc, nên mỗi màn hình chứa thêm chừng hai lượt trò chuyện mà vẫn đọc thoải mái.",
      "Trên điện thoại chữ giữ nguyên cỡ cũ — lượt thu này chỉ đụng tới máy tính.",
    ],
  },
  {
    version: "1.3.59",
    date: "2026-08-31",
    lines: [
      "Mê Cung kể lại từng ải trong lúc đánh — «Đang đánh ải 3/5» kèm tên boss — thay vì im lặng suốt cả trận rồi mới báo một dòng kết quả.",
      "Phòng bị xoá giữa trận thì nay nói thẳng là đã ra khỏi phòng và lập phòng mới ở lượt ghé sau, thay vì đứng dò mười mấy phút không một dòng chữ nào.",
      "Trận có đứng hình đi nữa thì cứ vài phút vẫn có một dòng báo đang ở đâu, nên liếc nhật ký là biết còn chạy hay đã kẹt.",
    ],
  },
  {
    version: "1.3.58",
    date: "2026-08-31",
    lines: [
      "Mê Cung có thêm ô «Đủ mấy người thì đánh»: nhập 3 thì 3 người bấm sẵn sàng là vào ải luôn, khỏi ngồi chờ cho đủ 5.",
      "Trang vẫn đòi mọi người đang trong phòng phải bấm sẵn sàng, nên ô này hạ mức tối thiểu chứ không bỏ qua người còn ngồi im.",
      "Để nguyên 5 là chạy y như trước; ai không chỉnh gì thì không đổi gì cả.",
    ],
  },
  {
    version: "1.3.57",
    date: "2026-08-28",
    lines: [
      "Tab Khôi lỗi nay nói rõ từng máy đang làm gì: đang rảnh, đang bận, hay đã chết — thay vì chỉ một chữ đang trực cho cả hai trường hợp đầu.",
      "Máy đã chết còn kể luôn nó vắng từ bao giờ, nên nhìn là biết vừa tắt hay tắt đã lâu.",
    ],
  },
  {
    version: "1.3.56",
    date: "2026-08-30",
    lines: [
      "Hoang Vực: khi trang game báo hết phiên tấn công, máy chạy tự động nay tải lại rồi đánh lại ngay trong vòng đó, thay vì bỏ dở và chờ vòng sau.",
    ],
  },
  {
    version: "1.3.55",
    date: "2026-08-25",
    lines: [
      "Bảng Hoạt động nay gọi đúng tên mục cài đặt như trên Ngọc Giản, thay vì mã nội bộ khó đoán.",
      "Bỏ một dòng nhắc thừa vẫn hiện ra dù đạo hữu chưa tự đặt gì.",
    ],
  },
  {
    version: "1.3.54",
    date: "2026-08-29",
    lines: [
      "Mê Cung: tài khoản đang bế quan Trợ Chiến thì auto bỏ qua lượt ấy và ghé lại sau, thay vì đứng bấm Lập Đội rồi báo hỏng.",
      "Hộp mừng vượt 5 ải không còn che nút Bắt Đầu của lượt kế.",
      "Ô chọn độ khó nay nói rõ: mỗi ải chỉ thưởng một lần mỗi ngày, và đi Thường trước là mất phần thưởng thêm của Khó/Ác Mộng.",
    ],
  },
  {
    version: "1.3.53",
    date: "2026-08-28",
    lines: [
      "Sảnh toàn màn hình: dòng chữ mời trong ô nhập thôi bị cắt mất chữ cuối, và ô nhập nay cao dần theo tin đang gõ.",
    ],
  },
  {
    version: "1.3.52",
    date: "2026-08-28",
    lines: [
      "Phòng Chat trên điện thoại: mỗi khoảnh tin nay thu lại cho vừa khung — trước chỉ chứa vừa hai tin rưỡi, giờ được hơn ba tin rưỡi.",
      "Thêm nút ở góc trên bên phải khung để trải sảnh kín màn hình; bấm lần nữa hoặc bấm Esc là thu về.",
      "Lúc trải kín màn hình thì chữ trở lại cỡ thường và ô nhập rộng ra, đọc và gõ đều dễ hơn.",
    ],
  },
  {
    version: "1.3.51",
    date: "2026-08-28",
    lines: [
      "Hoang Vực: trang game dạo này có lúc nhận đòn đánh rồi đứng hình — vẫn hiện nút KHIÊU CHIẾN như chưa đánh gì, kèm dòng nhắc tải lại trang.",
      "Auto nay tải lại rồi đọc lại lượt đánh và đồng hồ, thay vì đứng chờ hai phút rồi báo hỏng cho một trận thật ra đã đánh xong.",
      "Đòn nào thật sự không ăn thì vẫn báo hỏng như cũ — chỗ này không nhận vơ.",
    ],
  },
  {
    version: "1.3.50",
    date: "2026-08-26",
    lines: [
      "Luyện Đan Đường: chọn giữ đan từ mấy sao trở lên thì nay đặt thêm được số lượng muốn giữ.",
      "Đủ số rồi, chọn một trong hai: phân giải viên dư để lấy lại dược liệu, hoặc giữ nguyên và thôi khai lô mới.",
      "Chọn cách thứ hai thì mỗi lượt ghé vẫn thu mẻ đang chín rồi đếm lại, nên không luyện thừa.",
    ],
  },
  {
    version: "1.3.49",
    date: "2026-08-25",
    lines: [
      "Phúc Lợi Đường (tài khoản thường): auto nay nhận cả rương mốc — hàng rương tích điểm theo tháng nằm dưới bốn rương ngày.",
      "Trước đây bảng nhắc「Còn rương mốc chưa nhận!」che kín trang, làm auto không bấm nổi rương ngày nào; nay nó được đóng trước rồi mới làm tiếp.",
      "Mốc nào chưa đủ điểm thì bỏ qua, và nhật ký kể rõ nhận được mấy rương mốc.",
    ],
  },
  {
    version: "1.3.48",
    date: "2026-08-23",
    lines: [
      "Khối nhiệm vụ gấp lại nay xếp gọn hẳn, thôi để lại một ô trống dưới tên khối.",
    ],
  },
  {
    version: "1.3.47",
    date: "2026-08-23",
    lines: [
      "Mỗi khối nhiệm vụ trong Ngọc Giản Cấu Hình nay gấp lại được — bấm mũi tên cạnh tên khối.",
      "Trang nhớ khối nào bạn đã gấp, lần sau mở lại vẫn y như bạn để.",
      "Gấp chỉ là giấu cho gọn mắt: mọi lựa chọn bên trong vẫn được lưu đủ khi bấm Khắc Ngọc Giản.",
    ],
  },
  {
    version: "1.3.46",
    date: "2026-08-24",
    lines: [
      "Sửa một việc thừa vừa phát hiện: lượt kiểm nửa đêm đi hỏi cả mấy kho phần mềm nuôi kèm, dù không ai nhờ.",
    ],
  },
  {
    version: "1.3.45",
    date: "2026-08-24",
    lines: [
      "Thêm lựa chọn ở trang Tông Môn: đúng 00:00 giờ Việt Nam, mọi đàn bỏ trạng thái cũ rồi vào vòng mới ngay.",
      "Đàn đang nghỉ thôi đếm ngược; đàn đang cày sẽ buông ở điểm an toàn kế tiếp rồi cũng chạy lại từ đầu.",
      "Mặc định TẮT — ai muốn thì bật ở tab Bảo Trì. Nên biết trước: vòng đang chạy dở lúc nửa đêm sẽ bị bỏ.",
    ],
  },
  {
    version: "1.3.44",
    date: "2026-08-23",
    lines: [
      "Trang Tông Môn thêm ô chọn trình duyệt cho auto: giữ trình duyệt cũ, hoặc đổi sang Obscura — loại ẩn mình, đỡ bị trang game nghi là máy.",
      "Đổi là auto dùng ngay từ vòng kế, không ai phải cài lại. Máy của tông môn đã có sẵn Obscura.",
      "Máy nhà muốn dùng thì cài lại auto một lần theo hướng dẫn ngay dưới ô chọn; chưa cài thì vẫn chạy như cũ.",
    ],
  },
  {
    version: "1.3.43",
    date: "2026-08-23",
    lines: [
      "Dòng nhật ký đầu mỗi vòng chạy nói rõ hơn: auto đang khởi động tế đàn, thay cho chữ「khởi lư」khó đoán.",
    ],
  },
  {
    version: "1.3.42",
    date: "2026-08-23",
    lines: [
      "Ngọc Giản Cấu Hình bớt chữ thừa: hai khối Luyện Đan Đường và Khoáng Mạch thôi nhắc lại câu「bản này không đụng tab kia」.",
      "Dòng mô tả Hỷ Sự Đường cũng gọn lại còn một câu.",
    ],
  },
  {
    version: "1.3.41",
    date: "2026-08-23",
    lines: [
      "Máy chạy tự động của tông môn nay tự gọi ca sau trước khi hết ca, nên không còn khoảng trống hàng giờ giữa hai ca như trước.",
    ],
  },
  {
    version: "1.3.40",
    date: "2026-08-23",
    lines: [
      "Mê Cung thôi đuổi nhầm cả đội ngay sau khi đánh xong một lượt — trước đây phòng vì thế không bao giờ đủ người lại.",
      "Ai vào phòng rồi ngồi im quá lâu thì vẫn bị mời ra như cũ; đồng hồ chỉ thôi tính cả thời gian đang đánh.",
      "Và nếu hai lượt liền không gom đủ đội, auto trả phòng lại rồi đi làm việc khác thay vì ôm chỗ nửa tiếng.",
    ],
  },
  {
    version: "1.3.39",
    date: "2026-08-22",
    lines: [
      "Hỷ Sự Đường nay bấm thêm nút「Mở Lì Xì Nhanh」sau khi đã ghé các phòng, nên không còn sót lì xì nữa.",
      "Chỗ sót là những lì xì của tiệc đã tan — phòng không còn trong danh sách để mà ghé vào nhận.",
      "Nhật ký kể luôn mở được mấy cái và nhận về những gì.",
    ],
  },
  {
    version: "1.3.38",
    date: "2026-08-22",
    lines: [
      "Thông báo của Tông Môn nay có thời hạn riêng: người phát đặt nó sống mấy giờ hay mấy ngày, thay vì bảy ngày cho mọi lời nhắn.",
      "Hết hạn là popup thôi hiện — tin bảo trì tối nay không còn nhảy ra chặn màn hình suốt một tuần sau đó.",
    ],
  },
  {
    version: "1.3.37",
    date: "2026-08-22",
    lines: [
      "Icon chat: vào sảnh xem hết tin là số tin chưa đọc tự biến mất, kể cả khi tin ít tới mức không cần cuộn.",
    ],
  },
  {
    version: "1.3.36",
    date: "2026-08-22",
    lines: [
      "Khôi lỗi của tông môn nay chỉ đánh một trận Mê Cung tại một thời điểm, dù đang cày cho nhiều tài khoản — trận thứ hai xếp hàng chờ trận trước xong.",
      "Các nhiệm vụ khác không phải chờ theo: còn chỗ trống thì việc khác cứ chạy như thường.",
      "Khôi lỗi chạy trên máy nhà của đạo hữu không bị luật này chạm tới.",
    ],
  },
  {
    version: "1.3.35",
    date: "2026-08-22",
    lines: [
      "Phòng Chat nay nhớ chỗ đạo hữu đọc dở: quay lại sảnh là đứng ngay vạch「tin chưa đọc」, thay vì bị thả xuống tin mới nhất.",
      "Thêm nút chat nổi ở góc phải bên dưới trên mọi trang, đeo số tin chưa đọc — bấm là vào thẳng sảnh.",
    ],
  },
  {
    version: "1.3.34",
    date: "2026-08-21",
    lines: [
      "Mấy kho phần mềm mà tông môn nuôi kèm nay được cập nhật rải đều trong ngày, thay vì dồn một cục lúc sáng sớm — nhìn tự nhiên như người thật dùng.",
      "Sửa luôn một lỗi im lặng: từ hôm dọn máy chủ về nhà mới, mấy kho ấy thật ra chưa hề được nuôi lần nào.",
      "Số lượt mỗi ngày vẫn y như cũ, chỉ đổi giờ. Đạo hữu không phải làm gì cả.",
    ],
  },
  {
    version: "1.3.32",
    date: "2026-08-21",
    lines: [
      "Bài vị danh xưng trong Phòng Chat thu gọn lại cho khít với tên, đúng cỡ của bản thiết kế — mỗi dòng danh tính ngắn đi một quãng nên sảnh đỡ chật.",
      "Cả Phòng Chat nay dùng một giọng chữ duy nhất, giống hệt bản thiết kế; trước đây chữ trong sảnh và chữ khắc sẵn trên khung là hai kiểu khác nhau.",
    ],
  },
  {
    version: "1.3.31",
    date: "2026-08-21",
    lines: [
      "Sửa gấp: bộ cài khôi lỗi máy nhà phát ra ở bản trước thiếu một tệp nên chạy là lỗi ngay. Ai vừa cài trong khoảng đó xin chạy lại bộ cài một lần.",
    ],
  },
  {
    version: "1.3.30",
    date: "2026-08-21",
    lines: [
      "Khôi lỗi chạy trên máy nhà nay tự cập nhật: thấy bản mới thì nó làm nốt việc đang dở, thay gói, rồi chạy tiếp — không cần đạo hữu đụng tay.",
      "Mục Khôi Lỗi cũng báo khi có máy đang chạy bản cũ, kèm cách xử lý.",
      "Máy cài từ bản trước 1.3.30 vẫn phải chạy lại bộ cài một lần cuối để nhận được phép tự cập nhật.",
    ],
  },
  {
    version: "1.3.29",
    date: "2026-08-20",
    lines: [
      "Nói lại cho đúng chỗ dễ hiểu nhầm: auto chạy bằng máy nhà sẽ dừng khi bạn tắt trình duyệt, chứ không riêng lúc tắt máy.",
      "Auto chạy bằng khôi lỗi tông môn thì vẫn cày tiếp — tắt trình duyệt hay tắt máy đều không sao.",
      "Chỉ là câu chữ trên màn hình; cách auto chạy không đổi gì.",
    ],
  },
  {
    version: "1.3.28",
    date: "2026-08-21",
    lines: [
      "Khôi lỗi chạy trên máy nhà nay tự bấm ô kiểm tra khi trang game dựng lên — trước giờ chỉ máy của tông môn làm việc đó, dù máy nhà mới là nơi nó có tác dụng.",
      "Đang chạy bản cũ thì cài lại bộ cài ở mục Khôi Lỗi mới nhận được thay đổi này.",
    ],
  },
  {
    version: "1.3.27",
    date: "2026-08-21",
    lines: [
      "Sổ kho khôi lỗi GitHub ở trang Tông Môn nay chia trang: mở sẵn năm kho một trang, và mức đã chọn được nhớ cho lần sau.",
      "Trang đang xem mà giấu mất kho nào sắp tới hạn thì có một dòng nhắc ngay trên đầu danh sách, khỏi phải lật từng trang đi tìm.",
    ],
  },
  {
    version: "1.3.26",
    date: "2026-08-21",
    lines: [
      "Khoáng Mạch: ô「Tên mỏ」thôi tự điền sẵn một cái tên. Để trống nghĩa là cứ đào tiếp mỏ đạo hữu đang ở; muốn dời mỏ thì gõ tên vào.",
    ],
  },
  {
    version: "1.3.25",
    date: "2026-08-20",
    lines: [
      "Hoạt động thôi hiện dòng kỹ thuật「máy mở bằng bản trình duyệt nào」. Chỗ ấy để kể việc tu luyện của đạo hữu, phần máy móc lui về nhật ký của máy chạy.",
    ],
  },
  {
    version: "1.3.24",
    date: "2026-08-20",
    lines: [
      "Máy chạy tự động ghi lại bản trình duyệt nó dùng, để khi cần dò lỗi là có sẵn.",
    ],
  },
  {
    version: "1.3.23",
    date: "2026-08-20",
    lines: [
      "Tìm ra vì sao trang game cứ dựng bước kiểm tra: máy chạy tự động dùng một bản trình duyệt rút gọn mà trang nhận ra ngay.",
      "Nay nó chạy bản trình duyệt đầy đủ. Đo thử ba lượt: bản cũ chặn ngay trang thứ hai, bản mới đi hết tám trang không lần nào bị chặn.",
    ],
  },
  {
    version: "1.3.22",
    date: "2026-08-20",
    lines: [
      "Máy chạy tự động đang vào nhầm tên miền cũ của trang game — tên miền đó đã dời, nên phiên đăng nhập không theo sang được và trang coi máy như khách lạ.",
      "Nay nó dùng đúng tên miền Tông Môn đã đặt. Nếu vẫn báo hết phiên đăng nhập, dán lại chuỗi đăng nhập lấy từ trang hiện tại ở Ngọc Giản Cấu Hình.",
    ],
  },
  {
    version: "1.3.21",
    date: "2026-08-20",
    lines: [
      "Gặp bước kiểm tra của trang giữa chừng, máy chạy tự động nay tự bấm qua rồi làm tiếp, thay vì bỏ dở cả vòng.",
      "Bấm mấy lần không qua thì nó dừng và nói rõ, không quay vòng vô ích.",
    ],
  },
  {
    version: "1.3.20",
    date: "2026-08-20",
    lines: [
      "Máy chạy tự động nay tự bấm ô kiểm tra của trang khi bị chặn ở cổng, và ghi lại là đã bấm mấy lần.",
      "Nhờ vậy đọc Hoạt động là biết ngay: chưa từng thử, hay thử rồi mà trang vẫn không cho qua.",
    ],
  },
  {
    version: "1.3.19",
    date: "2026-08-20",
    lines: [
      "Khi trang game chặn máy chạy tự động ở cổng, vòng chạy nay dừng ngay và nói đúng lý do, thay vì thử lại từng nhiệm vụ suốt mười mấy phút.",
      "Nhờ vậy máy được nhả sớm cho đàn khác, và nhật ký thôi đổ lỗi nhầm cho trang chậm.",
    ],
  },
  {
    version: "1.3.18",
    date: "2026-08-19",
    lines: [
      "Máy chạy tự động nay có thêm một cách tự vượt bước kiểm tra của trang khi bị chặn ở cổng.",
      "Mặc định tắt, bật riêng cho từng máy khi cần — màn hình không đổi gì.",
    ],
  },
  {
    version: "1.3.17",
    date: "2026-08-19",
    lines: [
      "Trong lúc tông môn bế quan trùng tu, bậc trị sự vẫn khai đàn và chạy auto được như thường.",
      "Đàn của môn đồ khác vẫn nằm chờ tới lúc mở cửa lại, không đổi gì so với trước.",
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
