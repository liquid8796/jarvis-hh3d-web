# Changelog

Lịch sử phát hành của Auto HH3D — Web (tên cũ: Jarvis HH3D). Mới nhất ở trên.

Mỗi mục nói **cái gì đổi và vì sao**, thường là kể đích danh lần hỏng việc đã buộc phải đổi.
Đó là chủ ý: đây là chỗ duy nhất lý do còn sống sót: mã nguồn chỉ giữ được kết quả của một
quyết định, không giữ được cái giá đã trả để biết. Và cái giá ấy mới là thứ ngăn người sau —
kể cả chính mình sáu tháng nữa — phạm lại đúng lỗi đó.

Xem [README.md](README.md) để biết hệ thống chạy thế nào.

---

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
