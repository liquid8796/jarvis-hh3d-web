# Changelog

Lịch sử phát hành của Auto HH3D — Web (tên cũ: Jarvis HH3D). Mới nhất ở trên.

Mỗi mục nói **cái gì đổi và vì sao**, thường là kể đích danh lần hỏng việc đã buộc phải đổi.
Đó là chủ ý: đây là chỗ duy nhất lý do còn sống sót: mã nguồn chỉ giữ được kết quả của một
quyết định, không giữ được cái giá đã trả để biết. Và cái giá ấy mới là thứ ngăn người sau —
kể cả chính mình sáu tháng nữa — phạm lại đúng lỗi đó.

Xem [README.md](README.md) để biết hệ thống chạy thế nào.

---

## 0.28.0 — Mê Cung trên ghế chung luôn dừng khi đã đủ huyền tinh

- **「Dừng khi đã đủ huyền tinh trong ngày」của Mê Cung bị khoá BẬT với đạo hữu thường.**
  Mê Cung là nhiệm vụ duy nhất giữ một phiên trình duyệt hàng chục phút, mà linh sứ tông môn
  chỉ có vài ghế và cả tông môn dùng chung. Bỏ tick ấy nghĩa là đánh hết lượt — một đàn có
  thể ngồi trong Mê Cung gần trọn ngày, và vài đàn như vậy là những người còn lại xếp hàng
  cả ngày mà không hiểu vì sao mãi không tới lượt. **Tông chủ được miễn**: người vận hành
  cái VM ấy phải có đường tự quyết định dùng nó thế nào.
- **Bấm vào ô đã khoá thì hiện hộp cảnh báo, rồi ô tự tick lại.** Cố ý KHÔNG dùng thuộc tính
  `disabled`: một ô bị khoá cứng nuốt luôn cú bấm, không còn sự kiện nào để mà giải thích, và
  người dùng chỉ thấy một ô không nhúc nhích — bấm lại, lại hụt, rồi kết luận trang hỏng. Ô
  này nhận cú bấm, từ chối nó, rồi NÓI vì sao.
- **Luật nằm ở ba lớp, vì mỗi lớp bịt đúng chỗ hai lớp kia không với tới.** Giao diện chỉ là
  phép lịch sự — một POST dựng tay chẳng đi qua form lần nào. Đường **lưu** ngọc giản ép lại
  theo vai của chính người gọi, và **nói ra** khi nó đã ghi đè (im lặng sửa một lựa chọn
  người ta vừa bấm là cách nhanh nhất để họ tin ngọc giản không nghe lời mình). Nhưng đường
  lưu chỉ chạm được những người còn bấm nút: **document đã nằm sẵn trong database với
  `capCheck: false` từ trước luật này** thì không đường ghi nào với tới. Nên lớp thứ ba nằm ở
  **cửa phát việc** — chỗ duy nhất mọi vòng chạy đều đi qua.
- **Lớp thứ ba gác theo SCOPE của linh sứ, vì luật nói về CÁI MÁY chứ không về con người.**
  Linh sứ riêng chạy trên máy của chính đạo hữu: họ tiêu tài nguyên của mình và không ai phải
  xếp hàng sau lưng, nên ghế riêng không chịu luật của ghế chung. Chi phí: thêm đúng một phép
  đọc theo khoá chính cho mỗi lần PHÁT ĐƯỢC việc — không phải mỗi nhịp hỏi việc. Không tra ra
  chủ nhân thì coi như người thường: luật siết, không nới.
- Kiểm chứng: smoke **164/164**, trong đó mười ca mới ghim luật thuần (tông chủ được miễn,
  người thường bị ép, không đụng vào lựa chọn nào khác, không sửa vật gốc, và trả về CHÍNH
  vật cũ khi không phải sửa — mẹo so tham chiếu mà đường lưu dựa vào để biết có nên báo hay
  không) cùng ba chốt trên NGUỒN rằng cả hai cửa ghi/chạy đều áp luật và linh sứ riêng thì
  không; TypeScript và production build sạch.

## 0.27.0 — Hàng đợi nói rõ mỗi tài khoản đang làm nhiệm vụ gì

- **Mỗi dòng hàng đợi giờ kể tên nhiệm vụ đang chạy**, kèm bộ đếm「3/8 nhiệm vụ」. Trước đây
  một đàn chạy bốn mươi phút chỉ hiện đúng hai chữ「Đang chạy」— không phân biệt được nó
  đang cày Mê Cung hay đã treo từ lâu. Chạy song song thì hiện ĐỦ các nhiệm vụ đang trong
  tay (mặc định tới 3 tab), vì kể một cái là nói dối về hai cái còn lại.
- **Thứ này trước đây không tồn tại dưới dạng dữ liệu.** Tiến trình một vòng chỉ sống trong
  văn xuôi của nhật ký (「Mê Cung: xong」), và dựng giao diện bằng cách dò chuỗi trong log
  của chính mình là buộc một cột trên màn hình vào cách hành văn của một dòng log — mà bản
  0.25.2 vừa viết lại đúng mấy dòng ấy. Nên linh sứ khai thẳng: cột `cycle_progress`
  (migration 0010) và một trường mới **đi kèm nhịp tim sẵn có, không thêm một request nào**.
- **Linh sứ đời cũ không vỡ, chỉ im.** Trường mới là tuỳ chọn: linh sứ chưa cài lại vẫn chạy
  y như trước, dòng của nó chỉ thiếu phần tên nhiệm vụ. **Muốn thấy tên thì cài đè linh sứ**
  (engine nằm trong gói) — linh sứ tông môn đã được cài trong đợt này.
- **Vắng trường KHÁC HẲN gửi rỗng.** Vắng = "linh sứ đời cũ, giữ nguyên cột"; rỗng = "đang
  giữa hai nhiệm vụ". Lẫn hai cái là biến mỗi nhịp tim của linh sứ cũ thành một lệnh xoá lặp
  lại mỗi 5 giây.
- **Trigger có mệnh đề `WHEN`, và đó là toàn bộ giá trị của nó.** Trigger `AFTER UPDATE OF
  <cột>` của Postgres nổ khi cột được NHẮC TỚI trong `SET`, không phải khi giá trị đổi —
  thiếu WHEN thì mỗi nhịp tim của mỗi đàn đánh thức MỌI trang hàng đợi đang mở để vẽ lại
  đúng cái vừa vẽ. Đo được trên database thật: 5 lần gửi lại y nguyên tiến độ → **0 tín
  hiệu**; đổi thật → 1; dọn về null → 1 (phải là `IS DISTINCT FROM`, `<>` gặp NULL trả NULL
  và sẽ im lặng đúng hai lúc cần vẽ lại nhất).
- **Ranh giới riêng tư dịch một nấc, có chủ ý.** Dòng của mình: đủ tên nhiệm vụ. Dòng người
  khác: **chỉ con số**, không bao giờ có tên — tên nhiệm vụ là cấu hình nhiệm vụ, thứ nằm
  bên phía「không bao giờ」từ ngày trang này ra đời. Con số được phép qua vì nó trả lời đúng
  câu hỏi trang sinh ra để trả lời: cái ghế linh sứ tông môn kia sắp trống chưa.
- Tiến độ được **dọn ở cả ba cửa** — nhận việc, xong vòng, và lúc reaper kết liễu một đàn
  mất nhịp tim — nếu không thì một đàn đang nghỉ hiện lên là「đang nghỉ — Mê Cung」suốt cả
  cooldown.
- Kiểm chứng: smoke **154/154** trên Chromium thật, trong đó bảy ca mới lái `runCycle` THẬT
  qua cả hai nhánh song song và tuần tự rồi soi chuỗi tiến độ nó phát ra (bộ đếm không lùi,
  không tên nào mắc kẹt lại, nhánh tuần tự không bao giờ cầm hai nhiệm vụ một lúc);
  `verify:continuous` trên database thật ghim vòng đời cột (ghi được, linh sứ cũ không bị
  xoá trắng, dọn đúng ở claim/complete) và **dựng hai đạo hữu để chứng minh tên nhiệm vụ của
  người khác không lọt ra ở bất kỳ đâu trong ảnh chụp**; TypeScript và production build sạch.

## 0.26.0 — Hỷ Sự Đường: đi chúc phúc các tiệc cưới (tab Thường)

- **Nhiệm vụ mới ở tab Thường: Hỷ Sự Đường** — viết từ recording 05/08 trên site thật
  (`hy-su-duong-20260805-223044`). Nút Hỷ Sự Đường bên `/tien-duyen` mở modal「Đại Điển
  Đang Diễn Ra」; mỗi vòng vào phòng đầu tiên còn「Chưa chúc」, chọn NGẪU NHIÊN một lời
  chúc mặc định (đúng ghi chú của người ghi hình), gửi qua hộp xác nhận rồi mở lại danh
  sách — tới khi hết phòng chưa chúc. Không giới hạn lượt trong ngày: chính lời chúc là
  thứ rút dần điều kiện dừng của vòng lặp.
- **Vào phòng bằng điều hướng, không bấm link.**「Vào Chúc Ngay」mang `target=_blank` —
  bấm nó là flow lạc sang tab thứ hai — nên script đọc href của hàng rồi `location.assign`
  ngay trong tab. Phòng Đạo Lữ (`/phong-cuoi`, dạng trang đã có recording) đi trước phòng
  Hồng Nhan (`/hong-nhan`, chưa ghi hình được): trang chưa kiểm chứng chỉ có thể làm hỏng
  lượt SAU KHI mọi phòng đã kiểm chứng được chúc xong — và hỏng thì kêu to, đó là cách
  trang ấy kiếm được recording của riêng nó.
- **Ghi nhận = nút gửi biến mất khỏi DOM** (state event trong recording: server nhận là nút
  bị gỡ hẳn; gửi bị từ chối thì nút ở lại). Mỗi lời chúc tốn 30 Tiên Ngọc, nhận 120 Tu Vi —
  nên bước chờ ấy bắt buộc, quest tắt sẵn, và giá nói rõ ngay trên form (luật của Luyện
  Đan Đường).
- **Bao lì xì nhặt kiểu cơ hội**: trang phòng cưới có style `.lixi-envelope` nhưng chưa
  recording nào bắt được lúc phát, nên cú bấm là optional + guard Visible — đoán sai
  markup thì bước tự bỏ qua, flow chính không suy suyển.
- Hồ sơ lên **schema 46**, xuất từ bản desktop 1.43.0 cùng đợt — hai sản phẩm vẫn đọc
  chung một tri thức site. Form thêm đúng một công tắc ở tab Thường; tab VIP không thấy
  nó, vì hồ sơ không có twin VIP — một ô tick ở đó là lời hứa suông.
- Ghim bằng smoke trên Chromium thật trước sảnh cưới replica (server nhớ phòng đã chúc
  đúng như site thật): chúc đủ ba phòng theo thứ tự ưu tiên, lời chúc ngẫu nhiên không rơi
  vào ô trống, lì xì nhặt đúng một phòng đang phát, và hai lý do dừng phân biệt rõ —
  「đã chúc phúc hết các tiệc đang mở」khác「không có tiệc cưới nào đang diễn ra」—
  **138/138**.

## 0.25.2 — nhật ký tu luyện thôi nói tiếng của script

- **「stopIf khớp — đã tế lễ hôm nay」giờ chỉ còn「đã tế lễ hôm nay」.** Lý do dừng vẫn hiện
  ở mức info — đó là câu trả lời người ta mở nhật ký lên để tìm — nhưng nói TRẦN: "stopIf"
  là tên một loại bước trong script, ngôn ngữ của người viết flow chứ không phải của người
  đọc nhật ký (ảnh người dùng gửi 05/08 là bằng chứng nó gây khó hiểu).
- **「repeat kết thúc sau 6 vòng — trần số vòng (6)」rút khỏi nhật ký người dùng**, xuống
  kênh debug của máy đang chạy. Câu chuyện người đọc cần đã nằm ở lời kể của chính quest
  (「Giữ lửa 1/3」…) và dòng kết quả cuối lượt (「Luyện Đan Đường: xong」); chi tiết vòng
  lặp là chẩn đoán, không phải tường thuật.
- Bản desktop sửa cùng cặp dòng trong cùng ngày (1.42.1) — hai sản phẩm là một tool, nhật
  ký không được phép lệch giọng.
- Ghim bằng smoke: kênh info sau một lượt chạy thật không được chứa "stopIf", "repeat" hay
  "until", và lý do dừng phải hiện trần — **130/130**. Linh sứ cần cài đè để nhận (engine
  nằm trong gói); linh sứ tông môn đã được cài trong đợt phát hành này.

## 0.25.1 — hàng đợi chuyển sang trực tiếp; Tụ Nghĩa Sảnh đổi tên thành Nghị Sự Đường

- **Hàng đợi sống bằng SSE thay vì hỏi lại mỗi 5 giây.** Nhịp poll cũ có chạy — đo được màn
  hình tự đổi sau đúng 5,0 giây, không cần F5 — nhưng năm giây là năm giây, và trang này tồn
  tại để người ta đứng nhìn hàng chờ nhích. Kênh mới đo được **0,4 giây**.
- **Route riêng `/api/queue/stream`, không dùng lại kênh của Linh Đài.** Kênh kia chỉ vẽ lại
  khi tín hiệu mang đúng userId của người nghe; hàng đợi thì đàn của bất kỳ ai đổi cũng làm
  thứ tự của mọi người đổi theo. Nới cái lọc ấy ra là biến một kênh riêng tư thành kênh chung
  — một lỗi lọc sai ở đó sẽ rò dữ liệu người khác. Hai route tách bạch: kênh cũ giữ nguyên
  luật riêng tư, kênh mới tự dựng payload **đã che tên** cho từng người nghe.
- **Hai nguồn đánh thức, vì hàng đợi đổi theo hai cách.** NOTIFY của Postgres lo phần job
  sinh ra / đổi trạng thái / đổi giờ chạy. Nhưng một đàn đang nghỉ tự vào hàng khi
  `next_run_at` trôi qua — **không có thay đổi nào trong database để mà báo** — nên stream
  còn hẹn sẵn một cái đồng hồ đúng mốc ấy. Thiếu nhánh này thì số thứ tự đứng im cho tới khi
  tình cờ có ai đó làm việc khác. Kiểm chứng: một đàn hẹn hết cooldown sau 6 giây đã **tự**
  nhảy vào hàng với số thứ tự 1, không ai đụng database và không F5.
