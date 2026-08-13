# Khôi lỗi tông môn thứ hai — chạy trên GitHub Actions

Từ 12/08/2026 tông môn có **hai** khôi lỗi hạng tông môn, không phải một:

| | `tong-mon-khoiloi` | `github-khoiloi` |
|---|---|---|
| Ở đâu | VM Oracle Always Free, 4 vCPU/24GB | Runner của GitHub Actions, 4 nhân/16GB — trên TÀI KHOẢN KHÁC, không bao giờ ở kho gốc (§4) |
| Sống | 24/7, liền mạch hàng tuần | Từng lượt ~4,8 giờ, lịch 4 giờ/lần nối nhau |
| Ghế | 3 đàn × 4 tab | 2 đàn × 3 tab |
| Tài liệu | [oracle/README.md](oracle/README.md) | tệp này |
| Vai trò | gánh chính | cộng thêm |

Cả hai cầm `WORKER_TOKEN` toàn cục, nên **cùng hạng** dưới mắt hệ thống. VM vẫn là chỗ gánh
chính; bản trên Actions là phần cộng thêm, mất nó thì tông môn chậm lại chứ không đứng.

---

## 1. Tầng phân công: CÓ, từ 14/08/2026 — và nó ở đúng MỘT chỗ

> Mục này viết lại. Bản trước nói「KHÔNG có tầng phân công nào, đừng dựng nó」— đúng cho tới ngày
> tông môn còn hai khôi lỗi. Với bảy cái thì luật「ai hỏi trước lấy trước」xếp việc theo NHỊP HỎI
> chứ không theo SỨC CHỨA, nên nay đã có một tầng thật. Ghi lại đoạn cũ ở đây để phiên nào đọc
> phải bản trong lịch sử thì biết luật đã đổi, chứ không phải hai luật cùng sống.

Tầng ấy là `src/lib/services/dispatch.ts` — **một hàm THUẦN**, `pickDispatch`, có lưới kiểm
riêng (`npm run verify:dispatch`, 35 phép kiểm). Đừng dựng cái thứ hai ở đâu khác.

- **Vẫn là PULL.** Máy chủ không gọi được vào khôi lỗi (VM sau NAT, runner Actions không có địa
  chỉ bền). Khôi lỗi vẫn hỏi việc mỗi 5 giây; cái đổi là câu trả lời — nay là「tới lượt ngươi」
  hoặc「chưa」.
- **Luân phiên theo `workers.last_assigned_at`**: ai lâu chưa được giao nhất thì tới lượt. Khôi
  lỗi vừa lên ca (`null`) đứng ĐẦU hàng, nên thêm một máy là nó có việc ngay từ vòng kế.
- **Máy chủ biết trần ghế của từng máy** (`workers.max_jobs`, do chính tiến trình khai ở mỗi lượt
  gõ cửa) và đếm ghế đang bận, nên nó không giữ lượt cho một máy đã đầy.
- **Van chống đói**: đàn tới giờ mà nằm quá 20 giây thì thôi chờ lượt — ai đủ tư cách cũng nhận
  được. Nó cứu ca「tiến trình còn thở nhưng vòng hỏi việc kẹt」, thứ sổ điểm danh không phát hiện
  ra.
- `claimNextJob` **vẫn** kết bằng một câu UPDATE có điều kiện — Postgres vẫn là trọng tài cuối,
  không ai chạy đôi. Index `jobs_one_active_per_account` vẫn chặn hai đàn sống cùng một tài khoản.

**Số ghế giờ trở lại đúng nghĩa của nó: trần RAM của một cái máy, không phải núm dịch tải.** Từ
14/08/2026 mọi khôi lỗi đều `WORKER_MAX_JOBS=2` — VM, Actions, khôi lỗi trọ — và việc được trải
đều bằng luân phiên. Tổng mức song song của tông môn vẫn là tổng số ghế, nên thêm một máy là thêm
đúng 2 suất.

## 2. Người dùng KHÔNG chọn máy, chỉ chọn hạng

Ô「Giao đàn cho」có đúng ba lựa chọn: **tông môn / máy nhà / ai rảnh cũng được**. Không có, và
không được thêm, lựa chọn theo tên máy.

Luật nằm ở `workerPrefFilter` trong `services/jobs.ts`, và nó lọc theo **hạng**:

```ts
const forbidden: WorkerPref = scope.kind === "operator" ? "mine" : "sect";
```

Mọi tiến trình xác thực bằng `WORKER_TOKEN` toàn cục đều là `operator`, nên `tong-mon-khoiloi`
và `github-khoiloi` đứng ngang nhau — không có `worker_id` nào xuất hiện trong mệnh đề.

Đó là lý do thêm khôi lỗi thứ ba ngày mai **không phải sửa một dòng luật nào**. Hàng rào viết
theo TÊN thì mỗi lần thêm máy là một lần sửa luật, và mỗi lần sửa là một dịp để quên.

## 3. Thứ THẬT SỰ phải xây: pha rút lui

Runner bị giết cứng ở mốc **6 giờ**. `worker.mjs` vốn chạy `for(;;)` vô tận. Bị giết giữa một
ván Mê Cung 35 phút thì nhịp tim tắt, và `reapStaleJobs` kết liễu đàn ấy thành `failed` sau 3
phút — **mất trọn một vòng của một đạo hữu, đều đặn mỗi 6 tiếng**. Toàn bộ tính năng này sinh ra
để cái mốc ấy không bao giờ chạm vào một đàn đang chạy.

