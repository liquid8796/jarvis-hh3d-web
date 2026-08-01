# Jarvis HH3D — Web

Control plane tu tiên cho automation hoathinh3d: đăng ký môn đồ → tông môn duyệt → khai đàn,
rồi automation **chạy trên server** dù đạo hữu đã tắt trình duyệt.

Đây là bản web của [JarvisHH3D](../JarvisHH3D) (bản desktop). Hai sản phẩm chia nhau cùng
một mô hình nhiệm vụ — Mê Cung, Luyện Đan Đường, cùng những tuỳ chọn ấy.

---

## 1. Kiến trúc — và vì sao lại thế

### Nút Start bấm ở web, browser chạy ở đâu?

Web **không bao giờ** tự mở browser trong một function — function của Vercel sống theo
request và bị cắt sau vài phút. Bấm Khai Đàn chỉ ghi một dòng `automation_jobs` trạng thái
`queued`; một *linh sứ* nhận việc rồi kể lại qua HTTPS. Vì ý định của người dùng nằm trong
**database** chứ không nằm trong tab trình duyệt, đóng tab hay tắt máy chẳng ảnh hưởng gì.

Có **hai loại linh sứ**, và việc chọn loại nào không phải sở thích — nó do *hình dạng thời
gian của nhiệm vụ* quyết định:

```
                      ┌──────────────── Vercel ────────────────┐
                      │  Next.js control plane                 │
   Khai Đàn ─────────►│  • đăng ký / duyệt / cấu hình          │
                      │  • ghi job vào DB, chọn runner         │
                      │  • /api/cron mỗi phút → SANDBOX        │
                      └───┬────────────────────────────┬───────┘
                          │                            │
              ┌───────────▼──────────┐     ┌───────────▼─────────────┐
              │ Vercel Sandbox       │     │ scripts/worker.mjs      │
              │ microVM phù du       │     │ máy chạy liên tục       │
              │ → Luyện Đan Đường    │     │ → Mê Cung               │
              │   (mỗi lượt vài phút)│     │   (phiên liền 35 phút)  │
              └──────────┬───────────┘     └───────────┬─────────────┘
                         └──────► Neon Postgres ◄──────┘
```

**Luyện Đan Đường** hợp sandbox hoàn hảo: mỗi lượt ghé chỉ vài phút (thu đan → phân giải →
khai lô → giữ lửa ba nhịp → đọc đồng hồ → đi), rồi nghỉ ~26 phút chờ mẻ chín. Dựng VM, làm
việc ngắn, tắt — không tốn gì lúc chờ.

**Mê Cung** thì không thể: nó phải tạo phòng, đứng chờ đủ 5 **người thật** (có thể hàng chục
phút), rồi đánh liền một mạch tới 35 phút. Cả quá trình là MỘT phiên browser không đứt được
— mất VM giữa chừng là mất luôn cái phòng đang đứng trong đó, và bốn người kia mất lượt oan.
Không cắt thành lát 8 phút được.

Nên `src/lib/runners/policy.ts` phủ quyết: bật Mê Cung là job tự chuyển sang linh sứ máy
nhà, **kèm một dòng giải thích trong nhật ký** thay vì âm thầm làm khác ý người dùng.

**Đường dự phòng tự động:** sandbox thất bại ba lát liên tiếp (thiếu quota, VM không dựng
được, Chromium không lên) thì job tự đổi `runner` sang `local` và nằm chờ worker máy nhà —
người dùng không phải làm gì, chỉ cần có một worker đang trực.