- Chủ đề `event` bị bỏ qua có chủ ý: mỗi dòng nhật ký của mọi linh sứ đều phát một tín hiệu,
  mà nhật ký không hề xuất hiện trên trang này — nghe nó là tự bắt mình đọc lại database hàng
  chục lần mỗi vòng chạy để rồi không vẽ gì khác.
- **Huy hiệu「Trực tiếp」chỉ nói về kênh SSE**, không nói về việc dữ liệu có tới hay không.
  Lưới an toàn (hỏi lại 30 giây khi kênh sống, 2 giây khi đứt) cố ý KHÔNG bật cờ ấy — kênh đã
  đứt mà màn hình vẫn khoe "trực tiếp" là một lời nói dối nhỏ, đúng vào thứ người dùng dựa
  vào để tin con số.
- **Đổi tên「Tụ Nghĩa Sảnh」→「Nghị Sự Đường」** ở thanh điều hướng, tiêu đề trang, tiêu đề
  phòng, mục cài đặt bên Tông Môn và trong hướng dẫn. Các entry CHANGELOG cũ giữ nguyên tên
  cũ: chúng là lịch sử, sửa lại là làm sai bản ghi.
- Câu giải thích luật hàng đợi rút gọn theo yêu cầu (bỏ vế nói về che tên — phần ấy đã tự
  hiển nhiên trên bảng).
- Kiểm chứng trên Chromium thật: 9 phép thử mới (câu chữ đúng từng chữ, câu cũ đã mất, thanh
  điều hướng đổi tên, huy hiệu trực tiếp, chuyển trạng thái do đồng hồ, số thứ tự) + 14 phép
  thử riêng tư hai-đạo-hữu chạy lại trên bản SSE + smoke **129/129**; TypeScript và production
  build xanh.

## 0.25.0 — Hàng Đợi Công Việc: cả tông môn nhìn chung một hàng chờ

- **Trang mới `/hang-doi`**, có lối vào ngay trên thanh trên cùng. Nó trả lời đúng một câu
  hỏi mà Linh Đài không trả lời được: *đàn của tôi đứng thứ mấy, và vì sao chưa tới lượt?*
  Trước đây mỗi người chỉ thấy đàn của chính mình, nên một lượt chờ lâu trông y hệt một lượt
  hỏng.
- **Số thứ tự là thứ tự THẬT.** Truy vấn sắp xếp đúng như câu `claimNextJob` của linh sứ
  (`next_run_at`, rồi `created_at`), nên con số trên màn hình chính là thứ tự sẽ được nhặt
  việc, không phải một cách sắp xếp riêng của giao diện. Ba trạng thái được tách bạch thay vì
  gộp làm một: **đang chạy** (đã ra khỏi hàng), **chờ tới lượt** (đã tới giờ, đang xếp hàng),
  **đang nghỉ** (chưa hết cooldown nên chưa vào hàng) — gộp lại là nói dối về độ dài hàng chờ.
- **Tên đạo hữu khác được che 2/3**, giữ lại đầu tên đủ để chủ nhân tự nhận ra mình. Phép che
  đếm theo code point (tên có dấu hoặc emoji cắt theo đơn vị UTF-16 sẽ ra ký tự lỗi) và luôn
  che **ít nhất** hai phần ba — tên ngắn dưới ba ký tự bị che sạch, vì lộ một trong hai chữ
  cái đã là quá nửa và lời hứa phải đúng với mọi cái tên.
- **Ranh giới riêng tư được ghim bằng kiểm chứng, không bằng lời hứa.** Của người khác chỉ
  hiện: tên đã che, trạng thái, thời điểm chạy kế, số vòng, và linh sứ thuộc hạng nào
  (tông môn / riêng). KHÔNG BAO GIỜ: tên tài khoản game, cookie, cấu hình, id linh sứ riêng —
  ba thứ đầu là bí mật, thứ tư là danh tính một cái máy cụ thể. Bài kiểm dựng hai đạo hữu tạm
  rồi soát cả payload API lẫn HTML đã render, vì rò rỉ có thể nằm trong payload dù màn hình
  không vẽ ra.
- **Không dùng lại kênh SSE của Linh Đài**: kênh ấy lọc theo đúng một người, biến nó thành
  kênh chung là mở đường cho một lỗi lọc sai làm rò dữ liệu người khác. Trang này có endpoint
  đọc riêng, tự che tên ngay trong service, và hỏi lại mỗi 5 giây — ngừng hỏi khi tab bị ẩn.
- Kiểm chứng: 14 phép thử end-to-end trên Chromium thật với hai đạo hữu tạm (xoá cascade sau
  khi xong) + 6 assert cho phép che tên trong smoke (**129/129**); TypeScript + production
  build xanh.

## 0.24.2 — mỗi khu nhiệm vụ có ô「Chọn tất cả」

- **Hai khu nhiệm vụ một-công-tắc** (Nhiệm vụ ngày ở tab VIP, Nhiệm vụ tài khoản thường ở
  tab Thường) có thêm một dòng đầu khu: ô「Chọn tất cả」bên trái, bộ đếm「N/M đang bật」bên
  phải. Bật mười nhiệm vụ giờ là một cú bấm thay vì mười.
- **Ô tổng chỉ đụng nhiệm vụ của CHÍNH khu nó.** Hai lưới dùng chung một state — bảy mục của
  tab Thường là tập con của mười mục tab VIP — nên một ô tổng quét cả bảng sẽ lặng lẽ bật Bí
  Cảnh và Phúc Lợi VIP cho người chỉ định bật đủ nhiệm vụ tài khoản thường. Đã ghim bằng
  kiểm chứng: bấm ô tổng tab Thường xong, tab VIP còn đúng ba mục riêng của VIP.
- **Ba trạng thái chứ không phải hai**: bật hết → tick, tắt hết → trống, bật một phần →
  gạch ngang (`indeterminate`). Thiếu trạng thái thứ ba thì "đang bật 9/10" trông y hệt
  "chưa bật gì".
- Ô tổng **không mang `name`**, đúng luật đã đặt từ 0.20.0: nguồn FormData duy nhất vẫn là
  các hidden input, nên không có đường nào để màn hình nói một đằng mà thứ được lưu một nẻo.
- Kiểm chứng end-to-end trên Chromium thật với một đạo hữu tạm (xoá cascade sau khi xong):
  14 phép thử đi hết đường bấm-chuột → hidden input → server action → JSONB, gồm cả vòng
  "bấm khi đang dở thì bật hết, bấm khi đã đủ thì tắt hết" và phép đọc lại database xác nhận
  lưu đúng ba mục đang hiện trên màn hình. TypeScript + production build + smoke 123/123 xanh.

## 0.24.1 — chạy song song có trần: tám trang cùng dựng làm các tab thua cuộc đua CPU

- **Triệu chứng**: tài khoản thường「Donald Trump」rải lỗi `Selector không bao giờ xuất hiện`
  gần như mỗi vòng — 18 dòng lỗi trong 10 vòng — nhưng KHÔNG cố định ở nhiệm vụ nào: Luyện
  Đan `#ld-app` 7 lần, Tế Lễ `#te-le-button` 4, Vấn Đáp 3, Vòng Quay 3, và một lần trượt cả
  `.nv-quest` của chính hub. Cùng khoảng thời gian đó tài khoản VIP chạy 10 nhiệm vụ, **0
  lỗi trong 9 vòng**.
- **Nguyên nhân**: nhịp song song ở 0.22.0 mở **một tab cho MỖI nhiệm vụ, không giới hạn**.
  Tài khoản thường bật 8 nhiệm vụ, và 8 nhiệm vụ ấy là **8 trang khác nhau** cùng dựng một
  lúc trên VM 2 nhân; tab nào thua cuộc đua CPU thì hết 25 giây chờ mà trang chưa dựng xong,
  và engine gọi đó là "selector không xuất hiện". Tài khoản VIP thoát nạn chỉ vì 7 trong 10
  nhiệm vụ của nó bấm nút ngay trên hub — bảy tab cùng mở MỘT trang đã nằm trong cache, gần
  như miễn phí. Đo tại chỗ trên VM lúc hai vòng chồng nhau: **load average 3.20 trên 2
  nhân**, tức hàng đợi CPU dài gấp rưỡi số nhân. Bằng chứng chốt lại: vòng 11:34 hỏng ở
  Hoang Vực + Tế Lễ — hai nhiệm vụ hoàn toàn khác — đúng vào giây tài khoản VIP mở thêm 10
  tab. Không phải hạng tài khoản, không phải trang nào hỏng, không phải tính năng chưa mở.
- **Cách chữa**: một vòng chỉ mở tối đa **3 tab cùng lúc**, tab xong thì nhường chỗ ngay cho
  nhiệm vụ kế trong hàng đợi. Vẫn giữ gần trọn cái lợi của song song (vòng dài bằng đợt chậm
  nhất, không phải tổng cộng dồn) mà mỗi trang đủ CPU để dựng. Con số 3 rút từ chính bằng
  chứng: tài khoản VIP sống khoẻ với ~4 trang khác nhau một lúc. Người vận hành máy khoẻ hơn
  nới bằng `WORKER_QUEST_TABS` (kẹp 1–8). Lưu ý nhân với `WORKER_MAX_JOBS`: 5 đàn × 3 tab là
  trần 15 tab, nên máy yếu thì hạ một trong hai.
- **Thông điệp lỗi nói đúng chuyện**: `Trang chưa dựng xong sau 25s — không thấy #ld-app`
  thay cho `Selector không bao giờ xuất hiện`. Câu cũ đọc như thể trang thiếu hẳn phần đó,
  và nó khiến một tab đói CPU trông y hệt một tính năng chưa mở — hai chuyện cần cách chữa
  khác nhau.
- Kiểm chứng: 6 assert mới cho bộ điều phối (không bao giờ vượt trần, không sót nhiệm vụ,
  giữ đúng thứ tự kết quả dù chạy xen kẽ, trần lớn hơn số việc, trần 1 = tuần tự, danh sách
  rỗng không treo) — smoke **123/123**; TypeScript + production build xanh.

## 0.24.0 — Luyện Đan Đường: tab VIP và tab Thường thôi nhìn chung một bộ tuỳ chọn

- **Lỗi được sửa**: từ 0.23.0, Luyện Đan Đường chạy được cho cả hai hạng nhưng chỉ mang MỘT
  bộ tuỳ chọn đứng ngoài hai tab — khắc ngọc giản từ tab VIP là lặng lẽ đè loại đan, mức
  phân giải và cả công tắc bật/tắt của tab Thường, và ngược lại. Ai muốn đội VIP luyện
  Cực Phẩm còn đội thường chỉ luyện Hạ Phẩm là không có cách nào.
- **Tách đôi cấu hình**: config mọc thêm `quests.luyenDanThuong` cạnh `quests.luyenDan`;
  mỗi tab một fieldset với bộ field mang tên riêng (`luyenDan*` / `luyenDanThuong*`), và lớp
  dịch áp mỗi bản cho đúng twin của hồ sơ theo `requiresVip`. Mê Cung vẫn là một bộ chung —
  không ai kêu về nó, và hai bản Mê Cung chỉ khác nhau ở hạng là chuyện hồ sơ đã lo.
- **Di trú không ai mất gì**: document cũ chưa có `luyenDanThuong` được GIEO bản thường từ
  bản chung ngay lúc đọc — nếu để Zod tự điền default thì mọi tài khoản thường đang luyện
  đan bỗng tắt ngầm sau deploy, không một dòng lỗi. Luật gieo đứng ở CẢ HAI cửa JSONB thô
  gặp Zod: đường đọc của trang cấu hình, và op claim của /api/worker — nơi snapshot vừa
  được claimNextJob/completeWorkerCycle chép thô từ user_configs bằng SQL, không hề đi qua
  đường đọc kia (soát chéo lúc review mới lộ ra cửa thứ hai). Snapshot đóng băng trước
  deploy còn thêm lưới dưới cùng trong lớp dịch: thiếu hẳn bản thường thì rơi về bộ chung
  cũ, đúng hành vi lúc snapshot được khắc.
- Smoke test thêm 8 ca ghim ranh giới mới: hai twin nhận đúng bộ của hạng mình, công tắc
  không kéo nhau, snapshot cũ rơi về bộ chung, luật gieo khi đọc document cũ/mới, và chốt
  giữ op claim phải gieo trước khi parse.
- Linh sứ máy nhà chưa cài đè bundle mới vẫn chạy an toàn: engine cũ chỉ biết bộ chung nên
  áp nó cho cả hai twin — đúng hành vi trước tách, tự hết khi cài đè.

## 0.23.1 — Linh Đài rộng ra 1600px, và thanh trên cùng thôi lệch tâm

- **Khung Linh Đài lên 1600px** (từ 1152px). Đo trên màn 1920: mỗi cột từ 566/514px lên
  796/724px, ô nhiệm vụ trong lưới hai cột từ ~245px lên 340px — mọi dòng gợi ý trước đây
  gãy ba dòng giờ nằm gọn một-hai dòng. Vẫn có TRẦN chứ không thả tự do: một biểu mẫu kéo
  ngang hết màn 2560px thì mắt phải quét quá xa, và dòng chữ dài ra là khó đọc hơn.
- **Thanh trên cùng canh đúng mép thẻ.** Trước đây header rộng 1024px đứng trên nội dung
  1152px, tức ấn môn phái thụt vào 64px so với hàng thẻ bên dưới — nay trang tự khai bề
  rộng khung của mình cho header qua một prop, và cả hai dùng chung một hằng số nên không
  thể lệch nhau nữa. Đo mép trái ấn so với mép trái thẻ: **0px** ở 1280/1600/1920.
- **Thoáng hơn ở bên trong, không chỉ rộng hơn ở bên ngoài**: khoảng cách hai cột 24 → 32px,
  ruột thẻ 24 → 32px, và khung nhật ký cao 320 → 416px (bên phải vốn kết thúc sớm hơn cột
  trái rất nhiều, nên chỗ trống ấy trả về cho phần đáng đọc nhất).