Hai biến, cả hai **mặc định `0` = vô hạn** nên VM và máy nhà giữ nguyên hành vi cũ từng byte:

| Biến | Ở workflow | Nghĩa |
|---|---|---|
| `WORKER_MAX_LIFETIME_MS` | 290 phút | Quá hạn thì THÔI NHẬN VIỆC MỚI — không chết ngay |
| `WORKER_DRAIN_TIMEOUT_MS` | 50 phút | Chờ tối đa bấy nhiêu cho đàn dở đi nốt vòng |

Ba con số phải giữ đúng quan hệ này, đừng vặn lẻ một cái:

```
290 (thôi nhận) + 50 (chờ thu) = 340  <  350 (timeout job)  <  360 (trần nền tảng)
lịch 4 giờ/lần   <   tuổi thọ ~4,8 giờ   →   lượt kế đã chờ sẵn khi lượt cũ thu đàn
```

- **Đừng hạ hạn chờ thu xuống dưới ~40 phút**: Mê Cung một ván ~35 phút, hạ xuống là tự tay
  làm đúng cái việc mà cơ chế này sinh ra để tránh.
- **Đừng để lịch thưa hơn tuổi thọ**: thưa hơn thì có khoảng hở không ai trực; dày hơn thì
  `concurrency` giữ đúng một lượt chạy + một lượt chờ, khoảng hở gần bằng 0.
- **`cancel-in-progress` phải là `false`**: huỷ lượt đang chạy nghĩa là cắt ngang đàn đang cày.

Hết hạn chờ mà còn đàn dở thì worker thoát với mã **khác 0** — có người sắp mất một vòng, chuyện
ấy phải hiện đỏ chứ không đáng lặng lẽ trôi qua.

## 4. KHO GỐC KHÔNG CHẠY KHÔI LỖI (13/08/2026)

Bản mẫu workflow sống ở **`deploy/github/linh-su.yml`**, tức NGOÀI `.github/workflows/`. Đó là
chỗ GitHub không bao giờ chạy, và đấy là toàn bộ mục đích.

Kho gốc `liquid8796/jarvis-hh3d-web` là kho **công khai giữ mã nguồn**, nên một workflow khôi lỗi
đặt ở đó kéo trọn ba rủi ro của §6 vào chính nó: `WORKER_TOKEN` — chìa TOÀN CỤC, mở cookie của
MỌI thành viên — nằm trong Secrets của nó; nhật ký Actions vĩnh viễn, ai cũng đọc, của một tiến
trình chuyên cầm cookie game đã giải mã; và một kho「cày game 24/7」mang luôn cả mã nguồn tông môn.
Ở một kho SINH RA, cái giá của ba thứ ấy là mất một kho dùng rồi bỏ. Ở kho gốc, cái giá là mất
kho gốc.

Nên khôi lỗi GitHub **chỉ sống trên các tài khoản khác**, trong kho do `github:new` dựng:
`newGithubKhoiloi.mjs` đọc bản mẫu rồi ghi vào `.github/workflows/linh-su.yml` **của kho ấy**,
thay đúng hai dòng `WORKER_ID` và `WEB_URL`. Một bản mẫu, nhiều kho — bộ số 290/50/350/360 không
có cơ hội trôi khỏi nhau.

Hàng rào này là **một tệp KHÔNG có mặt**, mà loại hàng rào ấy không tự giữ được mình: một cú
`git mv` ngược lại, hay một bản chép để「chạy thử một lượt rồi xoá」, dựng lại nó mà chẳng ai thấy.
Vì thế `npm run verify:github-removal` canh rằng **không workflow nào của kho gốc gọi
`scripts/worker.mjs`** — canh theo NỘI DUNG, nên đổi tên tệp không lách được. Hai ca đột biến đã
thử, cả hai làm script đỏ đúng chỗ: chép lại đúng `linh-su.yml`, và chép lại dưới tên khác.

### Cài đặt một kho dựng bằng TAY — một bước

`github:new` dán secret sẵn bằng `gh secret set`, nên đoạn này chỉ dùng khi dựng tay. Settings →
Secrets and variables → Actions → New repository secret, **ở kho ấy**:

```
WORKER_TOKEN    (đúng giá trị đang đặt trên Vercel)
```

Lấy giá trị: `vercel env pull .env --environment=production --yes` rồi đọc dòng `WORKER_TOKEN`.
**Không** dùng `npm run env:pull` — lệnh ấy kéo môi trường *development*, nơi `WORKER_TOKEN`,
`AUTH_SECRET` và `DATABASE_URL` đều không tồn tại.

Chạy thử: Actions → **Khôi lỗi tông môn (GitHub)** → Run workflow, ở kho sinh ra chứ không phải
kho gốc.

**Dấu hiệu khoẻ:** mục Khôi Lỗi trên dashboard hiện HAI khôi lỗi tông môn đang trực. Thiếu
secret thì bước cuối dừng ngay với một dòng đỏ nói rõ, không chạy rỗng.

## 5. Chưa có bằng chứng — đọc trước khi tin

Hai đoạn mã dưới đây **chưa từng chạy trên Linux lần nào** tính tới 12/08/2026:

- **Đường SIGTERM.** Không kiểm được dưới máy phát triển: Node trên Windows không hỗ trợ
  SIGTERM, `kill` của MSYS giết thẳng tiến trình nên handler không chạy. Trên `ubuntu-latest`
  thì bình thường, nhưng đó là lý lẽ, không phải phép đo.
- **Pha thu đàn ở phút 290 với đàn đang chạy thật.** Đã kiểm với tuổi thọ 6 giây và 0 đàn —
  nó thôi nhận việc rồi thoát mã 0 đúng như thiết kế. Nhưng nhánh "còn đàn dở, chờ rồi thoát"
  chỉ mới đúng trên giấy.

Lượt chạy thật đầu tiên nên soi đúng phút 290 trong log.

## 6. Rủi ro đã biết và tông chủ đã chấp nhận

Ghi ra để người sau không tưởng là sơ suất — đây là một quyết định, đã cân nhắc ngày 12/08/2026:

- Repo **công khai**, nên **nhật ký Actions ai cũng đọc được, vĩnh viễn**. Việc của khôi lỗi là
  nhận cookie game đã giải mã; một stack trace in nhầm header là cookie của một đạo hữu nằm
  trên Internet không rút lại được.
- `WORKER_TOKEN` trong Secrets của repo công khai là chìa toàn cục — nó mở cookie của **mọi**
  thành viên, không phải một người.
- Chạy khôi lỗi cày game 24/7 trên Actions nằm ngoài phạm vi「dựng, kiểm thử, phát hành phần mềm
  của repo」trong chính sách sử dụng của GitHub. Rủi ro không phải hoá đơn mà là tài khoản.

Ai định mở rộng lối này — thêm trạm, tăng ghế — nên đọc lại ba dòng trên trước.

Từ 13/08/2026 ba rủi ro ấy chỉ còn đứng trên các kho **sinh ra**, không còn trên kho gốc: workflow
đã rời khỏi `.github/workflows/` của kho gốc — xem §4.

---

## 7. Nuôi kho cho khỏi bị tắt lịch — ĐÃ LÀM (12/08/2026)

GitHub **tắt lịch `schedule`** của một kho công khai sau **60 ngày không có hoạt động commit**.
Kho khôi lỗi thì gần như không ai đụng vào — nó chỉ chạy — nên cái mốc ấy sẽ tới, và khi tới thì
khôi lỗi im lặng ngừng lên ca mà không báo ai.

### Câu hỏi gác cổng, và câu trả lời

Bản phác trước đặt ra một câu phải hỏi TRƯỚC KHI XÂY: **commit tạo bằng `GITHUB_TOKEN` của chính
workflow có được tính là「repository activity」không?** Nếu CÓ thì mỗi kho tự nuôi mình bằng ba
dòng YAML, và cả hệ thống dưới đây biến mất.

Đã đi tìm ngày 12/08/2026. **Không xây được lối ấy**, vì ba điều:

- **Tài liệu GitHub không trả lời.** Nguyên văn tất cả những gì họ nói: *"In a public repository,
  scheduled workflows are automatically disabled when no repository activity has occurred in 60
  days."* Không định nghĩa「repository activity」, không nhắc `GITHUB_TOKEN` một chữ nào. Điều họ
  nói rõ về `GITHUB_TOKEN` là chuyện KHÁC — commit bằng nó không kích hoạt workflow mới — và suy
  từ câu ấy ra câu này là đúng cái bẫy bản phác đã cảnh báo.
- **Bản cài đặt phổ biến nhất của lối ấy đã bị GitHub GỠ.** `gautamkrishnar/keepalive-workflow` —
  action nuôi kho được dùng nhiều nhất, đúng cơ chế commit rác định kỳ — nay trả về trang
  *"repository has been disabled by GitHub Staff due to a terms of service violation"*. Chính tác
  giả, trong phần bình luận bài viết của mình, đã thừa nhận việc commit tự động **có thể vi phạm
  điều khoản**; và một người dùng báo lại rằng kho của họ bị tắt sau một năm dùng nó.
- **Công cụ còn sống thì đi đường khác.** `PhrozenByte/gh-workflow-immortality` không commit gì
  cả — nó gọi API bật lại workflow, và ghi rõ `GITHUB_TOKEN` **không đủ quyền** cho việc ấy, phải
  dùng PAT.

Vậy nên: đường「kho tự nuôi mình」vừa **không kiểm chứng được**, vừa là đúng cái hình dạng GitHub
đã ra tay một lần. Hệ thống PAT ở dưới được xây, nhưng xây theo hướng **để lại ít dấu chân nhất
có thể** — xem `KEEPALIVE_INTERVAL_DAYS`.

> Điều này KHÔNG mở rộng rủi ro đã ghi ở §6, nhưng nó xác nhận §6 không phải lo xa: GitHub có
> thật sự ra tay với những kho làm việc ngoài phạm vi「dựng, kiểm thử, phát hành」.

### Hình dạng đã làm

