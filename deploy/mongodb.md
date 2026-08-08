# Kho đàm đạo — MongoDB trên Vercel

Sảnh **Phòng Chat** lưu tin ở MongoDB. Trang này là cách dựng kho và nối nó vào project.

> Chưa có kho thì web **không hỏng**: sảnh treo biển「Tàng thư đàm đạo chưa khai mở」, mọi
> phần khác của Auto chạy bình thường. Nên bước này làm lúc nào cũng được.

---

## 1. Dựng kho trên Vercel

1. Vercel Dashboard → chọn project → tab **Storage** → **Create Database**.
2. Chọn **MongoDB Atlas** trong Marketplace, đặt tên (ví dụ `atlas-jarvis-chat`).
3. Chọn region **gần nơi function chạy nhất**. Mỗi truy vấn là một vòng đi-về, nên khoảng
   cách ở đây trả bằng độ trễ của từng lần mở sảnh.
4. Bấm **Connect to Project**, chọn project và cả ba môi trường
   (Production / Preview / Development).

Xong bước này Vercel tự thêm biến **`MONGODB_URI`** vào project. Không phải copy tay gì cả.

Kiểm lại: Project → **Settings → Environment Variables**, phải thấy `MONGODB_URI`.

---

## 2. Deploy lại

Biến môi trường **chỉ đi vào bản build mới** — bản đang chạy không tự nhận. Deploy lại một
lần là kho được nối:

```bash
npx vercel --prod
```

Vào **Phòng Chat**: biển「chưa khai mở」biến mất, gõ thử một câu là xong.

---

## 3. Biến môi trường

| Biến | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `MONGODB_URI` | **có** | Chuỗi kết nối. Integration của Vercel tự phát. |
| `MONGODB_URL` | không | Tên thay thế, cho ai đặt tay. |
| `MONGODB_DB` | không | Tên database. Bỏ trống thì lấy theo đường dẫn trong URI; URI của Vercel không mang đường dẫn nên rơi về mặc định **`jarvis`**. |

Chạy ở máy nhà thì kéo biến về:

```bash
npx vercel env pull .env.local
```

---

## 4. Hai collection, và chúng tự dựng

Không phải chạy migration nào. Lần đầu web chạm vào kho, nó tự tạo collection và index:

| Collection | Giữ gì | Index |
| --- | --- | --- |
| `chat_messages` | mỗi tin một document, kèm cảm xúc là mảng con | `chat_createdAt_desc` — phân trang và quét hạn lưu |
| `chat_typing` | mỗi người đang gõ một document, `_id` = userId | `chat_typing_ttl` — TTL 60 giây, dọn rác |

`chat_typing` **không thể phình**: `_id` là userId nên số dòng bị chặn trên bởi số thành viên.

**Hạn lưu tin cố ý KHÔNG dùng TTL index.** Số ngày là thứ tông chủ đổi được lúc chạy (trang
Tông Môn → tab Đàm Đạo), mà `expireAfterSeconds` nằm trong định nghĩa index — đổi nó phải
chạy `collMod`. Thay vào đó `/api/cron` xoá theo khoảng thời gian, đọc thẳng cấu hình hiện
hành, nên đổi số là có hiệu lực ngay.

---

## 5. Kiểm chứng

Chạy trọn vòng đời (gửi, sửa, thu hồi, cảm xúc, phân trang, hạn lưu) trên một mongod **thật**
bật trong tiến trình — không đụng kho production:

```bash
npm run verify:chat
```

Muốn soi chính kho vừa dựng thì chĩa vào nó (script tạo một database riêng cho lần chạy, đặt
tên theo thời điểm, nên không giẫm lên dữ liệu thật):

```bash
CHAT_TEST_MONGODB_URI="<chuỗi kết nối>" npm run verify:chat
```

---

## 6. Kho Redis cũ — đã đóng

Trước 08/08/2026 tin đàm đạo sống ở Upstash Redis. Ngày 09/08/2026 kho ấy bị xoá và script
chuyển dữ liệu (`scripts/migrateChatToMongo.mts`) cùng dependency `@upstash/redis` được dọn
theo — giữ lại một script chỉ chạy được với một kho không còn tồn tại là giữ một cái bẫy cho
người đọc sau.

Muốn xem nó từng làm gì thì tra lịch sử git; mục 0.40.0 của [CHANGELOG](../CHANGELOG.md) kể
vì sao đổi kho.

---

## Trục trặc thường gặp

**Sảnh vẫn treo biển「chưa khai mở」**
`MONGODB_URI` chưa có trong môi trường của bản deploy ĐANG chạy. Kiểm ở Settings →
Environment Variables, rồi deploy lại — thêm biến thôi thì bản cũ vẫn không thấy.

**Sảnh trả 500 thay vì treo biển**
Đây là phân biệt CỐ Ý: *thiếu cấu hình* mới là「chưa khai mở」; *có cấu hình mà kết nối
hỏng* thì để lỗi nổ ra kèm nguyên văn. Báo「chưa khai mở」cho một kho đang hỏng là dán nhãn
sai lên sự cố và giấu mất manh mối duy nhất. Xem log function để biết lý do thật — thường là
sai mật khẩu, hoặc IP chưa được Atlas cho qua.

**Atlas chặn IP**
Integration của Vercel tự mở `0.0.0.0/0` cho project. Nếu dựng Atlas bằng tay thì phải tự
thêm vào Network Access — function của Vercel không có IP cố định.

**`querySrv ECONNREFUSED` khi chạy ở máy nhà**
Resolver DNS của máy đó không trả lời truy vấn SRV mà `mongodb+srv://` cần (dù `nslookup`
vẫn ra). Không phải lỗi của project — trên Vercel không gặp. Cách qua: đổi DNS máy sang
`8.8.8.8`, hoặc chạy script qua một wrapper gọi `dns.setServers(["8.8.8.8"])` trước.