- Mọi thay đổi chỉ chạm màn **rộng hơn 1152px**; điện thoại và tablet không đổi một pixel.
  Prop mới của header mặc định giữ nguyên `max-w-5xl` nên năm trang còn lại không xê dịch —
  đã đo lại `/`, `/profile`, `/chat` (header vẫn đúng 1024px) và kiểm không tràn ngang ở
  390/768/1024/1280/1920.

## 0.23.0 — tab Thường đủ bộ: Tế Lễ và Thí Luyện có flow thật, Mê Cung và Luyện Đan mở cho cả hai hạng

- **Đồng bộ profile schema 45 từ PC** (desktop 1.41.0), sinh bằng lệnh export như mọi lần —
  không chép selector tay.
- **Tế Lễ Tông Môn (thường)** — recording 05/08 trên tài khoản thường thật: hàng hub dẫn tới
  trang thành viên tông môn (`/danh-sach-thanh-vien-tong-mon?nv_embed=1`), bấm `#te-le-button`,
  xác nhận hộp SweetAlert2 「dùng 10 Tinh Thạch tế lễ cho Tông Môn?」bằng `.swal2-confirm`
  (không bao giờ đụng Hủy), rồi CHỜ nút đổi thành 「Đã Tế Lễ」+ disabled — tế lễ TỐN Tinh
  Thạch nên lễ bị từ chối phải kêu to, không nhận vơ là xong. So nguyên cụm 「đã tế lễ」theo
  bài học bỏ-dấu của Điểm Danh.
- **Thí Luyện Tông Môn (thường)** — recording 05/08: dạng Phúc Lợi Đường trên trang đơn giản
  hơn (`/thi-luyen-tong-mon-hh3d/?nv_embed=1`) — cùng cổng `#countdown-timer` (00:00 = sẵn
  sàng, mở xong nhảy 29:59), một điều khiển duy nhất là chính cái rương `#chestImage`
  (ForceClick vì nó glow). Mỗi lượt ghé lấy một trong 3 lượt/ngày rồi báo cooldown ~30 phút;
  「hết ngày」đọc từ hàng hub mất link — tín hiệu đã chứng minh ở Phúc Lợi Đường.
- **Mê Cung và Luyện Đan Đường có twin thường** (`me-cung-thuong`, `luyen-dan-duong-thuong`)
  — cùng cách Hoang Vực/Vấn Đáp đã làm: hub thường dẫn thẳng vào hai trang này (「Vào Ngay」,
  recording 05/08), script đã kiểm chứng phục vụ cả hai hạng nguyên văn. Lớp dịch
  `profileForConfig` áp công tắc VÀ MỌI option cho cả cặp twin — trước đây nó chỉ áp cho bản
  tìm thấy đầu tiên, nghĩa là tài khoản thường sẽ chạy Mê Cung với option mặc định trong khi
  người dùng đã gõ ngưỡng trục xuất 250.000.
- **Hai fieldset Mê Cung / Luyện Đan rời khỏi tab VIP**, đứng thành khối chung hiện ở mọi
  tab: chúng giờ thuộc cả hai hạng, và nhét vào cả hai tab là nhân đôi input cùng name —
  đúng cái bẫy FormData mà comment đầu ConfigForm đã cấm từ 0.20.0. Tab Thường lên 7 mục
  một-công-tắc (thêm Thí Luyện + Tế Lễ).
- Kiểm chứng: smoke Chromium thật chạy nguyên hai flow mới trên DOM dựng theo recording
  (kể cả lần ghé thứ hai của Tế Lễ phải dừng ở 「đã tế lễ hôm nay」và tuyệt đối không đụng
  nút Hủy), bốn cặp twin được so bằng chứng cứ cấu trúc từng cặp; TypeScript + production
  build là cổng phát hành như thường lệ.

## 0.22.1 — nhật ký thôi bị bóp thành sợi chỉ dọc

- **Mỗi dòng nhật ký lại đọc được.** `.log-line` là lưới đúng HAI ô — giờ, rồi nội dung —
  nhưng bản 0.22.0 thêm nhãn tài khoản thành phần tử con thứ BA. Con thứ ba rơi xuống hàng
  dưới, vào ô giờ rộng 4.4rem, nên lời kể bị ép thành một cột chữ dựng đứng một-hai từ mỗi
  dòng (ảnh người dùng gửi 05/08). Nhãn giờ nằm CÙNG một ô với lời kể, lưới trở lại đúng
  hai con như thiết kế ban đầu.
- **Chuỗi dài không chỗ ngắt không đẩy được khung log tràn ngang nữa**: cột nội dung đổi
  sang `minmax(0, 1fr)` kèm `overflow-wrap: anywhere` — một id linh sứ hay URL dài vốn đặt
  sàn min-content cho cột, và sàn ấy thắng cả bề rộng khung.
  Đo bằng Chromium thật trước/sau: ô nội dung từ 70px (khác hàng với giờ) lên 192px (cùng
  hàng), năm kịch bản — có nhãn, không nhãn, nhãn 60 ký tự, URL không dấu cách — đều không
  tràn.
- **Bỏ những câu đối chiếu với bản PC trong giao diện và hướng dẫn.** Người dùng web không
  cần biết bản desktop làm gì để hiểu một ô tick: gợi ý Vấn Đáp nói thẳng là tra danh sách
  đáp án cộng đồng; công tắc chạy song song nói "bỏ tick để làm lần lượt từng nhiệm vụ";
  lời báo lỗi cookie chỉ đúng tên tiện ích Cookie-Editor thay vì "ứng dụng desktop". Lý do
  kỹ thuật trong comment và tài liệu dành cho người phát triển vẫn giữ nguyên — đó là nơi
  đối chiếu hai bản còn có ích.

## 0.22.0 — nhiều tài khoản chạy cùng lúc; nhiệm vụ trong một vòng chạy song song

Bản này đưa web lên ngang bản desktop ở đúng chỗ desktop mạnh nhất: **nhiều tài khoản**. Và
đi xa hơn desktop một bước: các nhiệm vụ trong một vòng có thể chạy **song song**, mỗi nhiệm
vụ một tab.

- **Tài khoản game tách khỏi cấu hình, thành bảng riêng `game_accounts` (migration 0009).**
  Cho tới nay cookie sống lẫn trong `user_configs`, nghĩa là mỗi người đúng một tài khoản.
  Bảng riêng vì ba lẽ: một người nuôi nhiều tài khoản và bật/tắt từng cái độc lập; hạng
  VIP/thường là thuộc tính CỦA COOKIE chứ không phải của người (hai tài khoản cùng chủ có
  thể khác hạng); và job phải biết nó chạy cho tài khoản nào để linh sứ chọn đúng hồ sơ
  Chromium lẫn server vá đúng verdict hạng. Migration tự chuyển cookie đang có thành
  「Tài khoản 1」— phong bì mã hoá đi nguyên vẹn, verdict hạng đã chứng minh đi theo, job
  đang sống được nối vào tài khoản mới, và cookie rời hẳn `user_configs` (một bí mật không
  được phép có hai nhà).
- **Ngọc Giản Cấu Hình có mục quản lý tài khoản:** thêm tài khoản mới (tên gợi nhớ + cookie),
  thay cookie từng tài khoản (verdict hạng bị xoá để linh sứ dò lại), đổi tên, bật/tắt, xoá.
  Tắt một tài khoản đang chạy là đàn của RIÊNG nó được thu — các tài khoản khác không bị vạ
  lây; xoá bị từ chối khi đàn còn sống, để không bỏ một linh sứ bơ vơ với job đã biến mất.
  Hai tài khoản cùng chủ mang cùng một cookie bị chặn ngay lúc lưu: cùng cookie là cùng một
  hồ sơ Chromium (fingerprint băm theo cookie) — hai job đồng thời sẽ giành nhau một profile,
  và cùng một nhân vật bị chạy nhiệm vụ hai lần.
- **Khai Đàn lập một đàn cho MỖI tài khoản đang bật; Thu Đàn thu cả đội.** Mỗi tài khoản một
  job sống dai với cooldown riêng — tài khoản A đang ngủ chờ Phúc Lợi không bắt tài khoản B
  chờ theo. Snapshot của từng job = cấu hình nhiệm vụ chung GHÉP cookie/hạng của đúng tài
  khoản nó phục vụ, ghép lại ở mỗi lần claim để sửa-giữa-chừng vẫn có hiệu lực ở vòng kế.
  Bấm Khai Đàn khi một phần đội đang chạy chỉ bổ sung những tài khoản còn đứng ngoài.
- **Linh sứ chạy nhiều đàn cùng lúc.** Một tiến trình worker giờ cầm tối đa
  `WORKER_MAX_JOBS` job đồng thời (mặc định 2, kẹp 1–8 — mỗi job là một Chromium riêng nên
  trần này là trần RAM). Ghế còn trống thì hỏi việc tiếp ngay, không ngủ giữa hai lần claim.
  Nhịp tim gặp 404/403 (job bị xoá dưới chân, ví dụ tài khoản vừa bị xoá) được hiểu là lệnh
  dừng ở điểm an toàn kế — không ôm browser chạy nốt một vòng không ai nhận.
  **Linh sứ đã cài cần cài đè một lần** để nhận khả năng này; linh sứ cũ vẫn chạy đúng nhưng
  tuần tự từng tài khoản một.
- **Các nhiệm vụ trong một vòng chạy song song, mỗi nhiệm vụ một tab riêng** trong cùng phiên
  đăng nhập — vòng dài bằng nhiệm vụ chậm nhất thay vì tổng cộng dồn, đáng giá nhất khi Mê
  Cung (~35 phút) đứng chung hàng với các nhiệm vụ một phút. Tường thuật vẫn đọc được: log
  của mỗi tab mang tên nhiệm vụ, phần kết quả kể theo đúng thứ tự cũ. Có công tắc「Chạy song
  song các nhiệm vụ」trong Ngọc Giản (mặc định bật) để lui về tuần tự như bản PC nếu site
  trở chứng với nhiều tab; lượt chạy có ngân sách lát (`budgetMs`) luôn đi tuần tự vì "hết
  giờ thì dừng giữa danh sách" chỉ có nghĩa khi danh sách đi từng bước.
- **Lư Khai Đàn hiện trạng thái TỪNG tài khoản** — mỗi tài khoản một dòng chấm màu + trạng
  thái + linh sứ phụ trách. Nhật ký gộp chung, từng dòng mang nhãn「tài khoản」khi đội có
  hơn một người. Hai tab Nhiệm vụ VIP/Thường **không khoá nữa** (đội hình có thể lẫn cả hai
  hạng); mỗi tài khoản vẫn chỉ chạy đúng bộ thuộc hạng của nó, và phần chú thích cho biết
  đội hình hiện tại mấy VIP, mấy thường, mấy chưa dò.
- **Nhật ký chỉ tải phần ĐUÔI và tự đứng ở dòng mới nhất.** Lượt tải đầu lấy 200 dòng mới
  nhất (trước đây là 200 dòng CỔ nhất của một job đã chạy cả tuần — mở trang là đọc chuyện
  tuần trước); khung log mở ra là đứng sẵn ở đáy và bám theo dòng mới, chỉ ngừng bám khi
  người đọc chủ động kéo lên xem lại. Câu mô tả「Khai Đàn một lần, linh sứ tự canh
  cooldown…」rút khỏi mặt Lư — hành vi ấy giờ tự kể qua dòng trạng thái từng tài khoản.
- **Một đợt review đối kháng (5 chiều × phản biện độc lập) chốt thêm một lớp thép** trước
  khi phát hành:
  - Index duy nhất một-phần `jobs_one_active_per_account` — MỖI tài khoản tối đa MỘT đàn
    sống, luật nằm ở database chứ không chỉ ở startJob (vốn là check-then-insert qua nhiều
    round-trip: hai lượt Khai Đàn đồng thời từ hai tab cùng thấy tài khoản rảnh rồi cùng
    insert — hai Chromium sẽ giành một hồ sơ và một nhân vật bị chạy nhiệm vụ đôi). INSERT
    dùng `ON CONFLICT DO NOTHING`, kẻ đến sau lặng lẽ thua.
  - Snapshot drizzle 0009 được SINH bằng chính drizzle-kit rồi mới ghép phần backfill viết
    tay — thiếu snapshot thì lần `db:generate` kế tiếp diff với snapshot 0008 và sinh lại
    nguyên bộ DDL trùng, nổ `relation already exists` giữa chuỗi migration.
  - Nhịp tim linh sứ coi MỌI trạng thái không phải `running` là lệnh dừng — job bị reaper
    kết liễu (`failed`) không còn được ôm chạy nốt cả vòng không ai nhận.
  - Level `"warn"` của engine được cả linh sứ lẫn API dịch về `"warning"` — trước đó mọi
    dòng cảnh báo bị 400 và nuốt lặng lẽ, kể cả với linh sứ đã cài (sửa phía API nên bản cũ
    không phải cài lại vẫn hết mất log).
  - Vòng kết thúc của tài khoản đã tắt chuyển thẳng `stopped` thay vì re-queue thành zombie
    "chờ linh sứ" vĩnh viễn; claim cũng bỏ qua đàn của tài khoản đã tắt (đóng khe đua của
    toggle); reaper chỉ kết liễu job còn `running/stopping`, không giết nhầm job vừa
    re-queue khoẻ mạnh.
  - Nhật ký đọc lùi 50 id dưới con trỏ để vớt dòng commit muộn (hai job ghi đồng thời có
    thể commit ngược thứ tự id); stream chỉ phát frame khi có dòng id thật sự mới nên nhịp
    tim không thành frame thừa. Dọn nhật ký xoá màn hình TRƯỚC khi chờ server để không quét
    oan dòng vừa đến.
  - AccountManager đứng NGOÀI `<form>` cấu hình — React 19 reset uncontrolled input sau mỗi
    form action, một cú Khắc Ngọc Giản không được phép xoá trắng chuỗi cookie đang gõ dở.
    Form cấu hình thêm `noValidate`: input số invalid nằm trong tab đang ẩn từng chặn submit
    mà không hiện nổi một lời; giờ Zod ở server là trọng tài và nó biết nói lỗi ra lời.
  - Cảnh báo "không đọc được danh sách đáp án" của Vấn Đáp tính theo TỪNG job (WeakSet theo
    log) thay vì một lần cho cả tiến trình — job đầu không còn "tiêu" mất cảnh báo của các
    tài khoản sau; nguồn hỏng được nghỉ 60 giây thay vì mỗi câu hỏi lại ôm một timeout 20s.