| Mảnh | Ở đâu |
|---|---|
| Sổ kho | `app_settings.githubStations` (`src/lib/services/settings.ts`) |
| Luật thuần + hằng số | `src/lib/validation/githubStations.ts` |
| Vòng nuôi | `src/lib/services/githubStations.ts` |
| Cửa admin | `src/app/actions/githubStations.ts` + `src/app/admin/GithubStationPanel.tsx` (tab **Kho GitHub**) |
| Quyền | `github_station.manage` — CHỈ Gia chủ (migration `0026`) |
| Lịch | `/api/cron`, đi nhờ cron `0 3 * * *` đã có — **chỉ chạy ở trạm đang hoạt động**, xem dưới |
| Kiểm chứng | `npm run verify:github-stations` — 11 nhóm ca, `fetch` giả, không cần database |

**Không cần `git`.** `PUT /repos/{owner}/{repo}/contents/{path}` tạo ra một **commit thật**, nên
cả việc này gọn trong một Vercel function — không clone, không thư mục tạm. Đây là chỗ dễ đi vòng
nhất nếu không biết.

**NGÓ mỗi ngày, GHI mỗi ~20 ngày.** Lượt ngó chỉ đọc trạng thái workflow (rẻ, không để lại dấu
vết), lượt ghi mới là thứ đếm với GitHub. Tách hai nhịp ấy giữ được cả hai điều tốt: biết kho
hỏng **ngay trong ngày**, mà chỉ ~18 commit rác một năm thay vì 365. 20 ngày cũng để lại **40
ngày dự phòng** trước mốc 60 — phải trượt liên tiếp hai lượt tới hạn thì lịch mới thật sự tắt.

**Nhánh tự chữa mới là phần đáng tiền.** Nếu lịch ĐÃ bị tắt vì im lặng thì một commit mới **không
tự bật nó lại** — GitHub đòi một lượt bật tường minh. Nên khi thấy `disabled_inactivity`, vòng
nuôi gọi `PUT .../workflows/{file}/enable` rồi ghi mốc ngay, bất kể còn hạn. Thiếu nhánh này thì
hệ thống nuôi được kho khoẻ nhưng bó tay trước đúng cái kho đã ngã.

**Và một điều CỐ Ý KHÔNG LÀM:** kho bị tắt **tay** (`disabled_manually`) thì để nguyên, kể cả khi
Gia chủ bấm「Nuôi ngay」. Đó là quyết định của một con người; bật lại giùm là cãi lại, mà cãi lặng
lẽ. Sổ chỉ hiện đỏ và nói ra. Luật này có hai ca riêng trong script kiểm chứng, và chúng **đếm số
lượt PUT** chứ không chỉ đọc kết quả — "không ghi gì cả" là một hành vi.

### Hai chỗ lệch khỏi bản phác, và vì sao

- **Sổ nằm trong `app_settings`, không phải bảng `github_stations` riêng.** Lý do nặng nhất không
  phải「đỡ một migration」mà là `assertTablesCovered` (`src/lib/mirror/pgSync.ts`): nó **ném** khi
  database đích có một bảng không nằm trong `SYNC_TABLE_ORDER`. Một bảng mới mà quên khai ở đó
  không hỏng lúc migrate, không hỏng lúc chạy — nó hỏng **giữa một lượt chuyển trạm**, tức đúng
  lúc đang có sự cố. Đổi lại, sổ tự đi theo mọi lượt chuyển trạm (điều kiện: mọi trạm chung
  `ENCRYPTION_KEY`), y như sổ gương trạm.
- **Có thêm lượt gọi `enable`** — bản phác chỉ có commit. Xem「nhánh tự chữa」ở trên.

### Chỉ TRẠM ĐANG HOẠT ĐỘNG mới nuôi (13/08/2026)

Cái giá của「sổ đi theo mọi lượt chuyển trạm」lộ ra ngay sau đó, và nó không hiện ra bằng một
dòng đỏ nào. Ba điều đều đúng và đều vô hại khi đứng riêng: mọi trạm mang cùng `vercel.json`
(cùng cron `0 3 * * *`), `newMirrorStation` rải `CRON_SECRET` cho mọi trạm, và `runKeepalive`
chỉ đọc sổ của database nó đang nối. Ghép lại thì sau lượt chuyển trạm đầu tiên, **trạm cũ vẫn
giữ bản sao của sổ và cron của nó vẫn chạy** — hai trạm cùng nuôi một kho, không thấy nhau, vì
`lastCommitAt` nằm ở hai database khác nhau.

Kho vẫn sống; mục tiêu vẫn đạt. Nhưng nó đi ngược đúng thứ `KEEPALIVE_INTERVAL_DAYS` đánh đổi để
có — dấu chân nhỏ nhất có thể. Ca xấu hơn là một trạm đã nghỉ hẳn mà project Vercel vẫn sống: nó
đẩy commit vào kho của người ta mãi mãi, và không dòng sổ nào của trạm đang phục vụ hé ra điều đó.

Phép gác là `reviewKeepaliveDuty` (`validation/githubStations.ts`), so `SITE_ID` với
`activeSiteId` của bảng điều phối — cùng hình dạng với `activeSiteCheck` bên `mirrorSwitch.ts`.
Ba điều đáng nhớ:

- **Chỉ gác việc thứ tư.** Ba việc quét dọn vẫn chạy ở mọi trạm: chúng chỉ đụng dữ liệu của chính
  database ấy. Nuôi kho là việc DUY NHẤT ở `/api/cron` đẩy thay đổi ra ngoài, lên một thứ dùng chung.
