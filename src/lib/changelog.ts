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
    version: "1.3.132",
    date: "2026-10-03",
    lines: [
      "Tự động loại bỏ proxy chết khỏi danh sách và cập nhật tệp trên đĩa ngay khi phát hiện lỗi kết nối.",
      "Thêm cơ chế kiểm tra kết nối mạng chủ để bảo vệ danh sách proxy không bị xoá nhầm khi mất mạng.",
    ],
  },
  {
    version: "1.3.131",
    date: "2026-10-03",
    lines: [
      "Quét song song đồng thời nhiều proxy giúp tìm ra địa chỉ sống siêu tốc trong vài trăm mili-giây.",
      "Sửa lỗi nhận diện số lượt click đệ quy trên trang đích khi người dùng nhập số 0.",
    ],
  },
  {
    version: "1.3.130",
    date: "2026-10-02",
    lines: [
      "Tích hợp Patched Chromium Engine triệt tiêu dấu hiệu tự động hoá và rò rỉ kênh gỡ lỗi của trình duyệt.",
      "Mô phỏng hành vi đọc trang và trải nghiệm sâu trên trang đích giúp tương tác quảng cáo tự nhiên hơn.",
    ],
  },
  {
    version: "1.3.129",
    date: "2026-10-02",
    lines: [
      "Khắc phục sự cố tệp kịch bản batch bị đóng đột ngột khi nhập thông tin cấu hình trên Windows.",
      "Tăng cường khả năng nhận diện proxy hợp lệ qua cơ chế thử nghiệm đường truyền HTTP CONNECT.",
    ],
  },
  {
    version: "1.3.128",
    date: "2026-10-02",
    lines: [
      "Bảng điều khiển web tập trung toàn bộ cho trạm khôi lỗi; tính năng xem quảng cáo chuyển sang chạy cục bộ.",
      "Tự động xoay proxy mỗi chu kỳ kèm đồng bộ múi giờ, vị trí địa lý và chống rò rỉ kết nối trình duyệt.",
    ],
  },
  {
    version: "1.3.127",
    date: "2026-10-02",
    lines: [
      "Hỗ trợ liên kết trực tiếp vào thư mục hồ sơ duyệt web mặc định của người dùng trên máy.",
      "Vượt qua kiểm tra bảo mật của trình duyệt để sử dụng đầy đủ cấu hình và tiện ích gốc.",
    ],
  },
  {
    version: "1.3.126",
    date: "2026-10-02",
    lines: [
      "Tự động phát hiện và nạp toàn bộ tiện ích mở rộng đang cài trên Chrome chính của máy khi chạy xem quảng cáo.",
      "Kết nối nhanh qua cổng gỡ lỗi mà không gây xung đột với phiên duyệt web cá nhân đang mở.",
    ],
  },
  {
    version: "1.3.125",
    date: "2026-10-02",
    lines: [
      "Hỗ trợ kết nối và điều khiển trực tiếp Chrome chính của máy, bảo toàn toàn bộ tiện ích mở rộng đang cài đặt.",
      "Cơ chế dọn dẹp dữ liệu có chọn lọc bảo vệ an toàn các phiên đăng nhập cá nhân sau mỗi chu kỳ xem quảng cáo.",
    ],
  },
  {
    version: "1.3.124",
    date: "2026-10-02",
    lines: [
      "Kho Xem Quảng Cáo chuyển tiện ích chống nhận diện dấu vân tay thành tuỳ chọn linh hoạt qua cờ dòng lệnh.",
      "Mặc định chạy trên trình duyệt tiêu chuẩn sạch, giúp giảm thiểu các dấu hiệu bất thường khi tương tác.",
    ],
  },
  {
    version: "1.3.123",
    date: "2026-10-02",
    lines: [
      "Kho Xem Quảng Cáo nâng cấp cơ chế tương tác quảng cáo bằng mô phỏng hành vi người dùng tự nhiên, chống phát hiện tự động hoá.",
      "Di chuyển chuột theo đường cong mượt mà và click tại vị trí lệch ngẫu nhiên, có thể chọn chế độ tương tác khác nhau.",
    ],
  },
  {
    version: "1.3.122",
    date: "2026-10-02",
    lines: [
      "Kho Xem Quảng Cáo tự động dọn dẹp sạch sẽ bộ nhớ đệm và dữ liệu duyệt web sau mỗi chu kỳ hoạt động.",
      "Lựa chọn ngẫu nhiên vị trí và liên kết quảng cáo để tương tác, tăng cường tính tự nhiên cho phiên xem.",
    ],
  },
  {
    version: "1.3.121",
    date: "2026-10-02",
    lines: [
      "Kho Xem Quảng Cáo chuyển về trình duyệt Chromium tiêu chuẩn cùng tiện ích mở rộng chống nhận diện dấu vân tay.",
      "Tự động chuẩn bị môi trường và kích hoạt chế độ mở rộng an toàn cho các phiên xem trên máy.",
    ],
  },
  {
    version: "1.3.120",
    date: "2026-10-02",
    lines: [
      "Kho Xem Quảng Cáo chuyển sang trình duyệt Obscura độc lập, kết nối điều khiển trực tiếp qua giao thức mở.",
      "Tích hợp giải pháp chống nhận diện dấu vân tay CanvasBlocker trực tiếp vào phiên duyệt web của trình duyệt mới.",
    ],
  },
  {
    version: "1.3.119",
    date: "2026-10-02",
    lines: [
      "Bật chế độ Developer Mode cho tiện ích CanvasBlocker trong profile và cờ khởi chạy trình duyệt của kho Xem Quảng Cáo.",
      "Kho Xem Quảng Cáo tự động kích hoạt chế độ nhà phát triển và bổ sung lệnh chạy trực quan trên màn hình máy tính.",
    ],
  },
  {
    version: "1.3.118",
    date: "2026-10-02",
    lines: [
      "Kho Xem Quảng Cáo bổ sung hỗ trợ click trực tiếp Adsterra Smartlink và bộ chọn dự phòng mở rộng.",
      "Tự động chuyển đổi linh hoạt kênh trình duyệt khi khởi chạy, bảo đảm không bị gián đoạn giữa chừng.",
    ],
  },
  {
    version: "1.3.117",
    date: "2026-10-02",
    lines: [
      "Kho Xem Quảng Cáo khôi phục đầy đủ tính năng tương tác: click vào creative banner và native để mở trang đích.",
      "Tự động đọc trang quảng cáo chính, click tiếp đệ quy tối đa 2 lần, dọn sạch dữ liệu duyệt web sau mỗi chu kỳ và chạy liên tục.",
    ],
  },
  {
    version: "1.3.116",
    date: "2026-10-02",
    lines: [
      "Thời gian render quảng cáo nay được đo tới lúc banner và native thực sự có creative, không dừng sớm ở trạng thái DOM.",
      "Lượt kiểm tra chỉ tự chạy lại khi cần tải runtime mới; hoàn tất bình thường sẽ chờ lịch bốn giờ.",
    ],
  },
  {
    version: "1.3.115",
    date: "2026-10-02",
    lines: [
      "Kho Xem Quảng Cáo nay báo rõ banner và native là ready, blocked hay no-fill, kèm số creative, thời gian render và kích thước.",
      "Mỗi lượt chỉ kiểm tra một lần và không tự bấm quảng cáo production, giúp phân biệt lỗi tải tag với trường hợp thiếu fill.",
    ],
  },
  {
    version: "1.3.114",
    date: "2026-10-02",
    lines: [
      "Kho Xem Quảng Cáo nay mặc định mở đúng tên miền chính thức, nơi các vị trí quảng cáo được bật.",
      "Tạo mới, đưa kho phụ lên làm kho chính và phát hành lại đều giữ mặc định này, không tự quay về hostname máy chủ cũ.",
    ],
  },
  {
    version: "1.3.113",
    date: "2026-10-02",
    lines: [
      "Sửa lỗi kho ở mục Xem Quảng Cáo và repo phụ được đưa lên làm kho chính bị chạy nhầm nhiệm vụ tông môn.",
      "Cơ chế thiết lập nay nhận diện chính xác mục đích từng kho, đảm bảo tự động chạy đúng kịch bản xem trang.",
    ],
  },
  {
    version: "1.3.112",
    date: "2026-10-02",
    lines: [
      "Kho GitHub nay hỗ trợ phân loại Khôi Lỗi và Xem Quảng Cáo, dùng chung cơ chế nuôi và tạo kho.",
      "Thêm chu kỳ xem quảng cáo tự động kèm tiện ích CanvasBlocker, dọn sạch dữ liệu duyệt sau mỗi lượt.",
    ],
  },
  {
    version: "1.3.111",
    date: "2026-10-01",
    lines: [
      "Biểu ngữ Adsterra nay hiện cả trên điện thoại và tự co theo bề ngang màn hình, không tạo cuộn ngang.",
      "Native Banner, Social Bar, Popunder và liên kết tài trợ vẫn dùng cùng luật route, tài khoản và xử lý slot bị chặn như bản máy tính.",
    ],
  },
  {
    version: "1.3.110",
    date: "2026-10-01",
    lines: [
      "Dòng chữ Quảng cáo phía trên khu tài trợ đã được bỏ để trang gọn và liền mạch hơn.",
      "Nếu trình duyệt chặn hoặc zone không có nội dung, khung trống tự thu lại; website không tự vượt cơ chế chặn của trình duyệt.",
    ],
  },
  {
    version: "1.3.109",
    date: "2026-10-01",
    lines: [
      "Website nay có thêm quảng cáo Adsterra gồm biểu ngữ, đề xuất nội dung, Social Bar và Popunder trên tên miền chính thức.",
      "Quản trị viên, máy local và tên miền cũ vẫn không tải quảng cáo; mọi định dạng có thể dừng khẩn cấp từ cấu hình máy chủ.",
    ],
  },
  {
    version: "1.3.108",
    date: "2026-09-30",
    lines: [
      "Phòng chat nổi không còn kéo bạn về tin mới nhất khi đang đọc lại những lời cũ.",
      "Tin mới đến lúc bạn đang ở phía trên sẽ hiện số chưa đọc trên biểu tượng; về cuối mới tính là đã xem.",
    ],
  },
  {
    version: "1.3.107",
    date: "2026-09-30",
    lines: [
      "Góc phải nay có Trò chuyện, Phòng chat và Thành viên; mọi box mở ngay tại trang đang xem.",
      "Bạn có thể nhắn riêng, tìm đạo hữu, xem ai online hoặc đang bận và tự chọn trạng thái của mình.",
      "Trang Hồ Sơ nay cho đổi mật khẩu sau khi xác nhận mật khẩu hiện tại.",
    ],
  },
  {
    version: "1.3.106",
    date: "2026-09-30",
    lines: [
      "Vấn Đáp nay nhận diện giao diện mới cho cả tài khoản VIP và thường.",
      "Khôi lỗi đọc đúng nội dung đáp án, không còn nhầm chữ A, B, C, D vào tên lựa chọn.",
      "Trạng thái trả lời và hoàn thành được chờ theo trang thật thay vì bộ chọn cũ.",
    ],
  },
  {
    version: "1.3.105",
    date: "2026-09-29",
    lines: [
      "Tài khoản thường nay có thể bỏ giới hạn huyền tinh khi giao đàn riêng cho khôi lỗi máy nhà.",
      "Khôi lỗi tông môn và lựa chọn ai rảnh cũng được vẫn giữ giới hạn để không chiếm ghế chung quá lâu.",
      "Đổi loại khôi lỗi trên màn hình sẽ mở hoặc khoá tuỳ chọn ngay, không cần tải lại trang.",
    ],
  },
  {
    version: "1.3.104",
    date: "2026-09-29",
    lines: [
      "Repo phụ nay có thể được đưa lên làm repo chính từ giao diện web hoặc một tệp BAT chạy trên máy Windows bất kỳ.",
      "Khi promote có thể giữ nguyên, chuyển công khai hoặc chuyển riêng tư; source và lịch sử Git vẫn được giữ nguyên.",
      "Nếu lượt đổi vai trò hỏng giữa chừng, hệ thống trả lại quyền truy cập và trạng thái chạy cũ trước khi báo lỗi.",
    ],
  },
  {
    version: "1.3.103",
    date: "2026-09-29",
    lines: [
      "Kho Github tạo mới, kho vừa đổi vai trò và các khôi lỗi đang trực nay dùng cùng một khuôn vận hành.",
      "Khôi lỗi trên Github thấy trạm đổi bản sẽ chờ việc đang làm xong rồi tự mở ca mới, không phải chờ lịch bốn giờ.",
      "Mã dự án cũ vẫn được giữ nguyên; Jarvis chỉ quản lý phần điều khiển khôi lỗi.",
    ],
  },
  {
    version: "1.3.102",
    date: "2026-09-29",
    lines: [
      "Điểm Danh tài khoản thường nay nhận diện lịch mới, con dấu điểm danh và trạng thái ô hôm nay đã nhận.",
      "Phúc Lợi Đường và Thí Luyện Tông Môn đã chuyển sang bộ đếm, data-state và đồng hồ mới của trang.",
      "Hồ sơ nhiệm vụ được nâng cấp để tự thay cách chạy cũ; ba flow mới có kiểm thử Chromium và không dùng dấu mốc giao diện đã mất.",
    ],
  },
  {
    version: "1.3.101",
    date: "2026-09-27",
    lines: [
      "Web đã sẵn sàng cho Google AdSense bằng mã nhà xuất bản ca-pub, ads.txt và trang quyền riêng tư công khai.",
      "Quảng cáo chỉ bật trên tên miền chính thức; phiên quản trị được miễn để giảm nguy cơ bấm nhầm quảng cáo của chính mình.",
      "Khoá Google do người dùng cung cấp không được đưa vào mã nguồn; quảng cáo chỉ dùng mã nhà xuất bản công khai.",
    ],
  },
  {
    version: "1.3.100",
    date: "2026-09-27",
    lines: [
      "Trang Tên Miền nay gọn hơn, chỉ giữ tên miền, trạng thái, vai trò và nút mở cần thiết.",
      "Các đoạn giải thích dài, Luồng chuyển tiếp và Khuyến nghị đã được bỏ khỏi trang.",
    ],
  },
  {
    version: "1.3.99",
    date: "2026-09-27",
    lines: [
      "Tên Miền nay nằm ngay trên thanh menu; khách, tài khoản chờ duyệt, thành viên và quản trị đều xem được.",
      "Trang Tông Môn không còn chứa mục này; thông tin tên miền được mở ở một trang chung riêng.",
      "Địa chỉ cũ vẫn giữ đúng đường dẫn đang mở khi chuyển sang tên miền chính thức.",
    ],
  },
  {
    version: "1.3.98",
    date: "2026-09-27",
    lines: [
      "Tông Môn có tab Tên miền mới, cho biết rõ địa chỉ nào đang hoạt động và địa chỉ nào đã đóng.",
      "Người mở địa chỉ cũ sẽ thấy trang hướng dẫn thân thiện rồi được chuyển sau 8 giây tới đúng đường dẫn trên tên miền mới.",
      "Khôi lỗi và bộ cài không còn gọi địa chỉ đã đóng; mọi đường dự phòng nay dùng tên miền chính thức.",
    ],
  },
  {
    version: "1.3.97",
    date: "2026-09-27",
    lines: [
      "Web production nay có địa chỉ riêng auto-hh3d.online; www cũng vào cùng một trang và đều dùng HTTPS.",
      "Địa chỉ sslip.io cũ vẫn được giữ làm đường dự phòng vận hành, không ảnh hưởng các khôi lỗi đang chạy.",
    ],
  },
  {
    version: "1.3.96",
    date: "2026-09-27",
    lines: [
      "Đường dự phòng của khôi lỗi nay ghi nhớ địa chỉ trạm gương trong một ngày, giảm các lượt hỏi mạng lặp lại.",
      "Nếu lần phân giải bị lỗi, khôi lỗi sẽ thử lại ở lượt kế thay vì giữ một kết quả hỏng suốt ngày.",
    ],
  },
  {
    version: "1.3.95",
    date: "2026-09-26",
    lines: [
      "Khôi lỗi GitHub nay được soát đủ cả đường chính lẫn đường dự phòng trước khi phát bản mới.",
      "Thiếu hoặc lặp một đường kết nối sẽ bị chặn từ đầu, không để ca mới khởi động với lối dự phòng hỏng.",
    ],
  },
  {
    version: "1.3.94",
    date: "2026-09-26",
    lines: [
      "Khôi lỗi nay chỉ dùng Chromium; lựa chọn trình duyệt thứ hai và phần cài đặt liên quan đã được gỡ khỏi Tông Môn.",
      "Promote repo phụ giờ giữ nguyên toàn bộ dự án, chỉ thêm phần vận hành khôi lỗi và không chép đè các tệp sẵn có.",
      "Repo chính sau promote vẫn được nuôi tiếp phần dự án cũ; phần vận hành tự động được bảo vệ riêng và kho không thể bị xoá nhầm.",
    ],
  },
  {
    version: "1.3.93",
    date: "2026-09-26",
    lines: [
      "Nút ép khôi lỗi lên bản mới nay vẫn cập nhật các kho khỏe dù một kho khác đã mất hoặc hết quyền truy cập.",
      "Kho lỗi được báo riêng để sửa sau; chỉ khi không còn kho nào làm được thì lượt ép mới dừng toàn bộ.",
      "Kết quả một phần được nói rõ, nên không còn cảnh bấm script rồi mọi kho đều đứng nguyên vì một dòng 404.",
    ],
  },
  {
    version: "1.3.92",
    date: "2026-09-26",
    lines: [
      "Hoang Vực nay nhận đúng trạng thái hết 5 lượt từ bộ đếm của trang, kể cả khi nút Khiêu Chiến vẫn còn hiện.",
      "Bản VIP và thường cùng dùng flow mới; lượt thứ năm được chốt ngay trong lượt chạy và không bị đánh lại.",
      "Lưới Chromium khóa cả trang đã hết lượt, đòn thứ năm và đòn thường còn hồi chiêu.",
    ],
  },
  {
    version: "1.3.91",
    date: "2026-09-24",
    lines: [
      "Nuôi kho GitHub nay có nút Promote trên từng repo phụ để đổi repo ấy thành repo chính mà vẫn giữ lịch sử mã.",
      "Nếu đã có repo chính, repo cũ tự chuyển thành repo phụ và ngừng chạy khôi lỗi; nếu đang hoãn repo chính thì không tạo thêm repo cũ.",
      "Lượt đổi vai trò tự khóa các thao tác liên quan và hoàn tác an toàn khi lỗi, tránh hai khôi lỗi cùng chạy một danh tính.",
    ],
  },
  {
    version: "1.3.90",
    date: "2026-09-21",
    lines: [
      "Nuôi kho GitHub nay gỡ được kho trong sổ ngay cả khi tài khoản GitHub đã bị xoá bên ngoài.",
      "Nút Xoá gửi đúng thông tin xác nhận danh sách repo chính; repo phụ vẫn không nhận lệnh xoá.",
    ],
  },
  {
    version: "1.3.89",
    date: "2026-09-21",
    lines: [
      "Nuôi kho GitHub nay có thể chỉ tạo/nuôi repo phụ trước; khi bỏ chế độ hoãn, repo chính và khôi lỗi chính mới được mở mà không mất các repo phụ.",
      "Auto chuyển Hẹn giờ quest sang cột trái, có thể gấp/mở; các nút Mở/Gấp của quest cũng lớn và dễ bấm hơn.",
      "Profile GitHub mới được Ollama điền bio/name an toàn khi PAT có quyền user; avatar vẫn giữ nguyên vì PAT không hỗ trợ đổi ảnh tự động.",
    ],
  },
  {
    version: "1.3.88",
    date: "2026-09-21",
    lines: [
      "Trong Phòng Chat, bấm khung tin được trả lời nay tự đưa bạn về đúng tin gốc và làm nó sáng nhẹ để dễ nhận ra.",
      "Tin gốc nằm ở lịch sử cũ thì sảnh tự lật tới đúng chỗ; tin đã hết hạn sẽ báo rõ thay vì bấm mà không có phản hồi.",
    ],
  },
  {
    version: "1.3.87",
    date: "2026-09-20",
    lines: [
      "Tab Auto nay hẹn được từng quest theo giờ, phút, giây mỗi ngày; tới đúng mốc quest mới bắt đầu chạy.",
      "Khai Đàn và chỉ tiêu ngày vẫn giữ nguyên luật cũ: Thu Đàn là dừng, còn hub đủ lượt rồi thì lịch không chạy lại.",
    ],
  },
  {
    version: "1.3.86",
    date: "2026-09-20",
    lines: [
      "Hoang Vực nay đọc đúng đồng hồ Hồi chiêu mới của trang, nên 14p 50s không còn bị hiểu thành 50 giây.",
      "Cả tài khoản VIP lẫn thường vẫn dùng chung flow; các nút Đổi hệ, Khiêu Chiến và Tấn Công hiện tại đều được giữ nguyên.",
    ],
  },
  {
    version: "1.3.85",
    date: "2026-09-20",
    lines: [
      "Auto nay nghỉ ít nhất khoảng 10 phút giữa hai vòng khi nhiệm vụ ngày vẫn còn dở, thay vì có lúc quay lại sau vài chục giây.",
      "Khi nhiệm vụ ngày đã đủ lượt, auto lại theo thời gian chờ thật của những việc còn lại như trước.",
    ],
  },
  {
    version: "1.3.84",
    date: "2026-09-19",
    lines: [
      "Phiên đăng nhập mới lấy từ hoathinh3d.de nay dùng được ngay cả khi cấu hình tông môn vẫn còn tên miền .so.",
      "Bản xuất từ trang khác vẫn bị chặn, nên việc tự theo tên miền mới không làm lỏng lớp bảo vệ đăng nhập.",
    ],
  },
  {
    version: "1.3.83",
    date: "2026-09-14",
    lines: [
      "Khi tạo kho GitHub lỗi, màn hình nay nói rõ PAT bị từ chối, còn thiếu quyền nào hoặc trường nào chưa hợp lệ.",
      "Mỗi lỗi có mã để tra cứu an toàn; bộ dựng kho cũng giữ đúng định dạng tệp khi phát hành từ Windows.",
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
