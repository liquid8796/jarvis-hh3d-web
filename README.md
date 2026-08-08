# Auto HH3D — Web

Control plane tu tiên cho automation hoathinh3d: đăng ký môn đồ → tông môn duyệt → khai đàn,
rồi automation **chạy trên server** dù đạo hữu đã tắt trình duyệt. Bước "tông môn duyệt" là
một công tắc ở tab Môn Đồ của trang Tông Môn — tắt nó thì người mới bái sư xong vào thẳng
Linh Đài; mặc định là BẬT.

**Site đổi tên miền thì sửa ở tab Bảo Trì**, không phải sửa mã nguồn: ô「Tên Miền Game」lưu
vào `app_settings`, và /api/worker gửi kèm nó theo từng lần phát việc — mọi khôi lỗi, kể cả
trên máy nhà đạo hữu, dùng tên miền mới ngay ở vòng chạy kế mà không phải cài lại. Đổi xong
thì mọi tài khoản PHẢI dán lại cookie: cookie gắn theo tên miền nên không đi theo được.

Đây là bản web của [JarvisHH3D](../JarvisHH3D) (bản desktop). Hai sản phẩm chia nhau cùng
một mô hình nhiệm vụ — Mê Cung, Luyện Đan Đường, cùng những tuỳ chọn ấy.

> **Người dùng cuối đọc [HUONG-DAN.md](HUONG-DAN.md)** — hướng dẫn cày auto, viết cho
> người mới, không nhắc gì tới hạ tầng. File này thì dành cho người vận hành.

---

## 1. Kiến trúc — và vì sao lại thế

### Nút Start bấm ở web, browser chạy ở đâu?

Web **không bao giờ** tự mở browser trong một function — function của Vercel sống theo
request và bị cắt sau vài phút. Bấm Khai Đàn chỉ ghi một dòng `automation_jobs` trạng thái
`queued`; một *khôi lỗi* nhận việc rồi kể lại qua HTTPS. Vì ý định của người dùng nằm trong
**database** chứ không nằm trong tab trình duyệt, đóng tab chẳng ảnh hưởng gì. Tắt máy chỉ
làm gián đoạn nếu chính máy ấy đang nuôi khôi lỗi; khôi lỗi tông môn ở máy khác thì vẫn chạy.

Một lần Khai Đàn tạo **một ý định sống dai**, không phải một vé chạy đúng một vòng. Hết mỗi
vòng, server đọc cooldown sớm nhất, đặt `next_run_at`, đóng browser trong lúc nghỉ rồi tự đưa
cùng job trở lại hàng chờ. Chỉ Thu Đàn mới biến nó thành trạng thái kết thúc. Worker đời cũ
không gửi được cooldown vẫn tương thích: server dùng 5 phút cho vòng thường, 30 phút cho vòng
chỉ có lỗi; worker mới gửi đồng hồ thật để thức dậy đúng lúc hơn.

Mọi khôi lỗi đều là **một tiến trình `worker.mjs` sống dai** — khác nhau ở *ai nuôi nó* và
*chìa nó cầm*:

```
                      ┌──────────────── Vercel ────────────────┐
                      │  Next.js control plane                 │
   Khai Đàn ─────────►│  • đăng ký / duyệt / cấu hình          │
                      │  • ghi job vào DB, phát linh phù       │
                      │  • sổ điểm danh khôi lỗi (bảng workers)│
                      └───┬────────────────────────────┬───────┘
                          │ WORKER_TOKEN               │ linh phù (per-user)
              ┌───────────▼──────────┐     ┌───────────▼─────────────┐
              │ KHÔI LỖI TÔNG MÔN    │     │ KHÔI LỖI TÚC TRỰC       │
              │ VM Oracle Always Free│     │ máy của từng đạo hữu    │
              │ deploy/oracle/       │     │ cài 1 lệnh từ mục       │
              │ → job của MỌI người  │     │ Khôi Lỗi trên dashboard │
              └──────────┬───────────┘     │ → CHỈ job của chủ mình  │
                         │                 └───────────┬─────────────┘
                         └──────► Neon Postgres ◄──────┘
```