- **FAIL-OPEN, và chiều của nó mới là phần khó.** Không đọc được bảng, hay trạm chưa khai
  `SITE_ID` (deploy cũ, máy phát triển) → **vẫn nuôi**. Thà thừa một commit còn hơn để cả hệ
  thống lặng lẽ thôi nuôi vì một lượt đọc bucket hụt — mà im lặng đúng là hình dạng hỏng cả §7
  sinh ra để chống.
- **Không gác tay người.** Nút「Nuôi ngay」và「Chạy vòng nuôi」không đi qua phép gác này: đó là
  một con người bấm, cùng lẽ với luật `disabled_manually`.

Hai ca đột biến đã thử, và cả hai làm script kiểm chứng đỏ đúng chỗ: gỡ hàng rào trạm nghỉ →
*„Trạm nghỉ mà vẫn nuôi thì hai trạm cùng đẩy commit lên một kho"*; lật fail-open thành
fail-closed → *„Không đọc được bảng điều phối thì vẫn phải nuôi"*.

### PAT — cần gì và nguy hiểm ra sao

Scope **`repo` + `workflow`** (classic), hoặc **Contents: read/write + Actions: read/write**
(fine-grained). Tệp mốc nằm trong `.github/` nhưng NGOÀI `.github/workflows/` nên tự nó không đòi
`workflow`; nhưng cùng cái PAT ấy còn được `scripts/newGithubKhoiloi.mjs` dùng để đẩy chính
workflow lên, và **thiếu `workflow` là lỗi hay gặp nhất của cả lối này** — nó chỉ lộ ra ở đúng
bước cuối cùng.

PAT nguy hiểm hơn cookie game một bậc: cookie mở một tài khoản game, PAT thì **push được mã** vào
kho đang chạy khôi lỗi. Nên nó lưu bằng `secretBox` (`ENCRYPTION_KEY`) y như cookie, và quyền quản
là **mã riêng chỉ Gia chủ** — không dùng lại `admin.panel`, cũng không dùng lại `site.switch`.

**Đọc lại được PAT đã ghi (13/08/2026).** GitHub không cho xem lại token đã phát, nên sổ này là bản
duy nhất còn giữ nó — mà cùng cái PAT ấy còn phải dán tay vào Actions secret của kho, vào một lượt
`github:remove`, hay vào lượt dựng kho thứ hai của cùng tài khoản. Nút **「Hiện PAT để chép」** trong
form Sửa kho gọi `revealGithubStationPatAction`: gác đúng `github_station.manage`, mở đúng **một**
slug mỗi lượt, và chỉ chạy khi có người bấm. Thứ KHÔNG đổi là `viewOf` — `StationView` vẫn không
mang phong bì, nên mở tab admin vẫn không kéo PAT nào xuống trình duyệt. Bản rõ hiện ra **ngoài**
ô nhập: ô ấy để trống mới đúng nghĩa「giữ PAT cũ」, và đổ token vào đó nghĩa là lượt bấm「Cập nhật
kho」kế tiếp sẽ đẩy ngược chính bí mật vừa xem lên máy chủ để mã hoá lại mà chẳng được gì.

### Thêm một kho: bấm đúp `new-github-khoiloi.bat`

Nó hỏi đúng MỘT thứ — PAT của tài khoản GitHub sẽ giữ kho — rồi làm trọn: suy tên tài khoản từ
chính token, đặt tên kho ngẫu nhiên và `WORKER_ID` theo khuôn `khoiloi-tro-<mốc thời gian>`,
dựng kho (gọi lại `newGithubKhoiloi.mjs`), dán secret, bấm chạy lượt đầu, **ghi kho vào sổ ở trạm
đang hoạt động**, rồi ngó một lượt để chứng minh PAT push được. Xem trước mà chưa tạo gì:
`npm run github:new -- --dry-run --owner <tài-khoản>`.

#### Luật đặt tên: `scripts/khoiloiNaming.mjs`

Kho dựng ra là CÔNG KHAI, nên mọi cái tên script tự đặt đều bị cấm mang bảy từ: `auto`, `hh3d`,
`hoathinh3d`, `worker`, `action`, `workflow`, `github`. Ba từ đầu buộc kho vào đúng cái trò nó
đang cày — một lượt gõ「hh3d」vào ô tìm kiếm của GitHub là ra sạch cả đàn. Bốn từ sau dựng chân
dung「kho sinh ra để xài quỹ phút Actions」, đúng thứ đã khiến GitHub gỡ `gautamkrishnar/keepalive-workflow`.

Từ 13/08/2026: kho là `linh-su-<mốc>-<4 hex>`, `WORKER_ID` là `khoiloi-tro-<mốc>` (`tro` = ở trọ,
tức sống nhờ máy người ta — phân biệt với `tong-mon-khoiloi` trên VM tông môn tự nuôi). Tên gói,
mô tả kho, README và tác giả commit của kho sinh ra cũng đã dọn theo.

Luật này chỉ áp cho tên **script SINH RA**, không áp cho tên **người ta KHAI BÁO** trên form Kho
GitHub — những kho dựng trước 13/08/2026 vẫn mang tên `auto-hh3d-linh-su-…` và vẫn phải ghi sổ
được. Vì thế phép kiểm nằm ở `khoiloiNaming.mjs` chứ không nằm trong `reviewStationIdentity`.