- **Triển khai:** chạy `npm run db:migrate` TRƯỚC khi deploy bản mới (code mới đọc bảng
  `game_accounts`; migrate xong thì code cũ vẫn chạy được thêm một nhịp vì chỉ mất cookie
  trong config khi ĐỌC — nhưng đừng nấn ná, và đừng rollback code sau khi đã migrate vì bản
  cũ sẽ không thấy cookie nữa).
- Kiểm chứng: TypeScript sạch, production build thành công, smoke Chromium thật **103/103**
  (smoke lái engine trực tiếp nên không đổi số); hai script verify realtime đã cập nhật theo
  payload `jobs[]`/`accounts[]`. Nhịp chạy song song và đa tài khoản chưa có lượt chạy thật
  trên site — cần một lượt Khai Đàn thật để xác nhận, như mọi flow mới trước nay.

---

## 0.21.0 — hạng tài khoản khóa đúng tab; tài khoản thường có thêm Hoang Vực và Vấn Đáp

- **Đồng bộ profile schema 44 từ PC.** Hoang Vực và Vấn Đáp ở tab Thường là bản sao nguyên
  flow trang riêng đã kiểm chứng của VIP, chỉ đổi id `*-thuong` và `requiresVip=false`.
  Engine tiếp tục coi hai tab là hai kế hoạch loại trừ nhau, nên không có chuyện VIP chạy
  thêm bản thường rồi nhận thưởng trùng.
- **Tab đổi theo cookie thật, ngay trong lúc trang đang mở.** Worker dò hạng trên hub, gửi
  verdict có xác thực về API; server vá đúng trường `accountTier` trong JSONB và phát tín hiệu
  SSE. Linh Đài tự chuyển sang tab hợp lệ rồi disable tab đối nghịch, không cần F5.
- **Đổi hoặc xoá cookie xoá luôn verdict cũ.** Hai tab mở lại cho tới khi worker chứng minh
  hạng của cookie mới; việc vá verdict là một câu UPDATE JSONB nguyên tử nên không thể ghi đè
  lựa chọn quest người dùng vừa lưu cùng thời điểm.
- **Probe chập chờn không làm account thường chạy nhầm VIP.** Worker giữ verdict đã chứng minh
  từ vòng trước; cookie chưa từng được dò mới dùng mặc định tương thích VIP.
- Kiểm chứng: TypeScript sạch, production build thành công, smoke Chromium thật **103/103**.

## 0.20.1 — cookie account mới thắng dứt khoát profile VIP cũ

- **Không còn một `browser-profile` dùng chung cho cả tông môn.** Mỗi cặp user + chuỗi cookie
  đã lưu có một hồ sơ Chromium riêng, với tên thư mục chỉ chứa SHA-256 rút gọn. Job của người
  trước không thể để lại phiên đăng nhập cho người sau; cùng một người đổi VIP → thường sẽ đi
  vào profile sạch và tiêm đúng cookie mới.
- **Phiên được site tự refresh vẫn sống bền.** Các vòng dùng cùng chuỗi cookie tiếp tục tái dùng
  đúng profile; chỉ khi người dùng chủ động lưu chuỗi khác fingerprint mới đổi. Không quay lại
  lỗi lấy chuỗi dán-tay cũ đè lên phiên đã được site gia hạn sau mỗi vòng.
- **Snapshot được làm mới ngay lúc worker claim job đang chờ.** Cookie hoặc nhiệm vụ sửa trong
  thời gian `queued` có hiệu lực ở vòng kế, không phải chạy thừa thêm một vòng bằng ngọc giản cũ.
- **Phong bì mã hoá không còn bị nhét qua trần 8.000 ký tự của plaintext.** Base64 làm cookie
  JSON dài nở thêm; schema at-rest riêng nhận tối đa 40.000 ký tự rồi worker mới giải mã và
  soát lại bằng schema plaintext. Không còn cảnh nút báo lưu thành công nhưng lần đọc sau cả
  config rơi về mặc định rỗng.

---

## 0.20.0 — tài khoản thường có ba flow thật; mỗi đạo hữu có email và tự sửa hồ sơ

- **Đồng bộ nguyên profile schema 43 từ PC**, không chép selector bằng tay. Ba flow ghi trên
  tài khoản thường ngày 02/08 chạy thẳng ở trang riêng vì hub của hạng này không có các nút
  nhanh cũ: Điểm Danh dùng `/diem-danh` + `#checkInButton`; Phúc Lợi Đường mở bốn rương theo
  thứ tự và đọc `#countdown-timer` 30 phút; Vòng Quay Phúc Vận dùng `#spinButton`,
  `#userTurns` và tự đóng màn chúc mừng đang che nút.
- **Một công tắc web bật cả cặp flow VIP/Thường, nhưng engine chỉ chọn đúng một hạng.** Vì ba
  nhiệm vụ trùng mục tiêu nhưng khác toàn bộ selector, VIP không chạy lặp flow thường và tài
  khoản thường không chạm nút VIP. Lượt quay thứ tư chỉ xuất hiện sau khi đủ điều kiện ngày;
  job sống dai sẽ quay lại ở vòng sau thay vì giữ browser ngồi chờ.
- **Tab “Nhiệm vụ Thường” không còn là placeholder rỗng.** Nó hiện đúng ba checkbox Điểm
  Danh, Phúc Lợi Đường và Vòng Quay Phúc Vận. Ba công tắc dùng chung state với bản VIP nên
  đổi ở tab nào cũng đồng bộ; FormData chỉ có một input chuẩn cho mỗi key, không thể lưu hai
  giá trị trái nhau vì hai bản checkbox.
- **Email được thêm bằng migration 0008, unique và chuẩn hoá chữ thường.** Cột nullable chỉ để
  giữ nguyên 9 tài khoản cũ; đăng ký mới và tài khoản do admin tạo đều bắt buộc email hợp lệ.
  Không backfill email giả, không làm mất hay khoá tài khoản hiện hữu.
- **Trang Hồ Sơ cho từng người dùng** sửa đúng danh xưng + email của chính mình; đạo hiệu,
  quyền và trạng thái không nằm trong payload cập nhật. Admin cũng thấy/tìm/sửa email trong
  Tông Môn. Email trùng bị database lẫn service chặn, kể cả hai request đến cùng lúc.
- Kiểm chứng: smoke Chromium thật **96/96**, trong đó sáu assert mới chạy nguyên ba flow trên
  DOM giống recording; integration Neon xác nhận legacy `NULL`, đăng ký mới, chuẩn hoá,
  unique, cập nhật nguyên tử và quyền tự sửa. TypeScript + production build đều là cổng phát
  hành.

## 0.19.0 — Linh Đài nhận trạng thái trực tiếp, không chờ hai nhịp poll cộng dồn

- **Gỡ đúng hai nút thắt đã đo được:** nhật ký/job trước đây chỉ được hỏi lại mỗi 3 giây khi
  chạy (12 giây khi nghỉ), sổ linh sứ mỗi 12 giây, còn worker đang bận chỉ heartbeat mỗi 20
  giây. Những cửa sổ ấy cộng dồn làm một trạng thái thật đã có trên server nhưng màn hình vẫn
  đứng yên đủ lâu để người dùng tưởng linh sứ treo.
- **Postgres giờ phát chuông trong chính transaction ghi dữ liệu.** Migration 0007 đặt trigger
  trên lifecycle job, event mới và sổ worker; payload `NOTIFY` chỉ có user/topic, không mang
  cookie hay nội dung log. `/api/dashboard/stream` giữ một `LISTEN` session unpooled rồi đẩy
  snapshot qua SSE tới đúng user ngay khi chuông reo — không quay vòng query database.
- **Một EventSource nuôi cả Lư Khai Đàn lẫn mục Linh Sứ.** Cursor là id `job_events`; reconnect
  dùng `Last-Event-ID`, backlog trên 200 dòng tự chảy tiếp, event trùng được gộp, dọn log reset
  đồng thời ở các tab. Dấu **● Trực tiếp** cho biết kênh đang sống; khi kênh rớt, browser tự
  reconnect và feed một-lần 2 giây làm lưới an toàn, khi ổn chỉ soát lại mỗi 30 giây.
- **Không đánh đổi hiệu năng React để lấy tốc độ.** Job/log và presence có context riêng, nên
  một dòng nhật ký mới không bắt cả panel cài đặt linh sứ render lại. Heartbeat dời `lastSeen`
  nhưng nếu trạng thái vẫn “đang trực” thì server chỉ hẹn lại giờ hết hạn, không gửi frame rác.
- **Thu Đàn nhanh hơn trên gói worker mới:** heartbeat mặc định từ 20 giây xuống 5 giây, có thể
  chỉnh bằng `WORKER_HEARTBEAT_MS`. Realtime trên trang có hiệu lực ngay sau deploy; linh sứ
  cũ vẫn chạy, nhưng nên cài đè v0.19.0 một lần để nhận nhịp dừng 5 giây.
- Kiểm chứng trên Neon thật: trigger `job/event/presence/reset` tới listener trong **56–155ms**;
  qua trọn session cookie → Next route → SSE client, event tới sau **168ms** và reset sau
  **223ms**. Có thêm verifier riêng cho cả tầng DB (`verify:realtime`) và HTTP stream
  (`verify:realtime:sse`).

## 0.18.0 — Vấn Đáp web dùng cùng danh sách tham khảo với PC, không hỏi Gemini

- **Flow trước đây chỉ có tay mà không có đầu.** Hồ sơ web đã biết mở
  `/van-dap-tong-mon`, đọc `#question`, bấm đáp án bằng input thật và nhìn lại marker
  `.correct`; nhưng `runCycle` tạo engine mà không tiêm `quiz`. Gặp câu đầu, nó luôn tự thú
  “bản web chưa có kho đáp án” rồi dừng — dòng UI “Tự trả lời câu đã biết” vì thế chưa đúng.
- **Port nguyên tầng `QuizReferenceDirectory` của PC.** Worker tải toàn bộ bảng tại
  `https://hh3d.phucthienlang.vn/user_search.php`, cache trong tiến trình 12 giờ và dùng chung
  cho mọi vòng/account trên máy. Không gọi endpoint tìm kiếm theo từng câu; câu hỏi đang hiện
  không bị gửi đi đâu.
- **Khớp theo text, không theo số/vị trí.** Parser bỏ `3.` / `3)`, giải HTML entity, bỏ thẻ,
  gộp khoảng trắng và fold dấu tiếng Việt. Đáp án chỉ được dùng khi khớp nguyên vẹn đúng một
  trong các lựa chọn đang hiện; thứ tự bị site xáo không có ý nghĩa. Ghi chú cuối `(…)` được
  thử bỏ như PC. Nếu nguồn tự mâu thuẫn hoặc đáp án không nằm trên màn hình thì không bấm.
- **Không có Gemini đúng theo phạm vi yêu cầu.** Câu không có trong danh sách kết thúc quest
  an toàn để giữ các lượt còn lại cho người dùng. Refresh nguồn hỏng vẫn dùng bản cache cũ;
  lần đầu tải hỏng chỉ cảnh báo, không làm sập cả vòng automation.
- URL có thể đổi bằng `QUIZ_DIRECTORY_URL` trên máy nuôi worker; để trống dùng cùng mặc định
  với PC. Linh sứ đã cài trước v0.18.0 cần **cài lại một lần để cập nhật engine** — cài đè giữ
  nguyên linh phù và `WORKER_ID`.
- Kiểm chứng: smoke **90/90**, gồm Chromium thật xác nhận đáp án đi qua click Playwright và
  câu lạ không bấm đại; nguồn cộng đồng thật trả HTTP 200, parser đọc đúng **255 câu duy nhất**
  và resolver khớp lại được đáp án theo text.

## 0.17.0 — Khai Đàn là một lời hứa sống dai, không phải vé đi đúng một vòng

- **Hết một vòng không còn biến job thành `done`.** Đó là lý do ảnh thực địa hiện “Đi hết
  một vòng — 10 nhiệm vụ thuận lợi”, rồi nút lập tức trở lại **Khai Đàn**: worker gọi
  `complete(done)`, server hiểu chữ “complete” là kết thúc cả ý định. Giờ `done`/`failed`
  chỉ kết thúc một vòng và cùng job được đưa về `queued`; chỉ **Thu Đàn** mới thành terminal.
- **Thức dậy theo cooldown, không quay nóng.** Engine gửi cooldown dương sớm nhất của cả
  vòng, dùng cùng luật với `CooldownPlanner` bên PC: không đồng hồ thì 5 phút; vòng chỉ có
  lỗi thì 30 phút; sàn 30 giây, trần 24 giờ, jitter 0–25 giây. Cột `next_run_at` giữ lịch
  trong Postgres nên Vercel không phải nuôi timer và worker có thể đóng browser lúc nghỉ.
- **Tương thích ngay với linh sứ đã cài.** Worker cũ không biết trường `nextDelaySeconds`
  vẫn gửi `complete` như trước; server tự dùng fallback rồi tái xếp job. Không bắt người dùng
  gỡ/cài lại chỉ để nhận hành vi nhiều vòng. Gói cài mới gửi đồng hồ thật để chạy sát hơn.
- **Thu Đàn không lọt qua khe giữa hai vòng.** Stop và complete đều chuyển trạng thái bằng
  UPDATE nguyên tử: bấm đúng lúc `running → queued` vẫn kết thúc job, không có vòng kế âm thầm
  sống lại. Cấu hình được làm mới ở ranh giới an toàn nên chỉnh giữa vòng chỉ áp dụng từ vòng
  sau, không đổi một cú click đang bay.
