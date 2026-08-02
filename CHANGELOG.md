# Changelog

Lịch sử phát hành của Auto HH3D — Web (tên cũ: Jarvis HH3D). Mới nhất ở trên.

Mỗi mục nói **cái gì đổi và vì sao**, thường là kể đích danh lần hỏng việc đã buộc phải đổi.
Đó là chủ ý: đây là chỗ duy nhất lý do còn sống sót: mã nguồn chỉ giữ được kết quả của một
quyết định, không giữ được cái giá đã trả để biết. Và cái giá ấy mới là thứ ngăn người sau —
kể cả chính mình sáu tháng nữa — phạm lại đúng lỗi đó.

Xem [README.md](README.md) để biết hệ thống chạy thế nào.

---

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