Hai thứ luật này **không** với tới, vì chúng không phải tên do script đặt: đường dẫn
`scripts/worker.mjs` (chép nguyên từ kho web, dùng chung với VM) và `WEB_URL` nướng vào workflow —
địa chỉ trạm thật, hiện đang là `https://auto-hh3d-2.vercel.app`. Muốn dọn nốt thì phải đổi tên
tệp dùng chung và đổi tên miền trạm, hai việc lớn hơn hẳn lượt này.

Vẫn cần `gh` (chỉ vì lượt đặt secret — sealed-box, xem đầu `newGithubKhoiloi.mjs`), nhưng **không
cần `gh auth login`**: PAT đi qua biến `GH_TOKEN` của riêng lượt chạy ấy. Cài `gh`:
`winget install --id GitHub.cli`.

Ba phép kiểm chạy TRƯỚC khi tạo bất cứ thứ gì, vì một kho công khai mồ côi thì phải vào GitHub
xoá tay: PAT còn sống và đủ scope, sổ chưa đầy (`GITHUB_STATION_LIMIT`), và `WORKER_ID` chưa ai
mang — hỏi thẳng bảng `workers`, không chỉ tin vào mốc giây trong tên.

### Vận hành

Tab **Kho GitHub** trong trang Tông Môn. Mỗi dòng hiện đếm ngược tới mốc tắt lịch — xanh là khoẻ,
vàng là đã trượt một lượt ghi, đỏ là còn dưới một chu kỳ. Ba nút: **Nuôi ngay** (ép một kho),
**Chạy vòng nuôi** (diễn tập đúng thứ cron chạy), **Sửa/Xoá**.

Lượt **Ghi vào sổ** tự ngó kho ngay sau khi lưu, nên một PAT dán nhầm chết trước mặt người vừa
dán chứ không phải trong một lượt cron lúc ba giờ sáng. Với kho mới, lượt ấy ghi luôn một commit
thật — tức chứng minh trọn đường「PAT này push được mã vào kho này」.

Muốn soi từ dòng lệnh thì gọi thẳng cron; hồi đáp mang câu chữ của từng kho:

```
curl -H "Authorization: Bearer $CRON_SECRET" https://<trạm>/api/cron
```

### Chưa có bằng chứng

Toàn bộ đường đi được kiểm bằng `fetch` giả (10 nhóm ca, kể cả hai ca đột biến đã thử: gỡ hàng
rào `disabled_manually` và lệch biên một ngày — cả hai đều làm script đỏ đúng chỗ). Nhưng **chưa
lượt nào chạm GitHub thật** tính tới 12/08/2026. Lượt「Ghi vào sổ」đầu tiên là phép thử thật: soi
xem nó có báo `Đã ghi mốc nuôi kho (<sha>)` hay không, rồi mở kho trên GitHub xem commit ấy có
mặt.

---

## 8. Xoá một kho: bấm đúp `remove-github-khoiloi.bat` (13/08/2026)

Nửa đối xứng của §7, và nó hỏi đúng MỘT thứ y như lượt dựng: **PAT của tài khoản giữ kho**. Tài
khoản suy từ chính token, kho khôi lỗi trên đó thì script tự tìm.

```
npm run github:remove -- --dry-run            soi kế hoạch, không xoá gì
npm run github:remove -- --repo <tên kho>     chọn khi tài khoản có nhiều kho
npm run github:remove -- --force              xoá kể cả khi khôi lỗi ấy đang giữ đàn
```

**Vì sao đáng có một công cụ, thay vì một cú bấm「Delete repository」:** một kho khôi lỗi để lại
dấu chân ở **ba** nơi, và hai nơi trong đó không nằm trên GitHub.

| Dấu chân | Bỏ lại thì sao |
|---|---|
| Kho trên GitHub | thứ duy nhất người ta nhớ |
| Dòng trong sổ Kho GitHub (trạm đang hoạt động) | vòng nuôi gõ vào một kho đã chết mỗi ngày, tab đỏ mãi; và mỗi dòng ma chiếm một chỗ trong `GITHUB_STATION_LIMIT` |
| Dòng trong bảng `workers` | `github:new` TỪ CHỐI dựng lại một khôi lỗi trùng id — phép kiểm bên ấy hỏi thẳng bảng này, và một cái xác trả lời y như một người đang trực |

### PAT cần `delete_repo`, và đó là scope §7 KHÔNG đòi

Lượt dựng cần `repo` + `workflow`; lượt xoá cần thêm **`delete_repo`** (classic) hoặc
**Administration: read/write** (fine-grained). Nghĩa là **cái PAT đã dựng kho gần như chắc chắn
không xoá được nó**. Phép soát scope vì thế đứng ngay đầu, trước cả lượt đọc sổ — một lượt chạy
thiếu quyền hỏng trong hai giây thay vì hỏng sau khi đã in cả kế hoạch.

### Ba luật an toàn