- **Khôi lỗi tông môn** — worker do người vận hành nuôi trên một VM Oracle Cloud Always Free
  (xem [deploy/oracle/README.md](deploy/oracle/README.md)), cầm `WORKER_TOKEN` toàn cục,
  nhận job của mọi thành viên. Một VM chạy liên tục phục vụ được cả Mê Cung (phiên browser
  35 phút không đứt) lẫn Luyện Đan Đường — thứ mà Vercel Sandbox phù du (đã bỏ từ v0.11)
  không bao giờ làm nổi trên gói Hobby không có cron dày.
- **Khôi lỗi túc trực** — worker trên máy của chính đạo hữu, cài bằng MỘT lệnh phát ở mục
  Khôi Lỗi trên dashboard. Nó xác thực bằng **linh phù** riêng (token per-user, database chỉ
  giữ SHA-256) nên chỉ nhận và chỉ đụng được job của chủ mình — phát token toàn cục cho
  người dùng là trao quyền đọc cookie game của cả tông môn, nên điều đó không bao giờ xảy ra.
- **Sổ điểm danh** — mỗi lần worker hỏi việc (5 giây/lần) là một lần điểm danh vào bảng
  `workers`. Dashboard nhờ vậy nói thật *ngay lúc khai đàn* là có khôi lỗi trực hay không,
  thay vì để job chờ sáu phút rồi chết câm.

Hai worker cùng đủ điều kiện tranh một job thì Postgres phân xử bằng một câu UPDATE nguyên
tử — không bao giờ có hai khôi lỗi ôm cùng một lượt.

> ### Ghi chú về gói Hobby của Vercel
>
> Gói Hobby **chỉ cho cron một lần mỗi ngày**; `vercel --prod` từ chối thẳng biểu thức
> `* * * * *`:
>
> ```
> Error: Hobby accounts are limited to daily cron jobs.
> ```
>
> Đây chính là lý do kiến trúc worker-sống-dai thắng: worker tự hỏi việc mỗi 5 giây, không
> cần ai gõ cửa đánh thức. Cron chỉ còn là **lưới an toàn vệ sinh** — dọn job đang chạy mất
> nhịp tim, quét tin đàm đạo quá hạn — và những việc đó đã chạy tiện-đường mỗi lần có
> người mở dashboard rồi. `vercel.json` để cron ở `0 3 * * *` cho những ngày không ai mở.
> (Chính giới hạn cron này là một nửa lý do Vercel Sandbox bị bỏ ở v0.11; nửa kia là một
> microVM phù du không bao giờ ôm nổi phiên Mê Cung 35 phút.)

### Lưu config người dùng bằng gì?

**JSONB trong chính Postgres đó** (bảng `user_configs`), không dùng store thứ hai. Lý do,
theo thứ tự quan trọng:

- Hình thù config **thay đổi liên tục** — bản desktop đã đi tới quest-profile schema 44. Cột
  quan hệ sẽ thành một chuỗi migration bất tận; document thì co giãn tự nhiên.
- JSONB **vẫn truy vấn được** bằng SQL khi admin cần hỏi ("ai đang bật Mê Cung?") — thứ mà
  một blob store không cho.
- Một database = một chuỗi kết nối, một bản backup, một thứ phải vận hành.

Đã cân nhắc và loại: **Edge Config** (dành cho cờ toàn cục hiếm đổi, không phải dữ liệu
per-user ghi từ form), **Blob** (không truy vấn được), **KV/Redis** (thêm một store để đồng
bộ, đổi lấy tốc độ mà bài toán này không cần).

**Riêng tin đàm đạo thì ngược lại, và có lý do**: chúng nằm ở **MongoDB** (`chat_messages`,
`chat_typing`) chứ không ở Postgres — dòng chảy tần suất cao, tự hết hạn theo ngày, không
JOIN với ai, nên nhét chung là bắt bản backup của danh tính gánh cả nghìn câu "hôm nay cày
chưa". Từ 02/08 tới 08/08/2026 kho ấy là Upstash Redis; xem [CHANGELOG](CHANGELOG.md) mục
0.40.0 để biết vì sao đổi sang Mongo. Cách dựng kho: [deploy/mongodb.md](deploy/mongodb.md).

