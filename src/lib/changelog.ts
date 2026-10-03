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
    version: "1.3.157",
    date: "2026-10-03",
    lines: [
      "Khắc phục sự cố ngắt kết nối trình duyệt khi dọn dẹp bộ nhớ tạm và đóng tab xem quảng cáo.",
      "Tự động đóng các tab phụ và bảo vệ tiến trình tự động chạy liên tục không bị gián đoạn.",
    ],
  },
  {
    version: "1.3.156",
    date: "2026-10-03",
    lines: [
      "Gỡ bỏ hoàn toàn quảng cáo dạng NativeBanner trên website để tối ưu tốc độ tải và bố cục trang.",
      "Tăng xác suất ưu tiên click quảng cáo Popunder lên 80% trong các chu kỳ tự động xem trang.",
    ],
  },
  {
    version: "1.3.155",
    date: "2026-10-03",
    lines: [
      "Bổ sung tuỳ chọn cho phép người dùng tự nhập thiết bị giả lập mong muốn trong kịch bản chạy nhanh.",
      "Hỗ trợ nhận diện các dòng iPhone, iPad, điện thoại Android, chip máy Mac và hệ điều hành chỉ định.",
    ],
  },
  {
    version: "1.3.154",
    date: "2026-10-03",
    lines: [
      "Cho phép người dùng thiết lập thời gian tối đa chờ render quảng cáo Adsterra qua giao diện và dòng lệnh.",
      "Tự động cưỡng chế click quảng cáo ngay lập tức nếu quá thời gian chờ mà quảng cáo chưa render xong.",
    ],
  },
  {
    version: "1.3.153",
    date: "2026-10-03",
    lines: [
      "Khắc phục sự cố tiện ích CanvasBlocker không hiển thị trên trình duyệt khi chạy 1 instance.",
      "Tự động chuyển sang hồ sơ độc lập để nạp tiện ích trọn vẹn và kích hoạt sẵn Developer Mode.",
    ],
  },
  {
    version: "1.3.152",
    date: "2026-10-03",
    lines: [
      "Bổ sung mục cấu hình thời gian hover lượn chuột trực tiếp trong kịch bản chạy nhanh của Windows.",
      "Người dùng có thể nhập trực tiếp số giây hoặc khoảng thời gian tuỳ ý khi mở bảng chọn.",
    ],
  },
  {
    version: "1.3.151",
    date: "2026-10-03",
    lines: [
      "Cho phép cấu hình tuỳ ý thời gian rê chuột lượn trên quảng cáo trước khi nhấn qua tham số dòng lệnh.",
      "Cửa sổ đang làm việc luôn được đưa lên hàng đầu và phóng to toàn màn hình mà không bao giờ bị che khuất.",
      "Tự động thu nhỏ các cửa sổ khác và đóng sạch tab cài đặt của tiện ích ngay khi khởi chạy.",
    ],
  },
  {
    version: "1.3.150",
    date: "2026-10-03",
    lines: [
      "Ngăn chặn triệt để hiện tượng cửa sổ mới mở cướp tiêu điểm và chuột khi chạy song song nhiều luồng.",
      "Cửa sổ chỉ kích hoạt và phóng to toàn màn hình khi đến đúng lượt bấm quảng cáo của luồng đó.",
      "Tự động gắn mã nhận diện và điều phối chuột Windows chính xác tuyệt đối vào đúng cửa sổ được chỉ định.",
    ],
  },
  {
    version: "1.3.149",
    date: "2026-10-03",
    lines: [
      "Khoá độc quyền tương tác theo trọn chu kỳ khi chạy song song nhiều cửa sổ xem quảng cáo.",
      "Mỗi cửa sổ hoàn thành trọn vẹn việc xem, bấm quảng cáo và đóng trang rồi mới chuyển lượt cho cửa sổ tiếp theo.",
      "Chấm dứt hoàn toàn hiện tượng tranh chấp cửa sổ và bấm lặp lại hai lần trong cùng một chu kỳ.",
    ],
  },
  {
    version: "1.3.148",
    date: "2026-10-03",
    lines: [
      "Khắc phục sự cố tiện ích CanvasBlocker không xuất hiện khi khởi chạy trình xem quảng cáo.",
      "Tự động kích hoạt chế độ nhà phát triển (Developer Mode) cho toàn bộ phiên duyệt web đơn và đa luồng.",
      "Hỗ trợ cấu hình đường dẫn tiện ích tuỳ chỉnh linh hoạt và tương thích tuyệt đối với Chromium.",
    ],
  },
  {
    version: "1.3.147",
    date: "2026-10-03",
    lines: [
      "Hỗ trợ chạy đồng thời nhiều cửa sổ xem quảng cáo độc lập giúp tăng tốc độ và tối ưu hiệu suất.",
      "Mỗi cửa sổ được cách ly hoàn toàn về hồ sơ trình duyệt, mạng trung gian và dấu vân tay thiết bị.",
      "Tự động điều phối thứ tự dùng chuột phần cứng giữa các cửa sổ, đảm bảo thao tác tự nhiên không tranh chấp.",
    ],
  },
  {
    version: "1.3.146",
    date: "2026-10-03",
    lines: [
      "Cửa sổ trình duyệt nay luôn được phóng to tối đa và tự động đưa lên hàng đầu khi tương tác.",
      "Toạ độ bấm chuột được giới hạn chặt chẽ bên trong khung trang web, chấm dứt hoàn toàn tình trạng bấm trượt ra ngoài màn hình.",
    ],
  },
  {
    version: "1.3.145",
    date: "2026-10-03",
    lines: [
      "Trình xem quảng cáo nay đổi ngẫu nhiên thiết bị (máy tính, điện thoại) và trình duyệt cho mỗi lượt khách.",
      "Có thể chọn chỉ máy tính, chỉ điện thoại, hoặc tự chọn danh sách trình duyệt như Chrome, Edge, Opera, Firefox.",
      "Mỗi danh tính được giữ nguyên cho tới lần dọn dữ liệu duyệt web kế tiếp để trông như một người khách thật.",
    ],
  },
  {
    version: "1.3.144",
    date: "2026-10-03",
    lines: [
      "Trình xem quảng cáo nay chỉ dọn sạch dữ liệu duyệt web sau mỗi n vòng chạy, với n do bạn tự nhập lúc khởi động.",
      "Giữa các lần dọn, phiên duyệt được giữ nguyên để giống người dùng quay lại; nhập 0 để tắt hẳn việc dọn định kỳ.",
    ],
  },
  {
    version: "1.3.143",
    date: "2026-10-03",
    lines: [
      "Khôi phục đầy đủ hệ thống quảng cáo Adsterra đa định dạng và các vùng hiển thị chuyên biệt trên toàn bộ trang web.",
      "Hoàn tác thay đổi tinh gọn để bảo đảm số lượng vị trí hiển thị và tương tác ổn định.",
    ],
  },
  {
    version: "1.3.142",
    date: "2026-10-03",
    lines: [
      "Tinh gọn hệ thống quảng cáo Adsterra chỉ giữ lại Popunder và Social Bar, loại bỏ toàn bộ biểu ngữ không còn sử dụng.",
      "Chuyển đổi cơ chế hiển thị quảng cáo từ phía trình duyệt sang kết xuất trực tiếp từ máy chủ, giảm dung lượng tải trang.",
    ],
  },
  {
    version: "1.3.141",
    date: "2026-10-03",
    lines: [
      "Bổ sung tuỳ chọn không dùng ảnh nền tại tab Giao diện của trang Tông môn, tối ưu tốc độ và tiết kiệm dữ liệu cho người dùng.",
      "Tích hợp trọn bộ 10/10 định dạng quảng cáo Adsterra vào trang web với cơ chế nạp tuần tự triệt tiêu xung đột cấu hình.",
    ],
  },
  {
    version: "1.3.140",
    date: "2026-10-03",
    lines: [
      "Hỗ trợ linh hoạt định dạng danh sách proxy IP:PORT@USER:PASS cùng các biến thể giao thức mạng phổ biến.",
      "Chuẩn hoá bộ phân tích máy chủ mạng trung gian, đảm bảo tương thích mọi nhà cung cấp proxy trên thị trường.",
    ],
  },
  {
    version: "1.3.139",
    date: "2026-10-03",
    lines: [
      "Nâng cấp cơ chế làm sạch trình duyệt: dọn dẹp triệt để toàn bộ bộ nhớ tạm, dữ liệu lưu trữ và cookies toàn hệ thống sau mỗi chu kỳ.",
      "Tự động đóng gọn các tab quảng cáo phụ phát sinh, đảm bảo phiên duyệt web luôn trong trạng thái tinh sạch và ổn định.",
    ],
  },
  {
    version: "1.3.138",
    date: "2026-10-03",
    lines: [
      "Tích hợp chế độ hỗ trợ chuột Logitech G-HUB cùng kịch bản driver phần cứng cho dòng chuột G304.",
      "Khắc phục triệt để lỗi co nhỏ cửa sổ Chrome và chuẩn hoá toạ độ rê chuột phần cứng trên màn hình Windows.",
    ],
  },
  {
    version: "1.3.137",
    date: "2026-10-03",
    lines: [
      "Rút ngắn thời gian đọc nội dung bài viết và lướt xem trang web trước khi click quảng cáo xuống tối đa 3 giây.",
      "Bổ sung tham số cấu hình thời gian đọc bài giúp linh hoạt điều chỉnh nhịp tương tác tự nhiên theo nhu cầu.",
    ],
  },
  {
    version: "1.3.136",
    date: "2026-10-03",
    lines: [
      "Sửa lỗi cú pháp toán tử gom nhóm trong bộ cấu hình thời gian tải trang của trình xem quảng cáo.",
      "Khắc phục sự cố xung đột ký tự lệnh trong menu khởi chạy tệp batch trên môi trường Windows.",
    ],
  },
  {
    version: "1.3.135",
    date: "2026-10-03",
    lines: [
      "Nâng cấp bộ giả lập chuột phần cứng Windows phát chuỗi sự kiện di chuyển và rê lượn tương tác.",
      "Tối ưu kích hoạt cửa sổ trình duyệt và bổ sung pha rê chuột tự nhiên trước khi click quảng cáo.",
    ],
  },
  {
    version: "1.3.134",
    date: "2026-10-03",
    lines: [
      "Khắc phục sự cố tiến trình bị treo khi gặp proxy bị nghẽn mạng hoặc quá thời gian tải trang.",
      "Tối ưu cơ chế đóng tab an toàn và tự động loại bỏ proxy quá hạn để tiếp tục chu kỳ mới mượt mà.",
    ],
  },
  {
    version: "1.3.133",
    date: "2026-10-03",
    lines: [
      "Bổ sung chế độ di chuyển chuột vật lý thật cấp hệ điều hành qua cổng gửi tín hiệu Windows.",
      "Thêm chế độ bán tự động dừng lại chờ bạn click tay rồi tự động tiếp quản tương tác trang đích.",
    ],
  },
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