1. **Nhận kho bằng BẰNG CHỨNG, không bằng tên.** Tên là thứ ai cũng đặt được. Ba loại bằng chứng,
   mỗi loại đứng một mình đã đủ: có trong **sổ**; có tệp **workflow** khôi lỗi; hoặc là một kho
   **rỗng** mang tiền tố quen (đúng thứ `gh repo create --push` chết giữa chừng để lại). Không có
   bằng chứng nào thì **`--force` cũng không mở được hàng rào này** — một cờ mang hai nghĩa là
   cách người ta xoá nhầm mà vẫn tin mình đang làm đúng việc mình định làm. Tiền tố tên chỉ để
   THU HẸP danh sách phải hỏi API, và nó hỏi cả tiền tố CŨ (`ALL_REPO_NAME_PREFIXES`) — bỏ tiền tố
   cũ đi là làm kho dựng trước lượt đổi tên tàng hình trước chính công cụ dọn của mình.
2. **Không xoá khi khôi lỗi ấy đang giữ đàn.** Xoá kho là giết runner tức khắc; `reapStaleJobs`
   kết liễu đàn ấy sau 3 phút bằng dòng「Khôi lỗi mất liên lạc」. Người mất một vòng cày là một đạo
   hữu nào đó, không phải người đang gõ lệnh — nên cái giá được NÓI RA trước. `--force` qua được,
   và đó là đúng vai của nó. Không suy ra được `WORKER_ID` thì cũng dừng: không biết id nghĩa là
   không hỏi được database, tức xoá mù. (Kho **rỗng** miễn hàng rào này — nó chưa từng chạy.)
3. **Xoá kho TRƯỚC, dọn sổ SAU.** Ngược lại là ca hỏng tệ nhất: gỡ sổ xong mà lượt xoá kho hụt thì
   kho vẫn chạy, vẫn giành đàn, vẫn cầm `WORKER_TOKEN` — mà không dòng nào ở đâu biết nó tồn tại.
   Một dòng sổ trỏ vào kho đã chết thì chỉ ồn, chữa bằng một cú bấm. Cùng hình dạng với LUẬT 4 của
   `mirror:remove`. Lượt xoá còn nghiệm thu bằng một `GET` trả 404 — `204` mới chỉ là lời hứa.

Dòng sổ được **lưu ra tệp trong `%TEMP%`** trước khi gỡ; trong đó có phong bì `pat` đã mã hoá, và
với một kho lỡ xoá nhầm thì đó là bản duy nhất còn lại của cái chìa ấy.

Kho đã bị xoá tay trên GitHub mà dòng sổ còn nằm đó cũng chạy được — bằng chứng `sổ` vẫn đủ, và
lượt ấy chỉ còn phần dọn sổ.

### Kiểm chứng

`npm run verify:github-removal` — 50 phép kiểm, thuần, không mạng không database. Hai ca **đột
biến đã thử**, cả hai làm script đỏ đúng chỗ: cho `--force` mở hàng rào「không bằng chứng」→
*„không bằng chứng + --force → VẪN từ chối"*; lệch biên `heldJobs > 0` thành `> 1` →
*„đúng MỘT đàn cũng đủ để chặn"* (ca THƯỜNG NHẤT, vì khôi lỗi GitHub có 2 ghế).

Phép moi `WORKER_ID` đọc **chính** bản mẫu `deploy/github/linh-su.yml` của repo này, và cố ý không so
với một giá trị cụ thể — id đổi được, còn thứ phải đúng mãi là「phép moi chạy được trên tệp THẬT」.

### Chưa có bằng chứng

Đã đo thật: ba ngả từ chối sớm (thiếu PAT · PAT lẫn khoảng trắng · PAT rác → GitHub 401), tất cả
thoát **mã 1** sau một lượt `fetch` — tức kỷ luật `process.exitCode` còn nguyên, không dính cú
`Assertion failed` mã 127.

**Chưa lượt nào xoá một kho thật.** Mọi thứ sau phép soát scope — soi ứng viên, hỏi đàn đang chạy,
`DELETE /repos`, gỡ sổ, gỡ dòng điểm danh — mới chỉ đúng trên giấy và trong phép kiểm thuần. Lượt
dọn kho rác đầu tiên là phép thử thật; chạy `--dry-run` trước, và đọc kỹ bảng「Sẽ XOÁ」.

---

## 9. Phát hành bản mới cho MỌI kho: `deploy-github-khoiloi.bat` (14/08/2026)

```
npm run github:deploy                       mọi kho đang bật trong sổ
npm run github:deploy -- --dry-run          soi kế hoạch, không đẩy gì
npm run github:deploy -- --repo <tên kho>   đúng một kho (kể cả dòng đang tắt)
```

### Vì sao mãi tới nay mới có, và vì sao thiếu nó là một cái bẫy

**Kho khôi lỗi là một bản ĐÔNG LẠNH.** Workflow `checkout` chính kho ấy rồi chạy
`node scripts/worker.mjs` từ đó — nên mã nằm trong kho là mã sẽ chạy, mãi mãi. Trước bản này chỉ
có `github:new` (dựng) và `github:remove` (xoá), tức **đường sửa duy nhất là xoá đi dựng lại**.

Và nó không hiện ra ở đâu cả. `package.json` của kho sinh ra luôn khai `version: "1.0.0"`, nên
`readOwnVersion` khai đúng chuỗi ấy vào sổ điểm danh: bảy kho dựng ở bảy thời điểm khác nhau đều
hiện `1.0.0` trên dashboard — nhìn thì đều nhau, thực thì mỗi cái một đời mã. Đo 14/08/2026, ngay
lượt chạy khô đầu tiên: VM khai `0.83.1`, `github-khoiloi` khai `0.82.6`, và **5 trong 6 kho trọ
đang mang `scripts/worker.mjs` cũ** — trong đó bốn kho còn mang cả workflow trước lượt hạ ghế về 2.