**Còn BYTES của file đính kèm thì không nằm ở database nào cả** — chúng ở **OCI Object
Storage** (bucket `jarvis-media`), và Mongo chỉ giữ URL. Kho media là thứ duy nhất trong hệ
thống có nhu cầu phục vụ tải xuống công khai với dung lượng lớn, tức đúng thứ mà cả Postgres
lẫn Mongo đều làm dở. Chọn OCI vì tông môn **đã** có tài khoản ấy để nuôi khôi lỗi, nên gộp về
một nhà bớt được một nhà cung cấp phải canh hạn mức. Từ 02/08 tới 08/08/2026 kho ấy là Vercel
Blob; xem mục 0.41.0 và [deploy/oracle/README.md](deploy/oracle/README.md).

Điểm tinh tế: config được **validate hai chiều** bằng Zod — cả lúc ghi lẫn lúc đọc. Một
document viết bởi bản deploy cũ vẫn trở về đúng hình thù hôm nay với default được điền đủ.
Đó là bản JSONB của một migration.

### Cấu trúc mã nguồn

Phân tầng nghiêm ngặt, mỗi tầng chỉ nói chuyện với tầng ngay dưới:

```
src/
  app/            # Route + UI. Server Components đọc, Server Actions ghi.
    actions/      #   Ranh giới ghi — mọi action mở đầu bằng một guard.
    api/          #   Feed/SSE cho client, /api/worker cho khôi lỗi.
  components/     # UI dùng chung, không biết gì về database.
  lib/
    auth/         # Phiên đăng nhập, guard phân quyền, cửa vào của worker.
    db/           # Schema Drizzle + client. Nơi DUY NHẤT biết hình thù bảng.
    realtime/     # Kênh LISTEN/NOTIFY + contract SSE của Linh Đài.
    services/     # Quy tắc nghiệp vụ. Nơi DUY NHẤT viết truy vấn.
    quest-engine/ # Bộ thông dịch nhiệm vụ — JS thuần, không biết gì về Next hay database.
```

#### Trạng thái Linh Đài đi trực tiếp như thế nào

Job, log và sổ khôi lỗi vẫn lấy Postgres làm sự thật duy nhất. Migration `0007` chỉ gắn thêm
“chuông cửa”: transaction nào thay đổi dữ liệu nhìn thấy được sẽ `NOTIFY` scope của đúng user.
Route `/api/dashboard/stream` giữ một session `LISTEN` rồi đẩy snapshot qua SSE; nó không poll
database liên tục. Browser giữ cursor bằng event id, tự reconnect/tiếp tục từ dòng cuối và có
feed một-lần dự phòng nếu stream chập chờn. Vì đây là luồng server → browser một chiều nên SSE
đúng hình hơn WebSocket và không cần thêm một dịch vụ realtime thứ ba.

`LISTEN` phải đi qua kết nối unpooled nhưng vẫn đúng database của `DATABASE_URL`. Với Neon trên
Vercel, code dùng `PGHOST_UNPOOLED` và giữ nguyên path/credentials; hạ tầng khác có thể đặt rõ
`REALTIME_DATABASE_URL`. Đừng lấy mù `DATABASE_URL_UNPOOLED` nếu nó trỏ database mặc định khác.

#### Bộ thông dịch nhiệm vụ, và vì sao nó dùng chung với bản desktop

`quest-engine/` là bản JavaScript của `QuestEngine.cs` bên bản desktop, và nó đọc **cùng một
tệp hồ sơ** (`profile.json`, schema 46) mà bản desktop dùng. Đó là điểm mấu chốt: hồ sơ ấy
không phải cấu hình, nó là **tri thức về site** — mỗi selector trong đó là một buổi tối ngồi
xem trang thật, và vài cái là cả một đêm hỏng việc mới rút ra. Nếu web chép lại tri thức đó
thành mã riêng thì hai bản sẽ trôi khỏi nhau ngay lần site đổi marker đầu tiên, và người sửa
sẽ chỉ sửa được một bên.

Nên chia thế này:

