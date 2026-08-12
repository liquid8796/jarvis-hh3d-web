# Khôi lỗi tông môn thứ hai — chạy trên GitHub Actions

Từ 12/08/2026 tông môn có **hai** khôi lỗi hạng tông môn, không phải một:

| | `tong-mon-khoiloi` | `github-khoiloi` |
|---|---|---|
| Ở đâu | VM Oracle Always Free, 4 vCPU/24GB | Runner của GitHub Actions, 4 nhân/16GB |
| Sống | 24/7, liền mạch hàng tuần | Từng lượt ~4,8 giờ, lịch 4 giờ/lần nối nhau |
| Ghế | 5 đàn × 4 tab | 2 đàn × 3 tab |
| Tài liệu | [oracle/README.md](oracle/README.md) | tệp này |
| Vai trò | gánh chính | cộng thêm |

Cả hai cầm `WORKER_TOKEN` toàn cục, nên **cùng hạng** dưới mắt hệ thống. VM vẫn là chỗ gánh
chính; bản trên Actions là phần cộng thêm, mất nó thì tông môn chậm lại chứ không đứng.

---

## 1. Điều dễ hiểu sai nhất: KHÔNG có tầng phân công nào

Đừng đi tìm nó, và **đừng dựng nó**. Việc chia job giữa hai khôi lỗi do Postgres quyết, bằng
chính câu claim đã có từ trước:

- `claimNextJob` là **MỘT** câu UPDATE nguyên tử — hai khôi lỗi giành nhau thì nhận hai dòng
  khác nhau, hoặc một dòng và một null. Không ai chạy đôi.
- Index `jobs_one_active_per_account` chặn hai đàn sống cùng một tài khoản, ở tầng database.

Kết quả là tự cân bằng theo tải THẬT: máy nào rảnh trước thì nhặt trước. Một bảng phân công
viết tay sẽ vừa thừa, vừa là một luật thứ hai sống lệch luật thật.

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

## 4. Cài đặt — một bước

Settings → Secrets and variables → Actions → New repository secret:

```
WORKER_TOKEN    (đúng giá trị đang đặt trên Vercel)
```

Lấy giá trị: `vercel env pull .env --environment=production --yes` rồi đọc dòng `WORKER_TOKEN`.
**Không** dùng `npm run env:pull` — lệnh ấy kéo môi trường *development*, nơi `WORKER_TOKEN`,
`AUTH_SECRET` và `DATABASE_URL` đều không tồn tại.

Chạy thử: Actions → **Khôi lỗi tông môn (GitHub)** → Run workflow.

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
| Lịch | `/api/cron`, đi nhờ cron `0 3 * * *` đã có |
| Kiểm chứng | `npm run verify:github-stations` — 10 nhóm ca, `fetch` giả, không cần database |

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

### PAT — cần gì và nguy hiểm ra sao

Scope **`repo` + `workflow`** (classic), hoặc **Contents: read/write + Actions: read/write**
(fine-grained). Tệp mốc nằm trong `.github/` nhưng NGOÀI `.github/workflows/` nên tự nó không đòi
`workflow`; nhưng cùng cái PAT ấy còn được `scripts/newGithubKhoiloi.mjs` dùng để đẩy chính
workflow lên, và **thiếu `workflow` là lỗi hay gặp nhất của cả lối này** — nó chỉ lộ ra ở đúng
bước cuối cùng.

PAT nguy hiểm hơn cookie game một bậc: cookie mở một tài khoản game, PAT thì **push được mã** vào
kho đang chạy khôi lỗi. Nên nó lưu bằng `secretBox` (`ENCRYPTION_KEY`) y như cookie, và quyền quản
là **mã riêng chỉ Gia chủ** — không dùng lại `admin.panel`, cũng không dùng lại `site.switch`.

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