> Ghi lại một câu SAI đã sống khá lâu, để phiên sau đọc phải bản cũ thì biết: *"khôi lỗi GitHub tự
> cập nhật, trễ ~4 giờ"*. Không. Cái tự lặp lại mỗi 4 giờ là **lượt chạy**, không phải **mã**.

### Hình dạng

| Mảnh | Ở đâu |
|---|---|
| Gói (danh sách tệp + nội dung) | `scripts/khoiloiPayload.mjs` — **dùng chung với `github:new`** |
| Luật thuần (kế hoạch cây, danh tính) | `scripts/githubKhoiloi.mts` |
| Lượt phát hành | `scripts/deployGithubKhoiloi.mts` |
| Kiểm chứng | `npm run verify:github-deploy` — 35 phép kiểm, thuần |

**Một nguồn sự thật cho「gói gồm những tệp nào」.** Lượt DỰNG và lượt PHÁT HÀNH đọc chung
`khoiloiPayload.mjs`; hai bản chép của cùng một danh sách là hẹn ngày một kho vừa phát hành khác
một kho vừa dựng, mà cả hai lượt đều báo xanh.

**Bytes lấy từ blob `HEAD`, không từ cây làm việc.** Hai lý do, và cả hai đều đã cắn:
`core.autocrlf` trên Windows làm cây làm việc mang CRLF trong khi blob mang LF — lượt dựng cũ có
`git add` dọn hộ, còn lượt phát hành đẩy thẳng qua API thì không, nên chép từ cây làm việc là
**mọi tệp đều「đã đổi」ở mọi lượt**. Và kho này thường có vài phiên cùng làm, nên cây làm việc có
thể đang mang một nửa tính năng chưa xong — đẩy thứ ấy lên kho CÔNG KHAI của người khác là chuyện
không rút lại được. Việc dở chưa commit thì script **nói ra** rồi vẫn phát hành đúng HEAD.

**Không cần `git`, không cần `gh`, không clone.** Đẩy bằng Git Data API: tải blob → dựng cây →
MỘT commit → nhích `refs/heads/<nhánh>` → **đọc lại ref để nghiệm thu**. Chìa duy nhất là chính
PAT đã nằm trong sổ. Nhánh đọc từ `default_branch` chứ không ghim `main`.

**Chỉ đẩy tệp đã đổi.** SHA blob tính dưới máy (`gitBlobSha`, băm đúng lối git:
`sha1("blob <len>\0" + nội dung)`), mà cây kho trả sha sẵn — nên phép so không tốn một byte tải
về, và kho đã đúng bản thì **không commit nào được tạo ra**. Đây không phải chuyện thẩm mỹ: mỗi
commit là một dấu chân với GitHub, thứ mà cả §7 sinh ra để đếm dè sẻn.

### Ba hàng rào

1. **Không biết `WORKER_ID` thì KHÔNG phát hành kho ấy.** Sổ trước, tệp workflow trong kho sau, và
   không có nước thứ ba — bản mẫu mang sẵn `WORKER_ID: github-khoiloi`, nên một nhánh「thôi dùng
   mặc định」là đẩy một kho về trùng id với khôi lỗi khác đang trực. Sổ và kho khai lệch nhau thì
   script ghi theo SỔ và **nói ra** trên bảng tổng kết.
2. **Ranh giới XOÁ hẹp.** Chỉ tệp dưới `scripts/` và `src/` mới bị xoá khi gói không còn chúng.
   `.github/heartbeat.txt` là của vòng nuôi kho (§7) — xoá nó là phá đúng thứ giữ cho lịch khỏi bị
   tắt, và triệu chứng hiện ra ba tuần sau. Có ca riêng trong script kiểm chứng.
3. **Cây bị GitHub cắt bớt (`truncated`) thì DỪNG.** Cây cắt dở làm tệp không thấy trông y như tệp
   chưa có, nên phép XOÁ đọc thiếu. Gói có 20 tệp nên gần như không thể xảy ra — mà "gần như" thì
   vẫn phải có nhánh, vì hậu quả là xoá nhầm.

### Có hiệu lực khi nào

**Tối đa ~4 giờ.** Lượt chạy Actions đang chạy vẫn dùng mã nó đã `checkout` lúc bắt đầu; bản mới
lên ở lượt kế. Script **cố ý không huỷ lượt đang chạy**: huỷ là cắt ngang đàn đang cày, nhịp tim
tắt, `reapStaleJobs` kết liễu chúng thành `failed` sau 3 phút — mất trọn một vòng của một đạo hữu
nào đó, không phải của người đang gõ lệnh. Cùng luật với hàng rào 2 của §8.

### Lỗi hay gặp nhất

**PAT thiếu scope `workflow`** → GitHub trả **422** ở đúng bước đẩy, và chỉ khi lượt ấy có đụng
`.github/workflows/`. Một lượt chỉ đổi `scripts/worker.mjs` thì không cần scope ấy — nên cùng một
PAT có thể phát hành được hôm nay và hỏng ở lượt sau, khi bản mẫu workflow đổi. Dán lại PAT đủ
scope ở tab Kho GitHub → Sửa kho.