- **Hai linh sứ không thể cùng ôm một vòng.** Lệnh claim dùng `FOR UPDATE SKIP LOCKED`; nếu hai
  worker hỏi việc đúng một nhịp thì chỉ một người nhận job, người kia bỏ qua thay vì chạy trùng.
- **Hàng chờ không còn bị reaper giết sau hai phút.** Với job sống dai, `queued` có thể là đang
  ngủ tới `next_run_at` hoặc chờ linh sứ bận làm Mê Cung cho người khác; cả hai đều là trạng
  thái lành. Không có linh sứ thì cảnh báo đã được ghi ngay lúc Khai Đàn, còn ý định tiếp tục
  chờ cho tới khi có người nhận hoặc chủ nhân Thu Đàn.
- **Job sống quanh năm nhưng log không phình quanh năm:** mỗi ranh giới vòng giữ 1.000 dòng
  gần nhất. Dashboard hiện rõ “Đang nghỉ — vòng N lúc …”, nói thẳng “chỉ Thu Đàn mới dừng”,
  và khử trùng theo event id nếu poll định kỳ chạm đúng poll sau một thao tác.
- Kiểm chứng: smoke **75/75**; integration trên database thật xác nhận lịch cooldown, refresh
  cấu hình, khóa đua hai worker, fallback `done→queued (~5m)` / `failed→queued (~30m)` và mọi
  đường Thu Đàn đều đúng; build Next.js production xanh.

## 0.16.0 — cài lại một lần là mọc thêm một cái tên, và sổ điểm danh thì không biết quên

- **Mục Linh Sứ hiện hai linh sứ trên một cái máy.** `desktop-lq9der0-wujq` chấm xanh,
  `desktop-lq9der0-439u` chấm xám "28 phút trước" — cùng một máy, hai lần cài. Không có gì
  hỏng: cổng Khai Đàn dùng `anyWorkerOnlineFor` với cửa sổ 30 giây nên cái xác không giả
  được "có người trực", và việc giành job phân xử bằng scope của token chứ không bằng dòng
  trong sổ. Nhưng màn hình ấy **nói dối bằng hình ảnh**, đúng điều mà chính comment trong
  `install.ps1` đã sợ: *"người dùng nhìn vào tưởng mình đang nuôi cả một đàn."*
- **Hậu tố của WORKER_ID thôi ngẫu nhiên, chuyển thành hàm của cái máy.** Băm SHA-256 từ
  `MachineGuid` + tên tài khoản Windows (Linux/macOS: `machine-id`/`IOPlatformUUID` + uid),
  lấy 6 ký tự hex. Cài lại bao nhiêu lần cũng ra đúng một tên.

  Bản cũ *có* logic giữ ID — đọc lại từ `.env` — nhưng nó chỉ cứu được đường **cài đè**.
  `uninstall` xoá cả thư mục nên `.env` chết theo, và **gỡ-rồi-cài-lại lại đúng là đường ta
  bảo người dùng đi khi cần dọn dẹp**. Nghĩa là quy trình dọn dẹp chính thức là đường duy
  nhất chắc chắn đẻ ra bia mộ. Không phải ai viết sai; khe hở nằm ở chỗ hai tệp gặp nhau.

  Tên tài khoản có mặt trong hạt giống vì thư mục cài là `%LOCALAPPDATA%`/`$HOME` của từng
  người: hai tài khoản trên cùng một máy là hai linh sứ thật, phải mang hai tên khác nhau.
  Đọc registry hỏng thì lùi về ngẫu nhiên — một cái xác trong sổ vẫn hơn một bản cài không
  chạy. Đã đo trên máy thật: ba lần chạy liên tiếp ra cùng `desktop-lq9der0-775e84`.
- **Nút ✕ gỡ tên khỏi danh sách**, cho những cái xác đã sinh ra rồi — và cho máy đã bán, bản
  cài đã bỏ. Chỉ hiện ở dòng đã vắng: linh sứ đang trực mà gỡ thì nó ghi tên lại sau năm
  giây, và một cái nút không giữ được lời hứa còn tệ hơn không có nút. `forgetWorker` chốt
  hai lớp — `userId` trong mệnh đề where, và `lastSeen` phải cũ hơn cửa sổ 30 giây.
- Tên đã bấm gỡ giữ ở một state riêng chứ không cắt thẳng khỏi `presence`: nhịp poll 12 giây
  ghi đè cả object bằng dữ liệu máy chủ, nên một phép cắt tại chỗ sẽ bị nhịp poll kế tiếp
  dựng dòng ấy dậy trong lúc lệnh xoá còn đang bay.

## 0.15.2 — hồ sơ trình duyệt ôm một cái xác cookie, và Luyện Đan chết ở #ld-app

- **Luyện Đan Đường hỏng với "Selector không bao giờ xuất hiện: #ld-app".** Trang lò thì
  không sao — vào thẳng bằng cookie đã lưu là `#ld-app` hiện tức thì. Thủ phạm nằm ở hai
  dòng nhật ký debug của linh sứ, đứng cạnh nhau và mâu thuẫn nhau:

  ```
  [debug] Hồ sơ đã có phiên đăng nhập — giữ nguyên, không tiêm cookie.
  [debug] Không xác nhận được trạng thái đăng nhập — vẫn đi tiếp.
  ```

  Hồ sơ Chromium bền giữ cookie phiên do site tự làm mới, nên lúc mở ta cố ý KHÔNG đè chuỗi
  người dùng dán lên trên — đè là tự tay đăng xuất một phiên đang lành. Nhưng phép kiểm ấy
  chỉ hỏi *"có cookie đăng nhập không"*, không hỏi *"nó còn sống không"*. Một cookie đã chết
  vẫn thoả mãn câu hỏi đó, nên linh sứ ôm cái xác đi tiếp và trang lò render ở dạng chưa
  đăng nhập. Lỗi nổi lên ở tên một selector vô tội, mười bước sau nguyên nhân thật.
- **Sửa: đừng tin, hãy thử.** `ensureReady` giờ hỏi thẳng trang; nếu hồ sơ không đăng nhập
  được thì xoá cookie cũ, tiêm lại chuỗi đã lưu, rồi thử lần nữa. Dùng hồ sơ khi nó còn
  chạy, quay về chuỗi người dùng dán khi nó chết — không cần đoán, vì trang vừa trả lời rồi.
  Đã dựng lại đúng cảnh hỏng (nhét một cookie chết vào hồ sơ bền) và xem nó tự chữa.
- **Chốt phủ sóng engine.** Hồ sơ được SINH RA từ bản desktop, nên một loại bước hay loại
  điều kiện mới có thể theo lệnh `export` trôi sang mà không ai đụng vào mã web — và cả hai
  chỗ đều nuốt cái lạ trong im lặng (`conditionProbe` rơi vào `default: return false`, tức
  một `when` không bao giờ nổ). Smoke giờ đối chiếu mọi loại hồ sơ dùng với thứ engine
  hiện thực. Hôm nay: 10 loại bước, 6 loại điều kiện, đủ cả.
- Đã soát 10 nhiệm vụ ngày: mỗi ô tick nối đúng một quest trong hồ sơ, không ô nào trơ.

## 0.15.1 — chữ chìm vào ảnh nền, và một lời hứa đúng nửa vời

- **Chữ trong mục Linh Sứ không đọc nổi.** Panel ấy tự pha nền `bg-ink-800/40` thay vì dùng
  `.card` như hai thẻ kia, nên ảnh nền trang xuyên thẳng qua. Đo được: tương phản **1.27:1**
  — tức gần như vô hình trên những mảng sáng. Sửa bằng cách cho nó dùng chung `.card`.
  Chỉnh màu chữ theo nền thì CSS không làm nổi (không có cách nào biết cái gì đang nằm
  dưới); cho thẻ một cái nền đủ đục mới là câu trả lời đúng.
- Rồi đo tiếp thì `.card` cũ (0.86) cũng chỉ đạt 4.23:1 — dưới chuẩn AA cho chữ nhỏ. Nâng
  lên 0.93/0.96 **và** làm `--color-mist` sáng thêm một nấc (`#8f89b3` → `#9b96be`). Kết
  quả **4.96:1**, tính theo trường hợp tệ nhất là nền trắng tinh nằm dưới. Chọn sửa cả màu
  chữ thay vì chỉ làm thẻ đục thêm, vì nó cứu cả những dòng nằm NGOÀI thẻ.
- **"Tắt trình duyệt vẫn chạy" là lời hứa đúng một nửa.** Thật, nhưng bỏ lửng ở đó thì
  người ta suy ra "tắt máy chắc cũng thế" — sai, nếu linh sứ đang nằm trên chính máy họ.
  Giờ nói đủ: tắt máy thì linh sứ tông môn không sao, linh sứ máy nhà dừng theo. Cùng một
  đính chính ở mục Linh Sứ và trong HUONG-DAN.md (cả câu mở đầu lẫn mục hỏi đáp).

## 0.15.0 — chữ trên Linh Đài nói tiếng người, và có hướng dẫn cho người mới

- **Viết lại toàn bộ chữ hướng dẫn trên Linh Đài.** Giữ nguyên tên riêng có hồn (Linh Đài,
  Khai Đàn, Ngọc Giản, Linh Sứ) — đó là bản sắc sản phẩm — nhưng phần GIẢI THÍCH thì nói
  thẳng. Bỏ những câu gạch-ngang nối dài kiểu "được niêm phong trước khi cất vào tàng khố
  và chỉ được mở đúng khoảnh khắc linh sứ nhận việc"; thay bằng "lưu xong sẽ được mã hoá và
  không bao giờ hiện lại trên màn hình". Dòng đầu trang giờ nói ngay ba bước phải làm, vì
  người mới mở trang cần biết việc của mình chứ không cần một câu chào hay ho.
- Ba thông báo lỗi lúc Khai Đàn cũng viết lại: mỗi câu nói rõ **phải bấm gì tiếp theo**,
  thay vì chỉ tuyên bố cái sai.
- **Cảnh báo linh sứ vừa bị khai tử.** Phát linh phù mới thì linh sứ đang chạy ngừng nhận
  việc, nhưng nó không chết hẳn — cứ quay vô ích và trên màn hình chỉ lặng lẽ thành "vắng".
  Hộp xác nhận cảnh báo TRƯỚC khi bấm là chưa đủ; giờ có thêm một dòng đỏ hiện NGAY LÚC
  người ta nhìn thấy hậu quả, kèm việc cần làm. Đúng chuyện đã xảy ra ngày 02/08.
- **Thêm [HUONG-DAN.md](HUONG-DAN.md)** — hướng dẫn cho người chơi, không phải cho người
  vận hành: lấy cookie thế nào (kèm cả đường Cookie-Editor), mỗi tuỳ chọn nghĩa là gì, khi
  nào mới phải quan tâm tới "linh sứ", bảng tra lỗi thường gặp, và mấy câu hỏi nhanh.

## 0.14.1 — bật chín nhiệm vụ vẫn bị dội "chưa bật nhiệm vụ nào"

- **Chốt khai đàn chỉ đếm hai nhiệm vụ trong số mười hai.** Nó ra đời khi hồ sơ chỉ có Mê
  Cung và Luyện Đan; mười nhiệm vụ ngày thêm vào ở v0.9.0 mà không ai nhớ tới nó. Hệ quả:
  một đạo hữu tick đủ chín nhiệm vụ ngày vẫn bị dội lại "Chưa bật nhiệm vụ nào — chọn ít
  nhất một nhiệm vụ để khai đàn", mâu thuẫn thẳng với những ô đang sáng trước mắt họ.
  Không có lỗi nào trong log, vì đứng từ phía máy thì mọi thứ diễn ra đúng như đã viết.
  Giờ chốt duyệt `Object.values(quests)` — nhiệm vụ thứ mười ba tự được tính.
- Phát hiện khi rà sổ đăng ký chứ không phải từ báo lỗi: bảy người thật đã vào, và người
  DUY NHẤT lưu cấu hình lại rơi đúng vào cái bẫy này. Một lỗi không ai kêu là một lỗi khiến
  người ta lặng lẽ bỏ đi.

## 0.14.0 — tải bộ cài rồi bấm đúp, cột trái thôi bị bóp, và linh sứ bận thôi bị coi là vắng

- **Linh sứ ĐANG BẬN bị báo "vắng mặt".** Sổ điểm danh chỉ ghi ở `claim`, mà một linh sứ
  đang chạy job thì thôi không claim nữa — nên nó tụt khỏi sổ sau 30 giây. Đo được lúc
  linh sứ thật đang giữa một phiên Mê Cung: sống, 4 tiến trình, đang đánh ải, mà dashboard
  báo vắng; và vì `startJob` đọc cùng cái sổ ấy, lượt kế tiếp sẽ nhận cảnh báo sai "chưa
  thấy linh sứ nào điểm danh". Giờ **nhịp tim 20 giây cũng là điểm danh** — bằng chứng sống
  chính xác hơn, và nó vốn đã có sẵn. `workerId` lấy từ chính dòng job chứ không bắt worker
  khai thêm, nên những linh sứ đã cài từ trước không phải cập nhật gì.

- **Không bắt ai gõ lệnh nữa.** Bấm "Tạo bộ cài" → tải về `cai-linh-su.cmd` → bấm đúp.
  Tệp được dựng NGAY TRONG TRÌNH DUYỆT bằng Blob: linh phù vốn đã nằm ở client (action vừa
  trả về), nên không cần thêm endpoint, và bí mật không bao giờ đi qua một URL để rồi nằm
  lại trong log máy chủ. Cách dán lệnh vẫn còn, thu vào sau một dòng "hoặc cài bằng dòng
  lệnh" cho máy chủ/SSH.
- **Nói trước cái đúng cho hầu hết mọi người.** Khi linh sứ tông môn đang trực, mục Linh Sứ
  mở đầu bằng "đạo hữu không cần cài gì cả" — phần cài đặt chỉ là lối rẽ. Đặt ngược lại là
  bắt mọi người tưởng phải cài gì đó mới dùng được. Khi KHÔNG có linh sứ nào trực thì đổi
  sang cảnh báo vàng, vì lúc ấy khai đàn thật sự sẽ nằm chờ.