- **Hồ sơ là dữ liệu.** Thêm nhiệm vụ = thêm dữ liệu, không thêm code.
- **Engine là bộ thông dịch.** 13 loại bước × 6 loại điều kiện, chấm hết.
- **`profile.mjs` là lớp dịch.** Web giữ form nhỏ và phẳng (bật/tắt, độ khó phòng, ngưỡng
  HP), lớp này đặt các lựa chọn ấy vào đúng `selectedValue` của hồ sơ. Một công tắc có thể
  bật hai định nghĩa cùng tên; sau khi đọc hạng tài khoản, engine chỉ lấy flow VIP hoặc
  Thường tương ứng.
- **Trình duyệt được TIÊM VÀO.** `runCycle` nhận `chromium` từ người gọi, nên `quest-engine/`
  không phụ thuộc Playwright và bundle của Next không kéo theo thư viện nó không dùng.
- **Vấn Đáp dùng cùng danh sách tham khảo với PC.** Worker tải toàn bộ bảng cộng đồng về máy,
  cache 12 giờ rồi so câu/đáp án cục bộ. Nó bỏ dấu và số thứ tự nhưng chỉ chấp nhận đáp án
  khớp nguyên vẹn một lựa chọn đang hiện; nguồn mâu thuẫn hoặc câu lạ thì dừng để giữ lượt.
  Không có nhánh Gemini trên web.

Lưới hồi quy chạy trên Chromium thật, trước một trang thật:

```bash
npm run smoke
npm run verify:profile
```

Mỗi ca trong đó là một chuyện đã xảy ra một lần rồi — nút BẮT ĐẦU không chịu đứng yên nên
click thường chết, một selector vắng mặt rơi về quét cả trang rồi khớp nhầm chỉ số, một option
đổi giữa lượt mà script vẫn chạy giá trị cũ. Ba lỗi port đầu tiên đều do lưới này bắt, trong
đó có một lỗi làm **toàn bộ tường thuật câm lặng mà không có một dòng lỗi nào**: Playwright
bản .NET tự gọi một chuỗi hình dạng `() => {…}`, bản JavaScript thì trả `undefined`.

Quy tắc giữ cho nó sạch khi lớn lên:

1. **Trang không tự truy vấn.** Trang gọi service. Muốn thêm luật thành viên thì mở
   `services/users.ts`, không phải đi lục mười cái page.
2. **Cookie nói *ai đang hỏi*, database nói *họ được làm gì*.** `proxy.ts` chỉ kiểm tra "có
   cookie không" (rẻ, chạy mọi request); `lib/auth/guards.ts` mới đọc lại dòng user thật.
   Nhờ vậy admin đình quyền ai đó thì hiệu lực ngay ở request kế tiếp, không phải chờ hết
   hạn cookie.
3. **Server action nào cũng tự kiểm tra lại quyền.** Form có thể bị giả mạo; guard thì không
   bỏ qua được.

Thêm một nhiệm vụ mới về sau = ghi nó ra bằng dữ liệu trong hồ sơ (làm ở bản desktop, nơi có
trình ghi flow), xuất lại `profile.json`, rồi thêm một nhánh vào `configSchema`, một
`<fieldset>` trong `ConfigForm`, và vài dòng trong `profile.mjs`. Không đụng tới engine, auth,
admin hay job lifecycle — và không viết một dòng selector nào lần thứ hai.

---

## 2. Dựng trên Vercel — từng bước

### Bước 1 — Database (Neon Postgres)

1. Vercel Dashboard → chọn project → tab **Storage** → **Create Database** → **Neon**
   (Serverless Postgres, có gói miễn phí).
2. Chọn region gần người dùng — `Singapore` cho Việt Nam.
3. Bấm **Connect** để gắn vào project. Vercel tự thêm `DATABASE_URL` vào biến môi trường của
   cả ba môi trường (Production/Preview/Development).

> Cách khác qua CLI: `vercel integration add neon`

### Bước 2 — Biến môi trường

Vercel → Project → **Settings** → **Environment Variables**. Thêm các biến (`DATABASE_URL`
đã có sẵn từ bước 1):

