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

## 7. Nuôi kho cho khỏi bị tắt lịch — thiết kế, CHƯA làm

GitHub **tắt lịch `schedule`** của một kho sau **60 ngày không có hoạt động commit**. Kho khôi
lỗi thì gần như không ai đụng vào — nó chỉ chạy — nên cái mốc ấy sẽ tới, và khi tới thì khôi lỗi
im lặng ngừng lên ca mà không báo ai. Chỗ này ghi lại thiết kế đã bàn ngày 12/08/2026 để phiên
sau không phải suy lại từ đầu.

### Hỏi câu này TRƯỚC khi xây bất cứ thứ gì

**Commit tạo bằng `GITHUB_TOKEN` của chính workflow có được tính là「repository activity」cho luật
60 ngày không?**

Nếu CÓ, thì mỗi kho tự nuôi mình bằng một bước cuối trong workflow — và toàn bộ phần dưới đây
biến mất: không bảng, không PAT, không tab admin, không job định kỳ. Ba dòng YAML thay cho một
hệ thống.

Chưa ai kiểm. GitHub nói rõ commit bằng `GITHUB_TOKEN` **không kích hoạt workflow mới**, nhưng
không nói nó có tính là hoạt động kho hay không — hai chuyện khác nhau, và đừng suy cái này ra
cái kia. Đây là câu hỏi rẻ nhất và đáng hỏi nhất của cả tính năng: trả lời sai theo hướng bi
quan là xây cả một hệ thống quản lý PAT cho việc mà một bước YAML làm xong.

### Nếu câu trả lời là KHÔNG

**Không cần `git push`.** `PUT /repos/{owner}/{repo}/contents/{path}` **tạo ra một commit thật** —
không cần binary `git`, không clone, không thư mục tạm. Một lời gọi HTTPS cập nhật
`.github/heartbeat.txt` (nội dung là mốc thời gian, kèm `sha` của bản cũ) là đủ. Toàn bộ bài toán
「làm sao push từ một serverless function」tan biến — đây là chỗ dễ đi vòng nhất nếu không biết.

**Không cần lịch mới.** `vercel.json` đã có cron `0 3 * * *`, và gói Hobby cho đúng một lần mỗi
ngày — vừa khít nhu cầu. Móc vào `/api/cron` đang có, đừng dựng đường thứ hai.

**PAT nguy hiểm hơn cookie game.** Nó có quyền push mã. Lưu bằng `secretBox` + `ENCRYPTION_KEY`
đúng lối phong bì cookie (đã có `decryptSecret`), và quyền quản phải là **mã riêng, chỉ Gia chủ** —
đừng dùng lại `admin.panel`: được xem môn đồ không đồng nghĩa được cầm chìa push mã vào bốn tài
khoản.

Hình dạng bảng: `github_stations(owner, repo, worker_id, pat_envelope, enabled, last_push_at,
last_error)`. Job duyệt từng dòng, **một kho hỏng không chặn kho còn lại**, và `last_error` hiện
thẳng trên tab admin — cùng lối với `deployAllStations.mts`.