- **Lỗi layout: cột trái bị bóp còn một sợi chỉ.** Grid item lẫn flex item đều mặc định
  `min-width: auto` — "không co nhỏ hơn nội dung" — nên một dòng lệnh dài không chỗ ngắt
  trong `<pre>` đẩy cột phải phình ra ngoài phần của nó. `overflow-x-auto` trên chính cái
  `<pre>` không cứu được: nó chỉ có tác dụng khi MỌI tổ tiên được phép co. Sửa bằng
  `minmax(0,…)` trên track + `min-w-0` dọc theo chuỗi cha. Đo lại: 566/514 = 1.10 đúng tỉ lệ
  thiết kế, không tràn ngang, kể cả lúc đang hiện lệnh dài lẫn ở màn hình 375px.
- **Tệp .cmd phải THUẦN ASCII** — phát hiện khi chạy thật, không phải khi đọc code. cmd.exe
  phân giải tệp batch theo codepage ANSI TRƯỚC khi dòng `chcp 65001` kịp có tác dụng, nên
  một ký tự tiếng Việt trong tệp là cmd đếm sai byte rồi resume giữa dòng: đo được
  `powershell` biến thành lệnh `ershell`, `echo.` thành `o.`. Giờ nội dung đi qua bộ lọc
  ASCII (giữ `\n` — quên nó là ép cả tệp thành một dòng). Tiếng Việt người dùng thấy đến từ
  install.ps1 tải qua HTTP; `chcp` có mặt chính là để hiển thị phần chữ ấy.
- Phép đổi LF→CRLF cho `.cmd` được làm cho BẤT BIẾN (chuẩn hoá về LF trước) — bản đầu cho ra
  `\r\r\n` vì nội dung đã viết sẵn CRLF rồi bị thay thêm lần nữa.

Đã kiểm trên máy thật: một `.cmd` thuần ASCII dựng đúng khuôn panel sinh ra, chạy bằng
`cmd /c`, tải được install.ps1 (13.497 byte) và in tiếng Việt từ script ấy ra đúng chữ.

## 0.13.1 — sửa hồi quy 0.13.0: server action của /dashboard sập vì hai realm `URL`

Bản 0.13.0 cho `actions/automation.ts` import `parseCookieString` từ `runCycle.mjs`. Cái
giá không thấy được lúc viết: kéo theo cả engine vào bundle của Next, trong đó `profile.mjs`
đọc `profile.json` bằng `readFileSync(fileURLToPath(new URL(…)))` ngay ở THÂN MODULE.
Turbopack thay `URL` bằng bản của nó, nên `fileURLToPath` của Node từ chối:

```
TypeError: The "path" argument must be of type string or an instance of URL.
           Received an instance of URL
```

Lỗi xảy ra lúc NẠP MODULE, nên nó không giết riêng đường cookie — nó giết **mọi** server
action của /dashboard, kể cả phát/thu hồi linh phù, những thứ chẳng liên quan gì tới cookie.
Và chỉ trên bản production: máy dev không bundle nên `URL` chỉ có một.

- **Tách `cookies.mjs` thành module LÁ** — không import gì, không đụng đĩa. Server action
  import từ đó; `runCycle.mjs` re-export nên mọi nơi khác không phải đổi.
- **Chốt hồi quy trong smoke**: khẳng định `cookies.mjs` không có `import` và không có
  `readFileSync`/`fileURLToPath` (bỏ chú thích trước khi soát — chính tệp ấy kể về lỗi này).
  Ngày nào ai đó nối nó về engine, smoke đỏ trước khi production đỏ.
- Đã kiểm ở **chế độ production thật** (`next build` + `next start`, đúng Turbopack bundle
  đã làm vỡ): đăng nhập → /dashboard → phát linh phù → phát lại → thu hồi. Không trang lỗi
  nào, log sạch bóng `ERR_INVALID_ARG_TYPE`. Smoke 68/68.

Bài học ghi lại cho lần sau: mã đi qua **cả** function của Next lẫn worker phải sạch —
không đĩa, không phụ thuộc. Ranh giới ấy mới là thứ quyết định, không phải cái polyfill.

## 0.13.0 — vụ án #lobby-overview: cookie JSON parse ra số không, và số không im lặng

Lượt Mê Cung thật đầu tiên (job 2d6d4a73, 02/08) chết với "Selector không bao giờ xuất
hiện: #lobby-overview". Điều tra bằng A/B trên site thật cho ra thủ phạm KHÔNG như dự đoán:

- **Gốc rễ: người dùng dán bản xuất JSON của desktop** (`{url, cookies:[…]}`) — hành động
  hợp lý nhất trần đời — nhưng `parseCookieString` chỉ hiểu dạng `a=1; b=2` nên trả MẢNG
  RỖNG, không một lời phàn nàn. Browser đi tay trắng, /me-cung đá về trang chủ, và lỗi nổi
  lên mười bước sau dưới tên một selector vô tội. Ba tầng đều lặng thinh: lúc dán (Zod chỉ
  soát độ dài), lúc chạy (chỉ soát chuỗi khác rỗng), lúc chết (thông điệp nói về selector).
- **Sửa tầng một — parser hiểu mọi định dạng hợp lý:** bản xuất JSON của desktop, mảng JSON
  trần của extension, object phẳng, header `Cookie:` copy nguyên, xuống dòng làm dấu ngăn.
  Cookie thuộc site KHÁC trong bản export "tất cả" bị loại — không tiêm rác vào phiên game.
- **Sửa tầng hai — số không phải kêu to, ở thời điểm trung thực nhất:** lúc DÁN, action từ
  chối lưu chuỗi parse ra 0 cookie và nói rõ định dạng nào được nhận; báo luôn số cookie đã
  nhận và cảnh báo nếu thiếu `wordpress_logged_in_…`. Lúc CHẠY, runCycle từ chối lượt với
  lời chỉ đường về Ngọc Giản thay vì để chết ở selector.
- **Sửa tầng ba — port nốt những lớp desktop có mà web thiếu** (lộ ra trong cùng cuộc điều
  tra, dù không phải thủ phạm hôm nay): UA thật thế chỗ "HeadlessChrome/…" (A/B đo được UA
  cũ tự thú đúng chuỗi ấy), `--disable-blink-features=AutomationControlled` +
  `ignoreDefaultArgs` (navigator.webdriver: true → false), timezone + viewport khớp desktop,
  **hồ sơ Chromium bền trên đĩa** (token cf_clearance sống qua các lượt — mỗi lượt không
  phải trình diện Cloudflare như người lạ; nằm cạnh worker nên gỡ cài là sạch theo), và
  **cổng sẵn sàng** port từ EnsureReadyAsync — `readinessProbe` đã được port sang
  boardScripts.mjs từ trước mà chưa từng có ai gọi. Giờ bị chặn là nói bị chặn, hết phiên
  là nói hết phiên, trước khi quest đầu tiên chạy.
- Installer chạy lại KHÔNG cần linh phù khi máy đã cài: tái dùng token trong .env cũ —
  nâng cấp là một lệnh trần, không bắt ai phát lại linh phù (nó chỉ hiện một lần lúc phát).
- Đã kiểm trên site thật với cookie thật: parser mới ra 5 cookie (có phiên đăng nhập, hạn
  16/08), /me-cung đứng vững, **#lobby-overview render** — đúng selector từng chết.
  Smoke 66/66 (7 ca mới cho parser).

## 0.12.1 — gọi thẳng là "tài khoản", và nhật ký dọn được

- **"Pháp Khí" → "Tài khoản hoathinh3d".** Giọng trong-thế-giới vẫn giữ ở mọi chỗ khác
  (linh sứ, tàng khố, ngọc giản), nhưng riêng ô này thì cái tên bóng bẩy che mất thứ người
  dùng cần biết ngay: đây là tài khoản game của họ. Nút xoá ghi rõ **"Xoá tài khoản đã
  lưu"** chứ không phải "Xoá tài khoản" — trên chính trang này họ cũng có một tài khoản
  Auto HH3D, và một nút trần trụi là câu mời hiểu nhầm thành xoá danh tính của chính mình.
- **Nút "Dọn nhật ký"** trên Lư Khai Đàn. Xoá THẬT ở phía server chứ không ẩn trong state
  của React: con trỏ nhật ký reset về 0 mỗi lần tải lại trang, nên một phép "xoá" chỉ nằm
  trong trình duyệt sẽ sống lại nguyên vẹn sau một lần F5. Chỉ chạm lượt gần nhất của chính
  người bấm — `clearLatestJobEvents` tự tra job qua `getLatestJob(userId)` thay vì nhận
  `jobId` từ ngoài, nên không tồn tại đường nào xoá nhầm nhật ký người khác.
- Con trỏ nhật ký KHÔNG bị reset sau khi dọn: id của `job_events` là bigserial không dùng
  lại, nên dòng mới vẫn chảy về; reset về 0 chỉ tổ kéo lại đúng những dòng vừa xoá nếu câu
  DELETE về chậm hơn nhịp hỏi tin kế tiếp.

## 0.12.0 — linh sứ tự mang Node theo, người dùng không phải cài gì nữa

- **Node "xách tay".** Installer tải bản Node chính thức vào thư mục cài và chỉ dùng bản đó
  — bỏ hẳn winget/apt/brew, bỏ quyền admin, bỏ cả đoạn nạp lại PATH và câu "mở PowerShell
  MỚI rồi chạy lại". Ngoài việc xoá rào cản, nó xoá luôn một lớp lỗi: linh sứ tự chạy lúc
  đăng nhập, mà PATH lúc ấy khác PATH trong cửa sổ đang mở, nên `node` tìm qua PATH là lỗi
  "chạy tay thì được, tự khởi động thì không". Bản tải về được đối chiếu **SHA-256** với
  `SHASUMS256.txt` của nodejs.org — ta sắp chạy thứ này như một runtime, không tin suông.
- **playwright-core đóng sẵn trong gói**, không qua npm: thuần JS, không phụ thuộc gì, nén
  ~3MB. Đổi lại: không cần npm, không cần ra registry, và trình tải Chromium chính là
  `cli.js` của bản đang chạy — lỗi "Executable doesn't exist" (CLI lệch phiên bản đặt sẵn
  revision khác) trở thành **bất khả thi về mặt cấu trúc**, chứ không chỉ được canh chừng.
- **Gọi tar bằng đường dẫn tuyệt đối `System32\tar.exe`.** Máy có Git for Windows trong PATH
  đưa ta tới GNU tar, thứ đọc `C:\Users\...` thành «máy chủ C» rồi bỏ cuộc — và bỏ cuộc IM
  LẶNG, vì PowerShell không ném lỗi khi lệnh ngoài trả mã khác 0. Triệu chứng hiện ra ba
  bước sau dưới dạng `Move-Item: PathNotFound`, không nói gì về nguyên nhân. Giờ mọi lệnh
  tar đi qua một hàm bọc có kiểm `$LASTEXITCODE`.
- **Gỡ và cài lại giết ĐÚNG cả ba tầng** (run.ps1 → cmd → node), vòng nuôi trước tiên. Chỉ
  giết `node` là sai: vòng nuôi dựng lại nó sau 10 giây, nên cài lại kết thúc với HAI vòng
  nuôi cùng đọc một `.env` — hai linh sứ mang cùng một WORKER_ID, cùng giành job, cùng mở
  browser trên một máy; còn gỡ cài thì để lại một tiến trình quay vô tận và thư mục bị khoá.
- **Cài lại giữ nguyên WORKER_ID** đã có: ID là danh tính trong sổ điểm danh, sinh mới mỗi
  lần cập nhật sẽ để lại một xác linh sứ "vắng mặt" sau MỖI lần, người dùng nhìn vào tưởng
  mình đang nuôi cả đàn.