| Biến | Giá trị | Dùng để làm gì |
|---|---|---|
| `AUTH_SECRET` | 32 byte ngẫu nhiên | Ký JWT phiên đăng nhập |
| `ENCRYPTION_KEY` | **đúng** 32 byte (64 hex) | Mã hoá cookie game trong database |
| `WORKER_TOKEN` | 32 byte ngẫu nhiên | Bí mật chia sẻ để khôi lỗi gọi `/api/worker` |
| `REALTIME_DATABASE_URL` | Tuỳ chọn | URL unpooled tới **cùng database**; Neon thường để trống được |

Sinh chuỗi ngẫu nhiên:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> `WORKER_TOKEN` là thứ duy nhất đứng giữa Internet và quyền đọc cookie game của mọi thành
> viên. Giữ như giữ mật khẩu; đổi nó là cắt ngay một khôi lỗi bị lộ.
>
> `ENCRYPTION_KEY` thì **mất là mất luôn**: cookie đã lưu sẽ không giải mã được nữa và mọi
> người phải dán lại. Hãy coi nó như bí mật vĩnh viễn của deployment — sao lưu chỗ an toàn,
> đừng đổi trừ khi thật sự cần.

### Cookie game được bảo vệ thế nào

Cookie đăng nhập game là chìa khoá vào tài khoản thật của một người, nên nó không nằm
plaintext ở đâu cả:

- **Trong database:** mã hoá **AES-256-GCM**, mỗi lần lưu một IV mới, khoá lấy từ
  `ENCRYPTION_KEY`. Quyền đọc database do đó **không** đồng nghĩa với quyền dùng — chìa nằm
  ở biến môi trường. GCM là AEAD nên một ciphertext bị sửa sẽ báo lỗi thay vì âm thầm giải
  ra rác.
- **Về phía trình duyệt:** không bao giờ. Trang cấu hình chỉ hiện "đã có / chưa có" và một ô
  để *thay thế*; để trống ô đó khi lưu thì cookie cũ giữ nguyên. Một bí mật đã mã hoá mà vẫn
  render vào HTML mỗi lần mở trang thì coi như chưa mã hoá.
- **Trong lịch sử job:** snapshot cấu hình cũng giữ cookie ở dạng đã mã hoá — bảng jobs sống
  lâu hơn bảng config rất nhiều.
- **Giải mã đúng một lần:** tại `/api/worker` khi khôi lỗi đã xác thực bằng `WORKER_TOKEN`,
  rồi đi tiếp trên HTTPS tới máy sắp dùng chính cookie đó.

Giá trị ghi từ trước khi có mã hoá vẫn đọc được bình thường và sẽ tự vào phong bì ở lần lưu
kế tiếp — không cần downtime, không cần script migration.

### Bước 2b — Khôi lỗi tông môn (VM Oracle Always Free)

Worker mà tông môn nuôi cho mọi thành viên. Toàn bộ hướng dẫn — chọn shape/OS, tạo VM,
`setup.sh` một lệnh, vận hành, cập nhật — nằm ở [deploy/oracle/README.md](deploy/oracle/README.md).

Tóm tắt: VM.Standard.A1.Flex (Ampere ARM, gói Always Free) + Ubuntu 24.04 aarch64, rồi:

```bash
WEB_URL='https://<app>.vercel.app' WORKER_TOKEN='<token trên Vercel>' sudo -E bash setup.sh
```

Script tải **gói khôi lỗi** từ chính web (`/linh-su/goi-linh-su.tgz` — đóng lại ở mỗi deploy
từ đúng engine đang chạy), dựng systemd service, và từ đó "cập nhật" nghĩa là chạy lại đúng
một lệnh ấy.

### Bước 3 — Deploy

Trước khi bấm deploy, soát lại biến môi trường **Production**. `vercel env ls production`
phải có đủ:

| Biến | Ghi chú |
| --- | --- |
| `DATABASE_URL` | ⚠️ đọc kỹ cảnh báo ngay dưới |
| `AUTH_SECRET`, `ENCRYPTION_KEY`, `WORKER_TOKEN` | ba bí mật, mỗi cái 32 byte |
| `WEB_URL` | `https://<app>.vercel.app`, kèm scheme |
| `CRON_SECRET` | nếu dùng cron ngoài |

