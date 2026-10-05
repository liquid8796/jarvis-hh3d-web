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
    version: "1.3.187",
    date: "2026-10-05",
    lines: [
      "Nhận đúng bản xuất đăng nhập HH3D mới từ hoathinh3d.you, kể cả khi cấu hình cũ vẫn còn trỏ .de.",
      "Khôi lỗi tự theo tên miền của bản xuất cùng họ hoathinh3d và không để dữ liệu của trang khác đổi nơi chạy.",
    ],
  },
  {
    version: "1.3.186",
    date: "2026-10-05",
    lines: [
      "Khắc phục sự cố sập cửa sổ dòng lệnh khi chọn nguồn lưu lượng trong công cụ xem quảng cáo.",
      "Tối ưu hoá cú pháp xử lý khối lệnh batch và chuẩn hoá tỉ lệ phần trăm nhập vào.",
    ],
  },
  {
    version: "1.3.185",
    date: "2026-10-05",
    lines: [
      "Bổ sung tuỳ chọn nguồn lưu lượng đa dạng cho công cụ xem trang và tương tác.",
      "Hỗ trợ cấu hình tỉ lệ điều phối tự nhiên giữa các nguồn và truy cập trực tiếp.",
    ],
  },
  {
    version: "1.3.184",
    date: "2026-10-05",
    lines: [
      "Tích hợp thẻ đo lường Google Tag chính thức trên tên miền website.",
      "Tối ưu vị trí tải thẻ ngay đầu trang phục vụ kiểm tra và phân tích lưu lượng.",
    ],
  },
  {
    version: "1.3.183",
    date: "2026-10-04",
    lines: [
      "Bổ sung tuỳ chọn bật/tắt cơ chế Anti-Detect Proxy (đồng bộ Timezone, Geolocation, Locale và chống rò rỉ WebRTC).",
      "Khắc phục sự cố proxy cố định bị rơi về IP trực tiếp của máy sau chu kỳ duyệt web đầu tiên.",
    ],
  },
  {
    version: "1.3.182",
    date: "2026-10-04",
    lines: [
      "Tối ưu bộ công cụ xem quảng cáo tự động hoá theo cơ chế AutoTag Adcash.",
      "Khắc phục triệt để sự cố tiến trình bị treo khi tương tác đệ quy trang đích.",
    ],
  },
  {
    version: "1.3.181",
    date: "2026-10-04",
    lines: [
      "Gỡ bỏ toàn bộ biểu ngữ và kịch bản cũ, thiết lập duy nhất AutoTag Adcash mới.",
      "Tối ưu hoá giao diện gọn nhẹ và nâng cấp công cụ tự động xem quảng cáo.",
    ],
  },
  {
    version: "1.3.180",
    date: "2026-10-04",
    lines: [
      "Cập nhật cấu hình 5 vùng quảng cáo mới từ Adcash (Autotag, Pop-Under, 2 sườn 160×600 và Leaderboard 728×90).",
      "Tối ưu hoá vị trí hiển thị cân đối hai bên trang chủ và nâng cấp kịch bản kiểm tra tự động.",
    ],
  },
  {
    version: "1.3.179",
    date: "2026-10-04",
    lines: [
      "Khắc phục sự cố biểu ngữ quảng cáo đè lên giao diện Hàng Đợi Công Việc và Phòng Chat.",
      "Tối ưu hoá phạm vi hiển thị biểu ngữ sườn chỉ xuất hiện tại trang chủ công khai.",
    ],
  },
  {
    version: "1.3.178",
    date: "2026-10-04",
    lines: [
      "Tích hợp thêm 2 định dạng quảng cáo Adcash gồm Pop-Under và biểu ngữ dọc 160×600.",
      "Tối ưu hoá vị trí hiển thị sườn desktop và nâng cấp bộ công cụ nhận diện quảng cáo.",
    ],
  },
  {
    version: "1.3.177",
    date: "2026-10-04",
    lines: [
      "Khắc phục sự cố tràn bộ đệm giao thức PipeTransport khi gặp trang quảng cáo tải luồng dữ liệu lớn.",
      "Tự động loại trừ các nút tải tệp tin và huỷ tải xuống ngầm nhằm đảm bảo tiến trình chạy liên tục.",
    ],
  },
  {
    version: "1.3.176",
    date: "2026-10-04",
    lines: [
      "Bộ công cụ xem quảng cáo tối ưu hoá nhận diện nhanh trạng thái nạp tự động của Adcash AutoTag.",
      "Mô phỏng hành vi đọc bài viết tự nhiên và bổ sung danh sách bộ chọn dự phòng chuẩn xác.",
    ],
  },
  {
    version: "1.3.175",
    date: "2026-10-04",
    lines: [
      "Tích hợp mã nhúng tự động AutoTag của mạng quảng cáo Adcash và tạm dừng hiển thị Adsterra.",
      "Bộ công cụ xem quảng cáo bổ sung mục tiêu Adcash và tuỳ chọn linh hoạt giữa các nhà mạng.",
    ],
  },
  {
    version: "1.3.174",
    date: "2026-10-04",
    lines: [
      "Kích hoạt trở lại toàn diện mạng quảng cáo Adsterra trên website song hành cùng Clickadu.",
      "Bộ công cụ xem quảng cáo tự động mặc định tương tác đồng thời mọi nhà mạng khả dụng.",
    ],
  },
  {
    version: "1.3.173",
    date: "2026-10-04",
    lines: [
      "Thêm thẻ xác thực quyền sở hữu website cho mạng quảng cáo Clickadu và tạm dừng hiển thị Adsterra.",
      "Bộ công cụ xem quảng cáo bổ sung tuỳ chọn lựa chọn linh hoạt giữa Clickadu, Adsterra hoặc toàn bộ nhà mạng.",
    ],
  },
  {
    version: "1.3.172",
    date: "2026-10-04",
    lines: [
      "Kho Xem Quảng Cáo khắc phục triệt để sự cố lặp click kéo dài trong chế độ ưu tiên quảng cáo ngầm và thanh nổi.",
      "Loại bỏ danh sách quảng cáo đề xuất khỏi dự phòng và giới hạn số lượt thử nhằm hoàn tất chu kỳ đúng hạn.",
    ],
  },
  {
    version: "1.3.171",
    date: "2026-10-04",
    lines: [
      "Kho Xem Quảng Cáo nâng cấp cơ chế quét toàn bộ các khung biểu ngữ và tính toạ độ an toàn cho quảng cáo ngầm.",
      "Tối ưu hoá nhận diện nội dung sáng tạo trên các kích thước biểu ngữ mới, loại bỏ tình trạng kích hoạt cưỡng chế sớm.",
    ],
  },
  {
    version: "1.3.170",
    date: "2026-10-04",
    lines: [
      "Cập nhật chính xác mã nhúng và khoá nhận diện cho toàn bộ sáu định dạng biểu ngữ quảng cáo.",
      "Đảm bảo các thẻ kịch bản tuân thủ đúng định dạng nhà phát hành và hiển thị ổn định trên trang.",
    ],
  },
  {
    version: "1.3.169",
    date: "2026-10-04",
    lines: [
      "Kho Xem Quảng Cáo bổ sung cơ chế bọc thời gian chờ và chống treo cho chuỗi tương tác click.",
      "Tự động phát hiện toạ độ click Popunder an toàn và dự phòng mượt mà khi trình duyệt phân luồng.",
    ],
  },
  {
    version: "1.3.168",
    date: "2026-10-04",
    lines: [
      "Tách Native Banner thành khối độc lập, đảm bảo nạp đầy đủ nội dung khi đặt trong Portal.",
      "Ổn định toàn bộ chu trình hiển thị quảng cáo Adsterra trên cả máy tính lẫn di động.",
    ],
  },
  {
    version: "1.3.167",
    date: "2026-10-04",
    lines: [
      "Tối ưu hoá cơ chế nhận diện trạng thái nạp quảng cáo Adsterra cho biểu ngữ và Native.",
      "Loại bỏ tình trạng ẩn nhầm quảng cáo khi mạng quảng cáo chưa kịp phân phối nội dung.",
    ],
  },
  {
    version: "1.3.166",
    date: "2026-10-04",
    lines: [
      "Khắc phục sự cố không hiển thị quảng cáo Native Banner và biểu ngữ trên trang chủ.",
      "Cập nhật mã khoá chính xác theo tệp cấu hình gốc và ổn định luồng nạp quảng cáo.",
    ],
  },
  {
    version: "1.3.165",
    date: "2026-10-04",
    lines: [
      "Chuyển khu vực quảng cáo lên trước block tính năng và bổ sung hai banner sườn hai bên trang.",
      "Hỗ trợ song ngữ Anh - Việt cho toàn bộ trang chủ và thiết lập tiếng Anh làm ngôn ngữ mặc định.",
    ],
  },
  {
    version: "1.3.164",
    date: "2026-10-04",
    lines: [
      "Loại bỏ hoàn toàn các cấu hình chuyển tiếp trung gian không còn sử dụng.",
      "Hệ thống tập trung vận hành trực tiếp trên hạ tầng máy chủ chính thức và các trạm phụ trợ.",
    ],
  },
  {
    version: "1.3.163",
    date: "2026-10-04",
    lines: [
      "Tối ưu trọng tâm tương tác quảng cáo Adsterra: tập trung vào Popunder và SocialBar.",
      "Triệt tiêu tình trạng click nhầm và ngăn chặn ghi nhận lượt hiển thị không mong muốn cho NativeBanner.",
    ],
  },
  {
    version: "1.3.162",
    date: "2026-10-03",
    lines: [
      "Mở khoá khả năng chạy song song 100% không khoá Mutex chuột cho chế độ chạy ẩn (CDP Headless) đa tiến trình.",
      "Phân lập hoàn toàn toạ độ chuột ảo và tối ưu hoá thời gian khởi động, giúp các phiên duyệt tự do tải trang và tương tác quảng cáo đồng thời.",
    ],
  },
  {
    version: "1.3.161",
    date: "2026-10-03",
    lines: [
      "Khắc phục sự cố không ghi nhận lượt hiển thị quảng cáo trong chế độ chạy ẩn.",
      "Tối ưu hoá khả năng tương thích đồ hoạ WebGL và xoá bỏ dấu vết tự động hoá để các đối tác quảng cáo ghi nhận đầy đủ.",
    ],
  },
  {
    version: "1.3.160",
    date: "2026-10-03",
    lines: [
      "Khắc phục sự cố chế độ chạy ẩn (Headless) trong kịch bản tự động xem quảng cáo.",
      "Tự động dùng hồ sơ độc lập và chuyển thao tác sang chuột ảo CDP để trình duyệt chạy ngầm hoàn toàn.",
    ],
  },
  {
    version: "1.3.159",
    date: "2026-10-03",
    lines: [
      "Khôi phục quảng cáo dạng đề xuất nội dung NativeBanner trên website để đa dạng hoá hiển thị.",
      "Khu vực tài trợ trung tâm kết hợp hài hoà giữa biểu ngữ chữ nhật và khối đề xuất tự nhiên.",
    ],
  },
  {
    version: "1.3.158",
    date: "2026-10-03",
    lines: [
      "Tối ưu hoá SEO toàn diện website: bổ sung sơ đồ trang sitemap.xml, chỉ dẫn bot robots.txt và thẻ mạng xã hội chuẩn mực.",
      "Làm giàu nội dung trang chủ với mục hỏi đáp thực tế, câu hỏi thường gặp và giới thiệu chi tiết pháp bảo tự động.",
    ],
  },
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