> ### ⚠️ Gói Hobby (free) của Vercel KHÔNG chạy được linh sứ sandbox
>
> Sandbox không tự đi tìm việc — phải có cron gọi `/api/cron` mỗi phút. Nhưng gói Hobby
> **chỉ cho cron một lần mỗi ngày**; `vercel --prod` từ chối thẳng biểu thức `* * * * *`:
>
> ```
> Error: Hobby accounts are limited to daily cron jobs.
> ```
>
> Một lần mỗi ngày thì vô dụng với automation cần ghé lò mỗi ~26 phút. Nên **sandbox mặc
> định TẮT**: `src/lib/runners/policy.ts` giao mọi job cho `local` trừ khi có
> `SANDBOX_ENABLED=1`. Thà giao cho thứ chắc chắn chạy còn hơn xếp job vào hàng chờ không
> ai đến lấy.
>
> **Vẫn dùng được sandbox trên Hobby.** Hai giới hạn của gói free được né bằng thiết kế
> chứ không bằng cách trả tiền:
>
> - *Function chỉ sống 60 giây* → function **không chờ** sandbox. Nó dựng VM, nạp một script
>   worker vào, chạy ở chế độ `detached`, rồi trả về ngay. Sandbox sống tiếp bằng timeout
>   của chính nó và tự nói chuyện với `/api/worker` bằng đúng giao thức mà linh sứ máy nhà
>   dùng. Trần 60 giây trở nên vô hại.
> - *Cron chỉ 1 lần/ngày* → **bấm Khai Đàn là thả sandbox ngay**, không đợi nhịp cron. Cron
>   hằng ngày chỉ còn làm việc quét dọn.
>
> Muốn sandbox tự nhặt cả những job xếp hàng lúc bạn không ngồi trước máy (ví dụ lượt ghé lò
> kế tiếp sau 26 phút) thì cần một cron dày hơn — xem "Cron miễn phí từ bên ngoài" bên dưới.
>
> `vercel.json` để cron ở `0 3 * * *` (mỗi ngày một lần) cho deploy được trên Hobby. Nhịp
> đó vẫn hữu ích: nó dọn job chết và job không ai nhận, nên hệ thống tự lành kể cả khi
> không ai mở dashboard.

### Lưu config người dùng bằng gì?

**JSONB trong chính Postgres đó** (bảng `user_configs`), không dùng store thứ hai. Lý do,
theo thứ tự quan trọng:

- Hình thù config **thay đổi liên tục** — bản desktop đã đi tới quest-profile schema 41. Cột
  quan hệ sẽ thành một chuỗi migration bất tận; document thì co giãn tự nhiên.
- JSONB **vẫn truy vấn được** bằng SQL khi admin cần hỏi ("ai đang bật Mê Cung?") — thứ mà
  một blob store không cho.
- Một database = một chuỗi kết nối, một bản backup, một thứ phải vận hành.

Đã cân nhắc và loại: **Edge Config** (dành cho cờ toàn cục hiếm đổi, không phải dữ liệu
per-user ghi từ form), **Blob** (không truy vấn được), **KV/Redis** (thêm một store để đồng
bộ, đổi lấy tốc độ mà bài toán này không cần).

Điểm tinh tế: config được **validate hai chiều** bằng Zod — cả lúc ghi lẫn lúc đọc. Một
document viết bởi bản deploy cũ vẫn trở về đúng hình thù hôm nay với default được điền đủ.
Đó là bản JSONB của một migration.

### Cấu trúc mã nguồn

Phân tầng nghiêm ngặt, mỗi tầng chỉ nói chuyện với tầng ngay dưới:

```
src/
  app/            # Route + UI. Server Components đọc, Server Actions ghi.
    actions/      #   Ranh giới ghi — mọi action mở đầu bằng một guard.
    api/          #   Hai endpoint máy-nói-với-máy: feed cho client, /api/worker cho linh sứ.
  components/     # UI dùng chung, không biết gì về database.
  lib/
    auth/         # Phiên đăng nhập, guard phân quyền, cửa vào của worker.
    db/           # Schema Drizzle + client. Nơi DUY NHẤT biết hình thù bảng.
    services/     # Quy tắc nghiệp vụ. Nơi DUY NHẤT viết truy vấn.
    quest-engine/ # Bộ thông dịch nhiệm vụ — JS thuần, không biết gì về Next hay database.
```

#### Bộ thông dịch nhiệm vụ, và vì sao nó dùng chung với bản desktop

`quest-engine/` là bản JavaScript của `QuestEngine.cs` bên bản desktop, và nó đọc **cùng một
tệp hồ sơ** (`profile.json`, schema 41) mà bản desktop dùng. Đó là điểm mấu chốt: hồ sơ ấy
không phải cấu hình, nó là **tri thức về site** — mỗi selector trong đó là một buổi tối ngồi
xem trang thật, và vài cái là cả một đêm hỏng việc mới rút ra. Nếu web chép lại tri thức đó
thành mã riêng thì hai bản sẽ trôi khỏi nhau ngay lần site đổi marker đầu tiên, và người sửa
sẽ chỉ sửa được một bên.

Nên chia thế này:

- **Hồ sơ là dữ liệu.** Thêm nhiệm vụ = thêm dữ liệu, không thêm code.
- **Engine là bộ thông dịch.** 13 loại bước × 6 loại điều kiện, chấm hết.
- **`profile.mjs` là lớp dịch.** Web giữ form nhỏ và phẳng (bật/tắt, độ khó phòng, ngưỡng
  HP), lớp này đặt các lựa chọn ấy vào đúng `selectedValue` của hồ sơ.