(`SANDBOX_ENABLED` và `AGENT_BROWSER_SNAPSHOT_ID` là di sản của đường sandbox — từ v0.11
không còn ai đọc, xoá được.)

> **Bẫy `DATABASE_URL`.** Integration Neon của Vercel tự tạo biến này trỏ vào database **mặc
> định** của project (`neondb`) — không phải database `jarvis` mà Jarvis dùng. Nếu để nguyên:
>
> - `npm run db:migrate` ở Bước 4 sẽ tạo bảng trong **nhầm database**, và bạn có một bộ bảng
>   rác không ai đọc tới;
> - app chạy lên vẫn đăng nhập được — bằng dữ liệu của database sai — nên lỗi này **không tự
>   lộ ra**, nó chỉ khiến bạn ngồi tự hỏi sao mật khẩu vừa đặt lại không đúng.
>
> Ghi đè bằng chính chuỗi trong `.env` (đã qua `scripts/switchDb.mjs`):
>
> ```bash
> vercel env rm DATABASE_URL production --yes
> printf '%s' "$DATABASE_URL" | vercel env add DATABASE_URL production
> ```
>
> Muốn biết chắc mình đang nói chuyện với database nào, hỏi thẳng nó:
>
> ```bash
> node --input-type=module --env-file=.env \
>   -e "import{neon}from'@neondatabase/serverless';
>       console.log((await neon(process.env.DATABASE_URL)\`select current_database() db\`)[0])"
> ```

Rồi deploy:

```bash
npm i -g vercel
vercel link          # gắn thư mục này với project trên Vercel
vercel --prod
```

Đổi biến môi trường **không** tự áp vào bản đang chạy — phải deploy lại thì function mới đọc
được giá trị mới.

Hoặc đơn giản hơn: push lên GitHub rồi Vercel → **Add New Project** → Import repo. Từ đó mỗi
lần push lên `master` là tự deploy.

### Bước 4 — Tạo bảng và trưởng môn đầu tiên

Chạy **từ máy của bạn**, trỏ vào database production:

```bash
# Lấy biến môi trường production về máy
vercel env pull .env

# Tạo bảng
npm run db:migrate

# Tạo tài khoản trưởng môn — đặt ADMIN_PASSWORD trong .env trước
npm run db:seed
```

`db:seed` là idempotent và **cố ý không đổi mật khẩu** nếu tài khoản đã tồn tại — một lệnh
lỡ tay không được phép reset chìa khoá hệ thống đang chạy.

Đăng nhập bằng tài khoản đó rồi **đổi mật khẩu ngay**.

### Bước 5 — Khôi lỗi túc trực của từng đạo hữu (không bắt buộc)

Trước hết: **hầu hết mọi người không cần bước này.** Khôi lỗi tông môn trên VM trực sẵn cho
cả tông môn, nên mục Khôi Lỗi nói thẳng "đạo hữu không cần cài gì cả" khi nó đang online.
Phần dưới là lối rẽ cho ai muốn lượt chạy đi từ chính máy mình (IP dân cư, không xếp hàng
chung).

Với người rẽ vào lối ấy: **không cần cài sẵn bất cứ thứ gì** — không Node.js, không npm,
không quyền quản trị, và **không phải gõ lệnh**. Bấm "Tạo bộ cài" → tải `cai-linh-su.cmd` →
bấm đúp. Tệp được dựng ngay trong trình duyệt bằng Blob (linh phù đã nằm sẵn ở client), nên
bí mật không đi qua URL nào. Người dùng trên máy chủ/SSH vẫn có lệnh dán, thu sau một dòng
"hoặc cài bằng dòng lệnh".

Cơ chế, và vì sao từng mảnh lại như vậy:

