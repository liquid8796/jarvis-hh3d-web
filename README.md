# Jarvis HH3D — Web

Control plane tu tiên cho automation hoathinh3d: đăng ký môn đồ → tông môn duyệt → khai đàn,
rồi automation **chạy trên server** dù đạo hữu đã tắt trình duyệt.

Đây là bản web của [JarvisHH3D](../JarvisHH3D) (bản desktop). Hai sản phẩm chia nhau cùng
một mô hình nhiệm vụ — Mê Cung, Luyện Đan Đường, cùng những tuỳ chọn ấy.

---

## 1. Kiến trúc — và vì sao lại thế

### Nút Start bấm ở web, browser chạy ở đâu?

Điểm ràng buộc quan trọng nhất, nói thẳng ngay từ đầu:

> **Vercel không chạy được automation.** Function của Vercel sống theo từng request và bị cắt
> sau vài phút; một lượt Mê Cung ôm Chromium liên tục tới 35 phút. Không có cách nào lách.

Nên hệ thống tách làm hai nửa, và ranh giới ấy là quyết định thiết kế lớn nhất ở đây:

```
┌─ Vercel ──────────────────────┐         ┌─ Máy chạy liên tục ────────────┐
│  Next.js — control plane      │         │  scripts/worker.mjs            │
│  • đăng ký / duyệt / phân quyền│  HTTPS  │  • xin việc (claim)            │
│  • ngọc giản cấu hình          │◄───────►│  • mở Chromium, chạy nhiệm vụ  │
│  • nút Khai Đàn = ghi 1 dòng DB│  Bearer │  • nhịp tim + kể chuyện        │
│  • nhật ký cho người dùng đọc  │         │  • nghe lệnh Thu Đàn           │
└───────────────────────────────┘         └────────────────────────────────┘
                │                                       │
                └────────► Neon Postgres ◄──────────────┘
```

Web **không bao giờ** mở browser. Bấm Khai Đàn chỉ ghi một dòng `automation_jobs` với trạng
thái `queued`. Một *linh sứ* (worker) — tiến trình Node chạy trên máy nào đó luôn bật — nhận
việc, chạy, và kể lại qua HTTPS. Vì ý định của người dùng nằm trong **database** chứ không
nằm trong tab trình duyệt, đóng tab hay tắt máy chẳng ảnh hưởng gì; mở lại ở máy khác vẫn
thấy đúng lượt đang chạy.

Linh sứ có thể đặt ở: máy tính cá nhân đang chạy sẵn bản desktop, một VPS rẻ tiền, Fly.io,
Railway — bất cứ đâu chạy được Node dài hạn.

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
```

Quy tắc giữ cho nó sạch khi lớn lên:

1. **Trang không tự truy vấn.** Trang gọi service. Muốn thêm luật thành viên thì mở
   `services/users.ts`, không phải đi lục mười cái page.
2. **Cookie nói *ai đang hỏi*, database nói *họ được làm gì*.** `proxy.ts` chỉ kiểm tra "có
   cookie không" (rẻ, chạy mọi request); `lib/auth/guards.ts` mới đọc lại dòng user thật.
   Nhờ vậy admin đình quyền ai đó thì hiệu lực ngay ở request kế tiếp, không phải chờ hết
   hạn cookie.
3. **Server action nào cũng tự kiểm tra lại quyền.** Form có thể bị giả mạo; guard thì không
   bỏ qua được.

Thêm một nhiệm vụ mới về sau = thêm một nhánh vào `configSchema`, một `<fieldset>` trong
`ConfigForm`, và phần xử lý trong worker. Không đụng tới auth, admin hay job lifecycle.

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
| `WORKER_TOKEN` | 32 byte ngẫu nhiên | Bí mật chia sẻ để linh sứ gọi `/api/worker` |

Sinh chuỗi ngẫu nhiên:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> `WORKER_TOKEN` là thứ duy nhất đứng giữa Internet và quyền đọc cookie game của mọi thành
> viên. Giữ như giữ mật khẩu; đổi nó là cắt ngay một linh sứ bị lộ.

### Bước 3 — Deploy

```bash
npm i -g vercel
vercel link          # gắn thư mục này với project trên Vercel
vercel --prod
```

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

### Bước 5 — Chạy linh sứ (worker)

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

> **Trạng thái hiện tại của worker:** toàn bộ giao thức đã hoàn chỉnh và chạy được — xin
> việc, nhịp tim, dừng an toàn, tường thuật, xử lý lỗi. Riêng phần điều khiển Chromium thật
> là một chỗ cắm được đánh dấu rõ trong `runQuest()`, chờ ghép engine Playwright của bản
> desktop vào. Chạy ngay bây giờ, bạn sẽ thấy trọn vòng đời một lượt trên giao diện.

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