- **Trình duyệt được TIÊM VÀO.** `runCycle` nhận `chromium` từ người gọi, nên `quest-engine/`
  không phụ thuộc Playwright và bundle của Next không kéo theo thư viện nó không dùng.

Lưới hồi quy chạy trên Chromium thật, trước một trang thật:

```bash
npm run smoke
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

Vercel → Project → **Settings** → **Environment Variables**. Thêm hai biến (`DATABASE_URL`
đã có sẵn từ bước 1):

| Biến | Giá trị | Dùng để làm gì |
|---|---|---|
| `AUTH_SECRET` | 32 byte ngẫu nhiên | Ký JWT phiên đăng nhập |
| `ENCRYPTION_KEY` | **đúng** 32 byte (64 hex) | Mã hoá cookie game trong database |
| `WORKER_TOKEN` | 32 byte ngẫu nhiên | Bí mật chia sẻ để linh sứ gọi `/api/worker` |

Sinh chuỗi ngẫu nhiên:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> `WORKER_TOKEN` là thứ duy nhất đứng giữa Internet và quyền đọc cookie game của mọi thành
> viên. Giữ như giữ mật khẩu; đổi nó là cắt ngay một linh sứ bị lộ.
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
- **Giải mã đúng một lần:** tại `/api/worker` khi linh sứ đã xác thực bằng `WORKER_TOKEN`,
  rồi đi tiếp trên HTTPS tới máy sắp dùng chính cookie đó.

Giá trị ghi từ trước khi có mã hoá vẫn đọc được bình thường và sẽ tự vào phong bì ở lần lưu
kế tiếp — không cần downtime, không cần script migration.

### Bước 2b — Vercel Sandbox (cho linh sứ sandbox)

Sandbox chạy bằng OIDC tự động khi ở trên Vercel, nên **không cần token gì thêm** cho
production. Chỉ cần hai thứ:

**1. Một người gõ cửa `/api/cron`.** Cron trong `vercel.json` để `0 3 * * *` — mỗi ngày một
lần, vì gói Hobby không cho dày hơn (xem cảnh báo đầu README). Nhịp đó chỉ đủ để **quét dọn**
job chết, không đủ để lái automation.

Nhịp thật đến từ hai nguồn khác:

- **Nút Khai Đàn** gọi thẳng `ensureSandboxWorker()` — bấm là VM dựng ngay, không phải đợi cron.
- **Một dịch vụ cron ngoài** (cron-job.org…) gọi `/api/cron` mỗi phút kèm
  `Authorization: Bearer $CRON_SECRET`. Không có nó thì sau khi lát sandbox đầu tiên kết
  thúc, lượt ghé lò kế tiếp (~26 phút sau) sẽ không ai đến gõ cửa.

Mỗi nhịp nhận đúng một job sandbox (một VM đang tính tiền là đủ; nhiều job thì lần lượt các
nhịp sau).

**2. Ảnh dựng sẵn (rất nên có).** Không có nó, mỗi lát mất hàng chục giây chỉ để cài
`playwright-core` và tải Chromium — đủ ăn hết ngân sách của một lát ngắn. Tạo một lần:

```bash
npx tsx scripts/createSandboxSnapshot.mts
```

Rồi thêm `AGENT_BROWSER_SNAPSHOT_ID` vào Environment Variables trên Vercel. Từ đó VM khởi
động dưới một giây.

**Chụp xong thì KIỂM ẢNH**, đừng tin cái ID:

```bash
npx tsx scripts/verifySandboxSnapshot.mts
```

Nó dựng một VM từ ảnh, gửi sang đúng những tệp mà lượt chạy thật gửi, rồi bắt nó mở Chromium
và chạy một bước của bộ thông dịch. Có mặt vì một ảnh hỏng **không kêu lúc chụp**: mọi lệnh
cài đều thành công, ảnh chụp xong, ID trả về đẹp đẽ — rồi mỗi lát sandbox sau đó chết vì
`Cannot find package 'playwright-core'` (cài `-g` thì Node không tra tới) hoặc
`Executable doesn't exist` (CLI lệch phiên bản). Cả hai chỉ lộ ra trên production, trong một
VM đã tự huỷ, sau khi người dùng bấm Khai Đàn.

Tuỳ chọn: đặt `CRON_SECRET` để gọi `/api/cron` bằng tay lúc thử
(`curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron`). Cron của Vercel tự
được nhận diện qua user-agent nên không cần biến này để chạy thật.

