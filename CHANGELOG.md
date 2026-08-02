# Changelog

Lịch sử phát hành của Jarvis HH3D — Web. Mới nhất ở trên.

Mỗi mục nói **cái gì đổi và vì sao**, thường là kể đích danh lần hỏng việc đã buộc phải đổi.
Đó là chủ ý: đây là chỗ duy nhất lý do còn sống sót: mã nguồn chỉ giữ được kết quả của một
quyết định, không giữ được cái giá đã trả để biết. Và cái giá ấy mới là thứ ngăn người sau —
kể cả chính mình sáu tháng nữa — phạm lại đúng lỗi đó.

Xem [README.md](README.md) để biết hệ thống chạy thế nào.

---

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