- **Node "xách tay".** Script tải bản Node chính thức về ngay trong thư mục cài và chỉ dùng
  bản đó, thay vì đòi người dùng cài Node (hay tự cài qua winget/apt). Ngoài chuyện bỏ được
  một rào cản, nó còn xoá luôn một lớp lỗi: khôi lỗi tự chạy lúc đăng nhập, mà PATH lúc ấy
  không giống PATH trong cửa sổ đang mở — một `node` tìm qua PATH là lỗi "chạy tay thì được,
  tự khởi động thì không" kinh điển. Bản tải về được **đối chiếu SHA-256** với
  `SHASUMS256.txt` của nodejs.org: ta sắp chạy thứ này như một runtime, không tin suông.
- **playwright-core đi theo gói**, không qua npm — thuần JS, không phụ thuộc gì, nén còn
  ~3MB. Nhờ vậy trình tải Chromium chính là `cli.js` của bản đang chạy, nên lỗi
  "Executable doesn't exist" (CLI lệch phiên bản đặt sẵn revision khác) **bất khả thi về mặt
  cấu trúc**, chứ không chỉ được canh chừng bằng kỷ luật.
- **Linh phù chỉ hiện một lần** lúc phát — database giữ SHA-256, không giữ bản rõ. Quên thì
  phát lại (cái cũ tự hết hiệu lực).
- Khôi lỗi cài kiểu này **chỉ nhận job của chủ linh phù** — điều kiện nằm ngay trong câu SQL
  claim, không phải phép lịch sự.
- Gói cài (`/linh-su/goi-linh-su.tgz`) được `scripts/buildWorkerBundle.mjs` đóng ở mỗi
  deploy từ đúng engine đang chạy — không tồn tại "bản dành cho người cài" nào để lệch.
- Cài lại = cập nhật, và **giữ nguyên WORKER_ID** đã có, để mục Khôi Lỗi không tích dần xác
  khôi lỗi "vắng mặt" sau mỗi lần nâng cấp. Gỡ bằng `uninstall.ps1`/`uninstall.sh` trong thư
  mục cài: xoá thư mục, cắt đường tự khởi động, hạ cả vòng nuôi lẫn worker.

> Khôi lỗi cài trước **v0.19.0** nên cài đè một lần: bản trước v0.18 nhận thêm kho Vấn Đáp, mọi
> bản cũ nhận heartbeat Thu Đàn 5 giây. Không cần gỡ trước hay phát linh phù mới. Muốn đổi
> nguồn Vấn Đáp, đặt `QUIZ_DIRECTORY_URL` trong môi trường worker rồi khởi động lại.

Dev muốn chạy worker thô từ repo thì vẫn được:

```bash
WEB_URL=https://<app>.vercel.app WORKER_TOKEN=<token> npm run worker
```

---

## 3. Chạy ở máy nhà

```bash
cp .env.example .env     # điền DATABASE_URL, AUTH_SECRET, WORKER_TOKEN, ADMIN_PASSWORD
npm install
npm run db:migrate
npm run db:seed
npm run dev              # http://localhost:3000

# cửa sổ khác:
WEB_URL=http://localhost:3000 WORKER_TOKEN=<...> npm run worker
```

## 3b. Chạy khôi lỗi ở đâu cho miễn phí

Khôi lỗi chỉ cần một chỗ chạy Node **liên tục** (và một Chromium). Xếp theo mức tôi thật sự
khuyên dùng:

### 1. Chính máy đang chạy bản desktop — khuyến nghị số một

Máy đó vốn đã bật, đã có Node, đã có Chromium của Playwright. Không tốn đồng nào, không
thêm tài khoản, không giới hạn giờ. Cho nó sống dai qua reboot:

```bash
npm i -g pm2
pm2 start scripts/worker.mjs --name jarvis-worker
pm2 save && pm2 startup
```

Nhược điểm duy nhất: máy tắt là automation dừng. Với một công cụ farm game cá nhân thì đó
hiếm khi là vấn đề thật.

### 2. Oracle Cloud Free Tier — máy chủ thật, miễn phí vĩnh viễn (đường chính thức)

Rộng rãi nhất trong các gói free: máy ảo ARM Ampere tới **4 vCPU / 24 GB RAM**, always-free
(không phải trial). Thừa sức nuôi Chromium. Đây chính là nơi khôi lỗi tông môn đang sống —
kit dựng hoàn chỉnh nằm ở [deploy/oracle/](deploy/oracle/README.md).