> Chạy sandbox từ **máy nhà** (lúc dev) cũng không cần token cá nhân: một lần
> `vercel env pull` là `.env` có `VERCEL_OIDC_TOKEN`, và cả SDK lẫn script chụp ảnh đều tự
> xác thực bằng nó. Token ấy hết hạn sau ~12 giờ — lúc đó pull lại, hoặc đặt hẳn
> `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID` cho khỏi phải nhớ.

### Bước 3 — Deploy

Trước khi bấm deploy, soát lại biến môi trường **Production**. `vercel env ls production`
phải có đủ:

| Biến | Ghi chú |
| --- | --- |
| `DATABASE_URL` | ⚠️ đọc kỹ cảnh báo ngay dưới |
| `AUTH_SECRET`, `ENCRYPTION_KEY`, `WORKER_TOKEN` | ba bí mật, mỗi cái 32 byte |
| `WEB_URL` | `https://<app>.vercel.app`, kèm scheme |
| `SANDBOX_ENABLED` | `1` nếu muốn dùng sandbox |
| `AGENT_BROWSER_SNAPSHOT_ID` | từ Bước 2b |
| `CRON_SECRET` | nếu dùng cron ngoài |

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

### Bước 5 — Chạy linh sứ máy nhà (bắt buộc nếu dùng Mê Cung)

Trên máy chạy liên tục:

```bash
git clone https://github.com/liquid8796/jarvis-hh3d-web.git
cd jarvis-hh3d-web && npm install

WEB_URL=https://<app>.vercel.app \
WORKER_TOKEN=<đúng chuỗi đã đặt trên Vercel> \
WORKER_ID=linh-su-01 \
npm run worker
```

Muốn chạy nhiều lượt song song thì mở thêm tiến trình với `WORKER_ID` khác — việc giành job
đã được Postgres phân xử bằng một câu UPDATE nguyên tử, không bao giờ có hai worker ôm cùng
một job.

Cho nó sống dai qua reboot: `pm2 start scripts/worker.mjs --name jarvis-worker`, hoặc một
systemd unit, hoặc Docker restart-policy.

Linh sứ máy nhà cần một bản Chromium — cài một lần:

```bash
npx playwright@1.62.1 install chromium
```

> Phải ĐÚNG phiên bản ấy. `playwright-core` đi tìm một revision Chromium cụ thể, và một CLI
> lệch phiên bản sẽ đặt sẵn revision khác — lúc chạy báo "Executable doesn't exist", một câu
> chẳng nói gì về nguyên nhân.

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

## 3b. Chạy linh sứ ở đâu cho miễn phí

Linh sứ chỉ cần một chỗ chạy Node **liên tục** (và một Chromium). Xếp theo mức tôi thật sự
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

### 2. Oracle Cloud Free Tier — máy chủ thật, miễn phí vĩnh viễn

Rộng rãi nhất trong các gói free: máy ảo ARM Ampere tới **4 vCPU / 24 GB RAM**, always-free
(không phải trial). Thừa sức nuôi Chromium. Đây là lựa chọn tốt nhất nếu bạn muốn linh sứ
chạy 24/7 mà không phụ thuộc máy nhà.

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

### Cron miễn phí từ bên ngoài (nếu vẫn muốn dùng sandbox)

Nếu bạn thích đường sandbox nhưng không lên Pro: đặt `CRON_SECRET` trên Vercel, rồi dùng một
dịch vụ cron-as-a-service miễn phí (cron-job.org, EasyCron…) gọi mỗi phút:

```
GET https://<app>.vercel.app/api/cron
Authorization: Bearer <CRON_SECRET>
```

Rồi bật `SANDBOX_ENABLED=1`. Lúc đó chính sách runner mới giao job cho sandbox.

## 4. Vận hành

| Việc | Ở đâu |
|---|---|
| Duyệt người mới | `/admin` — hàng chờ luôn xếp lên đầu bảng |
| Tìm / lọc thành viên | `/admin` — ô tìm ghi vào URL nên chia sẻ và F5 đều giữ nguyên |
| Thêm / sửa / xoá | `/admin` |
| Cấu hình + Khai Đàn | `/dashboard` |

Vài lằn ranh an toàn đã cài sẵn: không thể xoá trưởng môn cuối cùng, không thể tự hạ quyền
hay tự khoá chính mình, và một lượt chạy mà linh sứ im lặng quá 3 phút sẽ tự kết thúc với
một dòng giải thích trung thực trong nhật ký.

## 5. Migration về sau

```bash
# sửa src/lib/db/schema.ts trước, rồi:
npm run db:generate      # sinh file SQL trong ./drizzle
npm run db:migrate       # áp lên database
```

File SQL sinh ra **được commit** — lịch sử schema nằm trong git, không phải trong đầu ai cả.