- **Hai lỗi mã hoá tiếng Việt.** (a) Next phục vụ `.ps1` là `application/octet-stream` không
  kèm charset, mà `Invoke-RestMethod` của PowerShell 5.1 khi thiếu charset thì giải mã
  ISO-8859-1 — chữ trong script hỏng NGAY TRƯỚC KHI `iex` chạy nó ("Cài linh sứ" → "CÃ i
  linh sá»©"). Đã khai `text/plain; charset=utf-8` trong `next.config.ts`. (b) Nhật ký ghi
  bằng `*>>` của PowerShell bị ghi lại thành UTF-16 kèm cả stack trace `NativeCommandError`;
  chuyển sang cho `cmd` đổ thẳng byte. Với một script tải runtime về chạy, một màn hình đầy
  ký tự rác là điều tệ nhất có thể xảy ra cho lòng tin.
- Nhật ký tự cắt khi quá 5MB — mất mạng một đêm là vài chục nghìn dòng "claim lỗi".

## 0.11.0 — sandbox về vườn, linh sứ dọn lên VM tông môn, và trang cài một-lệnh

- **Vercel Sandbox bị bỏ hẳn** (`runners/sandbox.ts`, `policy.ts`, hai script snapshot, dep
  `@vercel/sandbox`, `outputFileTracingIncludes`). Nó thua ở hai chỗ không chữa được bằng
  code: gói Hobby không có cron đủ dày để lái một VM phù du, và một microVM có trần thời
  gian không bao giờ ôm nổi phiên Mê Cung 35 phút — trong khi MỘT worker sống dai trên VM
  Always Free làm được cả hai việc, đơn giản hơn, không tính tiền compute theo lát. Enum
  `runner_kind` giữ nguyên giá trị `sandbox` trong Postgres (job lịch sử còn mang nó; rút
  một giá trị enum đã dùng là một cuộc phẫu thuật không đáng), nhưng không dòng code nào
  còn ghi giá trị đó.
- **Linh sứ tông môn trên Oracle Cloud Always Free** — kit dựng trọn ở `deploy/oracle/`:
  chọn A1.Flex + Ubuntu 24.04 aarch64 (Playwright hỗ trợ chính thức, có Chromium arm64;
  con AMD micro 1GB thì Chromium chết ngạt), `setup.sh` idempotent dựng Node 22 + Chromium
  + systemd, cập nhật = chạy lại đúng một lệnh. VM chỉ mở SSH — worker là kẻ chỉ gọi ra.
- **Linh phù: token worker riêng cho từng đạo hữu.** Trang cài đại trà mà phát WORKER_TOKEN
  toàn cục là trao cho mỗi người quyền đọc cookie game của tất cả — nên token toàn cục rút
  về làm chìa của linh sứ tông môn, còn mỗi đạo hữu cầm linh phù riêng (database chỉ giữ
  SHA-256, bản rõ hiện đúng một lần lúc phát). Scope cắm thẳng vào câu SQL claim (linh sứ
  riêng chỉ thấy hàng chờ của chủ mình) và ba op còn lại đi qua `jobBelongsTo` — thiếu nó
  thì một linh phù hợp lệ bất kỳ complete được job người khác chỉ bằng cách đoán jobId.
  Tài khoản bị khoá thì linh phù mất hiệu lực theo, không cần ai nhớ đi thu hồi.
- **Mục Linh Sứ trên dashboard + cài một lệnh.** Người dùng không cần biết npm là gì:
  panel phát lệnh cài cho Windows (PowerShell) và Linux/macOS, lệnh tải gói
  `/linh-su/goi-linh-su.tgz` — được `buildWorkerBundle.mjs` đóng ở MỖI deploy từ đúng
  engine đang chạy, không tồn tại bản thứ hai để lệch — cài Node/Chromium nếu thiếu, ghim
  đúng phiên bản playwright-core đọc từ trong gói (lệch một nấc là "Executable doesn't
  exist"), đăng ký tự chạy cùng máy (HKCU Run + vbs ẩn cửa sổ — không cần admin; systemd
  user unit + linger; launchd), kèm sẵn uninstall.
- **Sổ điểm danh linh sứ** (bảng `workers`, migration 0005): mỗi lần hỏi việc là một lần
  điểm danh. Dashboard nói thật NGAY LÚC khai đàn là có linh sứ trực hay không — trước đây
  sự thật ấy chỉ lộ ra sau sáu phút im lặng, khi reaper kết liễu job với một dòng lỗi. Hạn
  không-ai-nhận rút từ 6 phút về 2 (worker hỏi mỗi 5 giây, không còn lý do gì để đợi VM
  dựng); `/api/cron` chỉ còn là lưới vệ sinh.

## 0.10.0 — đàm đạo dọn về kho NoSQL, tin có hạn sống, Tông Môn chia tab

- **Tin đàm đạo rời Postgres, sống trong kho NoSQL (Upstash Redis).** Hai loại dữ liệu
  khác nhau cả nhịp ghi lẫn vòng đời: Postgres giữ danh tính và cấu hình — thứ sống lâu,
  cần giao dịch; tin đàm đạo là dòng chảy tần suất cao tự hết hạn theo ngày, không JOIN
  với ai. Hình dạng: mỗi tin một document JSON (kèm TÊN người gửi đóng băng lúc gửi —
  NoSQL không JOIN, và tên tại thời điểm nói vốn trung thực hơn tên sau này đổi thành),
  một ZSET làm mục lục thời gian (phân trang + quét hạn đều là một câu score-range), cảm
  xúc là field hash — thêm/rút nguyên tử, không có đọc-rồi-ghi để mà đua. Ba bảng chat
  trong Postgres đã DROP (migration 0003/0004).
- **Kho chưa tạo không phải lỗi**: mọi đường trả `storeClosed`, API nói 503 kèm lời người
  đọc hiểu, sảnh treo biển 🏮 "chưa khai mở" — phần còn lại của web không việc gì. Tông
  chủ tạo kho qua Marketplace là sảnh tự sống dậy, không đổi một dòng code.
- **Tin tự tan sau N ngày** (mặc định 7) — sảnh là dòng chảy, không phải tàng thư. Quét
  chạy ở nhịp cron và "tiện đường" mỗi 10 phút khi có người đọc sảnh, nên không có cron
  ngoài vẫn sạch. Số ngày do tông chủ đặt trong trang Tông Môn.
- **Trang Tông Môn chia tab** — "Môn Đồ" (sổ bộ cũ) và "Đàm Đạo" (hạn lưu tin); khung tab
  nhận nội dung server-render qua slot, thêm khu cấu hình sau này là thêm một mục vào
  mảng. Tab đổi hiển thị chứ không unmount, bảng môn đồ giữ nguyên scroll và ô tìm kiếm
  đang gõ dở.
- Xuống dòng trong khung chat đổi sang **Alt+Enter** (Enter vẫn gửi); nhãn nơi vận hành
  ghi rõ "Linh sứ túc trực (máy nhà)".
- Cấu hình hệ thống có nhà mới: bảng `app_settings` một-document-JSONB, Zod gác hai chiều
  — cùng triết lý với user_configs.

## 0.9.0 — Tụ Nghĩa Sảnh, đủ 12 nhiệm vụ, và hậu trường rút vào cánh gà

- **Tụ Nghĩa Sảnh — sảnh đàm đạo toàn tông môn** (`/chat`). Gửi/sửa/thu hồi, trả lời có
  trích đoạn, thả cảm xúc (bấm lại là rút), emoji + sticker, gửi ảnh và file (kéo-thả,
  dán từ clipboard), "đang chấp bút…", dải ngày, cuộn ngược lật trang cũ, nút về-cuối đếm
  tin mới. NỘI DUNG tin là document JSONB — hình thù tin churns như hình thù config, mỗi
  kiểu mới mà dùng cột là một migration; media thì KHÔNG vào database: bytes lên kho Blob,
  document chỉ giữ URL. Thu hồi là soft-delete có vết — sảnh chung mà tin biến mất không
  dấu tích là chỗ để gaslight nhau. Realtime bằng poll ~2.5s xin NGUYÊN trang mới nhất:
  tin cũ cũng biến động (sửa, thu hồi, cảm xúc) nên cursor chỉ-tiến sẽ mù; ở quy mô một
  tông môn, một trang mỗi 2.5s là giá rẻ cho việc không phải đồng bộ từng phần. Đã kiểm
  đầu-tới-cuối bằng phiên thật: UTF-8 tròn vành, quote, reaction, sửa, thu hồi, typing,
  upload lên kho thật.
- **Đủ 12 nhiệm vụ như bản desktop.** Mười nhiệm vụ một-công-tắc vào form theo một bảng
  dịch hai cột (key config ↔ tên trong hồ sơ) — thêm nhiệm vụ sau này là thêm một dòng ở
  hai bảng, không thêm code. Hồ sơ nâng lên schema 42 và từ nay SINH BẰNG LỆNH
  `export` của bộ fixture desktop, không chép tay: chép tay theo diff C# là hẹn ngày hai
  bản lệch nhau ở đúng một dấu nháy trong script.
- **Mê Cung thêm "trục xuất nếu không sẵn sàng sau N giây"** (0 = tắt) — ghế của người
  không sẵn sàng là ghế người khác không ngồi được. Đồng hồ tính từ lúc linh sứ NHÌN THẤY
  thành viên lần đầu: tool không làm chứng cho những giây nó không quan sát.
- **Luyện Đan kiểm thu đan lần hai ngay trước khai lô** — mẻ có thể chín trong chính những
  giây lượt này đang bận phân giải, và lượt kiểm đầu đã trôi qua từ trước đó.
- **Hậu trường rút vào cánh gà.** Ô "Nơi vận hành đàn pháp" khoá hẳn (một lựa chọn đang
  phụng sự, một "chưa xuất quan"); mọi text giải thích thôi nhắc hạ tầng — người chơi đọc
  chuyện linh sứ và tàng khố, không đọc chuyện máy ảo và mã hoá. Đã quét trang sống: không
  còn một chữ kỹ thuật nào lộ ra.
- Suite: 62/62. Bảng chat migrate bằng file SQL commit như mọi migration khác.

## 0.8.1 — có đường đặt lại mật khẩu, vì seed cố ý không làm việc đó

- **`npm run db:reset-password <tên>` ra đời.** `db:seed` **cố ý** không đổi mật khẩu của
  tài khoản đã tồn tại — một lệnh seed lỡ tay không được phép reset chìa khoá của hệ thống
  đang chạy. Điều đó đúng, nhưng nó để lại một ngõ cụt có thật: khi mật khẩu trưởng môn thất
  lạc, chạy lại seed chỉ in "đã tồn tại — không đổi gì cả" rồi **thoát 0**, trông y hệt như
  đã làm xong việc. Người dùng gõ mật khẩu mới vào `.env`, chạy seed, thấy màu xanh, và vẫn
  không vào được — không một dòng nào nói rằng mật khẩu chưa hề bị đụng tới.
- Script được làm cho **ồn ào** đúng ba chỗ đã từng cắn dự án này: tên tài khoản phải khai
  tường minh (không mặc định, để không lỡ tay), database được **in ra trước khi ghi** (hai
  database trên cùng một host đã một lần bị nhầm), và mật khẩu đi qua biến môi trường chứ
  không qua tham số dòng lệnh — tham số sẽ nằm lại trong lịch sử shell và hiện trong bảng
  tiến trình.

## 0.8.0 — bảo hoa rơi, footer về đúng đáy, và web vừa mọi màn hình

- **Footer hết lơ lửng.** Trang auth chỉ cao 80dvh để căn giữa lá bài, nên dòng ký tên đứng
  chơ vơ ở vạch 80% màn hình. Sticky footer kiểu cột dọc (body flex-column + margin-top:auto)
  đưa nó về đáy khung nhìn khi trang ngắn, sau nội dung khi trang dài — đo trên trang sống:
  khoảng cách tới đáy tài liệu = 0px ở cả ba trang.
- **Login/Register có nút "← Về Trang Chủ".** Hai trang nghi lễ không mang SiteHeader, nên
  trước đó ai lỡ bước vào chỉ còn nút Back của trình duyệt.
- **Bảo hoa rơi trên trang chủ** — cánh hoa hồng phấn ánh tím của Bảo Hoa tiên tử (Phàm Nhân
  Tu Tiên), vị tiên tử ký tên ở chân trang. Mười hai cánh hai lớp (hồng phấn + tím nhạt),
  rơi nghiêng theo hai chu kỳ lệch pha để không bao giờ thành đàn; pointer-events none nên
  hoa chỉ để ngắm, không chắn một cú bấm nào. Chỉ trang chủ có hoa — sảnh đón thì rắc hoa,
  bàn làm việc thì không.
- **Responsive cho mọi thiết bị.** Đệm trang co theo màn hình (px-4 → sm:px-6), header cho
  phép xuống hàng thay vì ép ngang, hero co chữ ba nấc (3xl/4xl/5xl), veil đệm bằng clamp()
  thay vì 2.5rem cứng từng đẩy tràn ngang máy 360px, bảng thành viên admin đã cuộn ngang từ
  trước. Đo ở 375×812: tràn ngang 0px trên cả ba trang công khai.

## 0.7.0 — cái chờ thức dậy đúng lúc sự kiện xảy ra, và chữ thôi chìm vào trăng

- **`waitForCondition` chuyển từ poll sang MutationObserver trong trang.** Vòng cũ lấy mẫu
  mỗi 300ms qua CDP; một trạng thái tồn tại ngắn hơn nhịp đó — hàng roster loé qua sảnh,
  nút mở khoá trong chớp mắt giữa hai lần re-render — đơn giản là vô hình với nó. Giờ cái
  chờ sống trong trang và được mutation đánh thức NGAY tại sự kiện: đo trên lưới, phần tử
  hiện ở t=600ms thì bước xong ở t=605ms, và một trạng thái chỉ loé 150ms được bắt gọn —
  ca mà vòng poll cũ trượt hẳn. Mê Cung dựng gần như toàn bộ bằng những cái chờ này (sảnh
  đầy dần, phản ứng trục xuất, trận kết thúc), nên đây chính là "quan sát liên tục như
  realtime". Cắt lát 2 giây để lệnh dừng và ngân sách bước vẫn cầm quyền từ bên ngoài;
  tick 400ms trong trang làm lưới an toàn cho thay đổi hiếm hoi không kèm mutation. Bản
  desktop đổi cùng cơ chế, cùng lúc.
- **Chữ và nút bị ảnh nền nuốt được trả lại độ tương phản** — và CHỈ những chỗ bị nuốt.
  Khối chữ hero trang chủ nằm đè đúng lõi trăng sáng nên chữ vàng gradient lẫn vào trăng:
  thêm một tấm veil tối mờ (blur 10px) ôm sát khối chữ, ấn phía trên và ba pillar bên dưới
  vẫn đứng thẳng trên ảnh. Nút ghost ("Nhập Môn", "Đã có đạo hiệu") vốn trong suốt 96% nên
  biến mất trên vệt nước sáng và tán lá vàng: giờ tự mang nền tối mờ + viền đậm hơn, vẫn
  là ghost đứng cạnh nút vàng đặc, nhưng không còn chỗ nào trên ảnh nuốt được nó.
- Suite: 59/59 — bốn ca mới ghim đúng ngữ nghĩa realtime: bắt trạng thái loé 150ms, thức
  dậy sát sự kiện (đo bằng đồng hồ), và timeout vẫn ra một câu có tên.

## 0.6.0 — thành Auto HH3D, và artwork thật thay cho bản dựng lại

- **Đổi tên hiển thị: Jarvis HH3D → Auto HH3D** — title, header, chữ trên trang chủ. Tên
  repo và tên gói giữ nguyên: đường link, remote và lịch sử không việc gì phải gãy theo một
  cái tên hiển thị.
- **Nền và ấn giờ là FILE GỐC**, không phải bản dựng lại. Bản 0.5.0 vẽ xấp xỉ cả cảnh đêm
  lẫn con dấu bằng CSS/SVG vì chưa có file; giờ hai tấm gốc nằm trong `public/`
  (`backdrop.png` — Nam Cung Uyển dưới trăng, `seal.png` — ấn thư pháp), nguyên vẹn từng
  pixel, và toàn bộ trăng-lá-núi-chùa giả cùng font Dancing Script đã dọn đi: hai mặt trăng
  trên một bầu trời là thứ không cứu được. Không phủ lớp tối lên ảnh — header và card tự
  mang nền mờ của chúng, nên ảnh được để yên đúng như yêu cầu.
- Ấn hiển thị qua `next/image` với `priority`: con dấu luôn đứng đầu màn hình, để lazy thì
  nó là thứ nhấp nháy vào sau cùng ở đúng chỗ mắt nhìn trước tiên. Optimizer phục vụ bản
  ~120px, không đẩy nguyên tấm 2.3MB xuống trình duyệt.
- Chữ mới trên trang chủ: "Nhật Ký Tu Luyện" nói giọng tu chân ("log bằng ngôn ngữ nhân
  tộc"), khối "Tông Môn Nghiêm Cẩn" thêm dòng "Chỉ dành cho thành viên Lạc Vân Tông", và
  chân trang ký "© 2026 Bảo Hoa tiên tử. All rights reserved."

## 0.5.0 — hai hạng tài khoản, và trang web khoác áo đêm trăng

- **Nhiệm vụ tách hai tab: VIP và Thường** — theo đúng cách site chia tài khoản. Mọi nhiệm
  vụ hiện có đều được ghi trên tài khoản VIP nên nằm cả bên tab VIP; tab Thường thành thật
  là chỗ giữ chỗ, flow cho tài khoản thường sẽ về sau. Tab chỉ đổi hiển thị chứ không
  unmount: các ô nhập phải luôn trong DOM để FormData lúc lưu gom đủ giá trị — unmount tab
  VIP rồi bấm lưu từ tab Thường là lặng lẽ tắt hết nhiệm vụ.
- **Linh sứ tự nhận ra hạng tài khoản**, không bắt người dùng khai. Tín hiệu là thẻ Phúc Lợi
  VIP `#nv-pt-vip-quest` trên hub — site chỉ phục vụ thẻ này cho tài khoản VIP. Probe trả
  ba đáp án và đáp án thứ ba là thứ đắt nhất: `null` khi CHƯA CHỨNG MINH ĐƯỢC sự vắng mặt.
  Hub render làm hai đợt (bốn thẻ đầu tới ngay, đợt chứa thẻ VIP tới sau ~2.5 giây — đo từ
  bản ghi thực địa), nên một probe vội sẽ phán "thường" ngay trong khe hở đó và một tài
  khoản VIP mất trọn chu kỳ. Sự vắng mặt chỉ được tính khi một thẻ CÙNG ĐỢT đã có mặt.
  Chính suite fixture bên desktop bắt được lỗi này trước khi nó kịp chạy thật (ca V6).
- Mọi ngả mù — hub không mở được, probe không trả lời kịp — đều đổ về VIP: đó là hạng duy
  nhất hồ sơ hiện có được viết cho, và đoán nhầm "thường" là lặng lẽ bỏ trống lượt của
  người ta.
- `requiresVip` vắng mặt trong hồ sơ cũ được đọc là TRUE, cùng chiều với bản desktop, cùng
  lý do.
- **Ấn tông môn vẽ lại theo mẫu thư pháp**: "Phàm nhân tu tiên" ba dòng bút lông vàng kim
  (Dancing Script, subset vietnamese — font script thiếu subset sẽ rơi về font hệ thống ở
  đúng những ký tự có dấu), lồng vòng tròn kép chấm-rời-xoay-chậm + nét liền.
- **Nền chuyển thành đêm trăng**: trăng lớn toả quầng ba lớp lệch phải, trời xanh mực, dãy
  núi và thuỷ đình + chùa nhỏ thắp đèn ấm ở chân trời, mặt nước loang vệt trăng, chín chiếc
  lá vàng rơi theo nhịp riêng (hai chu kỳ nguyên tố giữ chúng không bao giờ khoá pha thành
  đàn). Thuần CSS/SVG — không tải một tấm ảnh nào.
- Suite: 55/55 (`npm run smoke`).

## 0.4.1 — tách lịch sử ra khỏi README

- Lịch sử phát hành chuyển sang chính file này. README đã phình tới mức phần hướng dẫn bị
  chôn dưới lịch sử, mà hai thứ đó phục vụ hai lúc khác nhau: README đọc khi đang dựng hệ
  thống, changelog đọc khi đang truy một hành vi lạ về nguồn gốc của nó. Bản desktop tách
  cùng lúc và cùng lý do — README bên đó có 1828 dòng thì 1440 dòng là changelog.

## 0.4.0 — người dùng chọn được nơi chạy, nhưng sandbox còn là cổng hẹp

- **Ô "Nơi vận hành đàn pháp" giờ mặc định linh sứ máy nhà**, và lựa chọn sandbox bị khoá
  với mọi tài khoản trừ tông chủ. Lý do đứng sau cái khoá: mỗi lát sandbox là một máy ảo
  tính tiền trên tài khoản Vercel dùng chung, và chừng nào chưa đo được chi phí theo từng
  người thì mở rộng là mở một vòi không có đồng hồ. Mở lại cho tất cả = trả về `true` trong
  `sandboxAllowedFor()`, một chỗ duy nhất mà cả ba tầng dưới đây đều hỏi.
- **Ràng buộc sống ở ba tầng, không phải ở form.** Form làm mờ lựa chọn và nói vì sao mờ;
  action đọc vai trò từ phiên rồi ép lại lúc lưu, vì `disabled` chỉ là một thuộc tính HTML
  và một POST dựng tay chẳng đi qua form lần nào; `decideRunner` kiểm lại lúc khai đàn, đọc
  quyền từ **dòng user**. Tầng thứ ba mới là tầng cần nhất: `sandbox` từng là giá trị **mặc
  định**, nên mọi document đã nằm trong database đều đang mang đúng chữ đó, và chúng không
  đi qua form lần nào. Nó cũng khiến việc tông chủ hạ quyền ai đó có hiệu lực ngay ở lượt kế
  tiếp, không phải chờ người đó mở form lưu lại.
- Quyền **không** được lấn át hình dạng nhiệm vụ: Mê Cung vẫn về máy nhà kể cả với tông chủ,
  vì mất VM giữa trận là bốn người khác mất lượt oan.
- **Sửa một lỗi hoán chỗ suýt gây mất đồ.** Form ghi "Không phân giải (giữ tất cả)" bằng giá
  trị `5`, trong khi lớp dịch đọc con số là "giữ từ N sao trở lên". Đan chỉ rơi 1–4 sao, nên
  "giữ từ 5" là **phân giải sạch** — người dùng bấm giữ tất cả rồi mất tất cả, không một
  dòng lỗi nào để lần ra. Giá trị đúng là `1`; cả hai mốc giờ có ca kiểm riêng.
- Suite: 51/51 (`npm run smoke`).

## 0.3.0 — engine thật thay cho vòng chờ giả, và nó dùng chung hồ sơ với bản desktop

- **Hai worker thôi là khung.** Trước đó giao thức, nhịp tim, dừng an toàn và tường thuật
  đều chạy được nhưng chưa từng chạm game; giờ chúng chạy bộ thông dịch thật.
- **Điều đáng nói không phải "đã port", mà là port cái gì.** Hồ sơ quest không phải cấu hình
  — nó là *tri thức về site*, mỗi selector là một buổi tối ngồi xem trang thật và vài cái là
  cả một đêm hỏng việc mới rút ra. Nên web không chép lại tri thức ấy: nó đọc thẳng
  `profile.json` schema 41 mà bản desktop đang chạy, và chỉ bộ thông dịch (13 loại bước × 6
  loại điều kiện) được viết lại bằng JS. Site đổi marker thì sửa một chỗ, không phải hai.
- **Ba lỗi port do lưới hồi quy bắt, đều là loại không tự kêu:**
  - Playwright bản .NET tự **gọi** một chuỗi hình dạng `() => {…}`; bản JavaScript đánh giá
    nó ra một function rồi trả `undefined`. Mọi script trong hồ sơ đều viết dạng đó. Để
    nguyên thì mọi bước `evaluateJavaScript` im lặng trả undefined — toàn bộ tường thuật Mê
    Cung, mọi quyết định trục xuất, mọi lần đọc bảng điểm đều mất tiếng, và không có một
    dòng lỗi nào để lần ra.
  - `\b` của JavaScript chỉ biết `[A-Za-z0-9_]`, nên sau chữ "giờ" — kết thúc bằng "ờ" — nó
    không thấy ranh giới nào và "còn 2 giờ 5 phút" đọc ra 5 phút. Bản C# dùng cùng regex mà
    vẫn đúng vì `\w` của .NET nhận cả chữ Unicode. Hậu quả không phải một ngoại lệ mà là một
    lịch sai, lặp lại mỗi lần.
  - Một ngưỡng HP người dùng tự gõ, nếu không có trong danh sách lựa chọn, sẽ rơi về lựa
    chọn đầu tiên — tức "Không trục xuất". Người ta gõ 250.000 rồi ngồi xem cả lượt không
    đuổi ai. Giờ giá trị lạ được nhận nguyên văn qua `allowCustom`, và việc đó được kể lại.
- **Các probe in-page chuyển từ chuỗi sang hàm thật**, vì Playwright bản JS nhận thẳng
  function. Dạng chuỗi bắt mọi `\s`, `\p{L}`, `${` phải escape thêm một tầng, và chỗ nguy
  nhất là bảng phân loại nút popup — regex hỏng ở đó nghĩa là bấm "Huỷ" thay vì "Đồng ý".
- **Ảnh VM chuyển từ agent-browser sang playwright-core + Chromium cùng phiên bản**, cài tại
  thư mục làm việc chứ không `-g`: Node giải bare specifier bằng cách đi ngược cây thư mục,
  một gói global không nằm trên đường đi đó. Kèm `scripts/verifySandboxSnapshot.mts`, vì một
  ảnh hỏng **không kêu lúc chụp** — nó kêu trên production, trong một VM đã tự huỷ, sau khi
  người dùng bấm nút.
- Thêm `npm run smoke`: lưới hồi quy chạy trên Chromium thật, trước một trang thật. Mỗi ca
  là một chuyện đã xảy ra một lần rồi.

## 0.2.0 — ghi lại những cái bẫy của lần deploy đầu tiên

- **Bẫy `DATABASE_URL`.** Integration Neon của Vercel tự tạo biến này trỏ vào database *mặc
  định* của project (`neondb`), không phải `jarvis`. Nguy ở chỗ nó không gãy: `db:migrate`
  chạy trót lọt vào nhầm database, app lên vẫn đăng nhập được bằng dữ liệu sai, nên chẳng có
  gì kêu lên — chỉ có người ngồi tự hỏi sao mật khẩu vừa đặt lại không đúng. Đây chính là
  cách bốn bảng rác trong `neondb` ra đời. README giờ nêu đích danh cái bẫy, kèm câu lệnh hỏi
  thẳng database "mày là ai".
- **`WEB_URL` không hề có trong `.env.example`**, dù thiếu nó thì sandbox từ chối chạy: VM
  sinh ra bên ngoài Vercel nên không có cách nào tự đoán ra tên miền của bạn.
- **README quả quyết `vercel.json` "chạy mỗi phút"**, trong khi file ghi `0 3 * * *` — tàn
  tích từ trước lúc biết gói Hobby chỉ cho cron mỗi ngày một lần. Đọc nhầm chỗ này thì tưởng
  sandbox tự chạy liên tục, mà thật ra sau lát đầu tiên sẽ không ai gõ cửa nữa.
- `createSandboxSnapshot.mts` thôi đòi token cá nhân: sau một lần `vercel env pull`, `.env`
  đã có `VERCEL_OIDC_TOKEN` và SDK tự dùng được.

## 0.1.0 — control plane đầu tiên

- **Web không bao giờ tự mở browser.** Bấm Khai Đàn = ghi một dòng `automation_jobs` trạng
  thái `queued`. Function của Vercel sống theo request và không thể nuôi một phiên Chromium
  35 phút; nên web giữ *ý định* của người dùng trong database, còn việc mở browser thật do
  một linh sứ ở máy khác làm. Trình duyệt của người dùng chỉ là cái điều khiển từ xa — đóng
  nó đi không thay đổi gì.
- **Hai runner sau một giao diện chung, chọn theo hình dạng thời gian của nhiệm vụ.** Luyện
  Đan Đường (mỗi lượt vài phút, nghỉ ~26 phút) hợp một VM phù du; Mê Cung (chờ đủ 5 người
  thật rồi đánh liền 35 phút, một phiên browser không đứt được) **bắt buộc** máy nhà. Chính
  sách phủ quyết lựa chọn của người dùng và **ghi rõ lý do** vào nhật ký, không âm thầm làm
  khác ý.
- **Cookie game mã hoá AES-256-GCM at-rest**, IV mới mỗi lần, phong bì `v1.<iv>.<tag>.<ct>`.
  Cookie đi **một chiều**: không bao giờ trả về trình duyệt — một bí mật đã mã hoá trong
  database mà vẫn render vào HTML mỗi lần mở trang thì coi như chưa mã hoá. UI chỉ hiện
  "đã có / chưa có" cùng một ô thay thế; để trống là giữ nguyên. Giải mã đúng **một lần**,
  tại `/api/worker`, sau khi linh sứ đã xác thực bằng `WORKER_TOKEN`.
- **Sandbox chạy được trên gói Hobby nhờ đảo vai.** Function không chờ VM: nó dựng VM,
  `writeFiles` một worker script, `runCommand({ detached: true })`, rồi trả về trong vài
  giây. VM sống bằng timeout của chính nó và tự gọi `/api/worker` bằng đúng giao thức bốn
  thao tác mà worker máy nhà dùng. Nhờ vậy trần 60 giây của function Hobby thành vô hại, và
  hai runner là hai hiện thân của **một** hợp đồng.
- **Hai giới hạn gói Hobby đụng phải, né bằng thiết kế chứ không bằng cách trả tiền:** cron
  chỉ 1 lần/ngày (nên bấm Khai Đàn thả sandbox ngay, không đợi nhịp) và function chỉ sống 60
  giây (nên không bao giờ `await` sandbox trong route).
- Config người dùng là JSONB trong chính Postgres, Zod validate **cả hai chiều** — document
  viết bởi một bản deploy cũ vẫn trở về đúng hình thù hôm nay, defaults điền đủ. Đó là bản
  sinh đôi của một migration schema, dành cho dữ liệu không có schema.