Lưu ý thực tế: đăng ký cần thẻ (không bị trừ tiền), và khu vực nào đông thì có lúc báo hết
capacity ARM — thử lại vào giờ khác hoặc đổi region.

### 3. Google Cloud Free Tier — `e2-micro` always-free

Một instance `e2-micro` miễn phí vĩnh viễn ở vài region của Mỹ. Đủ chạy worker, nhưng RAM
chỉ ~1 GB nên Chromium sẽ chật vật — hợp nếu chỉ chạy Luyện Đan Đường, hơi thiếu cho Mê Cung.

### 4. GitHub Actions — miễn phí, nhưng chạy theo phiên

Repo private có hạn mức phút miễn phí mỗi tháng; một workflow chạy tối đa **6 tiếng** một
lần. Cách dùng: đặt workflow `schedule` gọi `npm run worker` với một biến giới hạn thời gian
tự thoát, rồi nó tự khởi động lại ở nhịp sau. Được việc và thật sự miễn phí, đổi lại có
khoảng trống giữa các phiên và cron của Actions hay bị trễ vài phút.

### Những chỗ KHÔNG nên dùng

- **Render free** — web service tự ngủ sau ~15 phút không có request, mà worker thì không
  nhận request nào cả. Background worker của Render là gói trả phí.
- **Railway / Fly.io** — giờ chủ yếu là credit dùng thử rồi chuyển sang trả phí; kiểm tra
  hạn mức hiện hành trước khi tin là free.
- **Cloudflare Workers** — không chạy được Chromium (Browser Rendering là dịch vụ trả phí
  riêng).

> Hạn mức của các nhà cung cấp thay đổi liên tục — hãy kiểm tra lại trang giá trước khi
> chọn, đừng tin con số trong tài liệu này là vĩnh viễn.

### Cron miễn phí từ bên ngoài (tuỳ chọn, chỉ để vệ sinh)

`/api/cron` giờ chỉ quét dọn (job mồ côi, tin đàm đạo quá hạn) và việc đó đã chạy tiện-đường
mỗi lần có người mở dashboard. Muốn lưới an toàn dày hơn nhịp 1 lần/ngày của Vercel Hobby:
đặt `CRON_SECRET` rồi dùng một dịch vụ cron miễn phí (cron-job.org, EasyCron…) gọi
mỗi 5–15 phút:

```
GET https://<app>.vercel.app/api/cron
Authorization: Bearer <CRON_SECRET>
```

## 4. Vận hành

| Việc | Ở đâu |
|---|---|
| Duyệt người mới | `/admin` — hàng chờ luôn xếp lên đầu bảng |
| Tìm / lọc thành viên | `/admin` — ô tìm ghi vào URL nên chia sẻ và F5 đều giữ nguyên |
| Thêm / sửa / xoá | `/admin` |
| Cấu hình + Khai Đàn | `/dashboard` |

Vài lằn ranh an toàn đã cài sẵn: không thể xoá trưởng môn cuối cùng, không thể tự hạ quyền
hay tự khoá chính mình, và một lượt chạy mà khôi lỗi im lặng quá 3 phút sẽ tự kết thúc với
một dòng giải thích trung thực trong nhật ký.

## 5. Migration về sau

```bash
# sửa src/lib/db/schema.ts trước, rồi:
npm run db:generate      # sinh file SQL trong ./drizzle
npm run db:migrate       # áp lên database
```

File SQL sinh ra **được commit** — lịch sử schema nằm trong git, không phải trong đầu ai cả.

## 6. Lịch sử phát hành

Bản hiện tại: **0.15.2**.

Lịch sử nằm ở [CHANGELOG.md](CHANGELOG.md), tách riêng khỏi file này — hai tài liệu trả lời
hai câu hỏi khác nhau: README nói *hệ thống chạy thế nào*, changelog nói *vì sao nó thành ra
như thế*. Trộn chúng vào nhau thì phần hướng dẫn bị chôn dưới lịch sử, và lịch sử thì bị đọc
nhầm thành hướng dẫn.
