# Hướng dẫn dùng Auto HH3D

Auto này cày hộ bạn ở hoathinh3d: Mê Cung, Luyện Đan Đường, và các nhiệm vụ ngày.
Bấm nút một lần rồi tắt trình duyệt đi làm việc khác, auto vẫn chạy tiếp.

Web: <https://auto-hh3d.vercel.app>

---

## 1. Vào được đã

1. Vào trang, bấm **Bái sư** để đăng ký đạo hiệu, danh xưng và email.
2. Tuỳ tông chủ đang để cổng thế nào — chính trang bái sư nói rõ bạn rơi vào đường nào:
   - **Còn xét duyệt:** chờ tông chủ duyệt, trong lúc đó bạn chỉ thấy phòng chờ.
   - **Cổng đang mở:** bái sư xong là vào thẳng **Auto**, không phải chờ ai.
3. Vào được Auto rồi thì làm mọi thứ ở đó.

---

## 2. Ba bước để chạy

### Bước 1 — Đưa tài khoản game cho auto

Auto cần đăng nhập game thay bạn, nên nó cần **chuỗi cookie** của tài khoản.
Không phải mật khẩu. Bạn không đưa mật khẩu cho ai cả.

**Lấy cookie trên máy tính (Chrome / Edge / Cốc Cốc):**

1. Đăng nhập hoathinh3d như bình thường.
2. Nhấn `F12` để mở bảng công cụ.
3. Chọn tab **Application** (hoặc **Ứng dụng**).
4. Cột trái, mở **Cookies** → bấm vào dòng `https://hoathinh3d.am`.
5. Tìm dòng có tên bắt đầu bằng `wordpress_logged_in_`. Đây là dòng quan trọng nhất.
6. Copy cả **Name** và **Value** của nó, ghép lại theo dạng `tên=giá_trị`.

Dán vào ô **Tài khoản hoathinh3d** rồi bấm **Khắc Ngọc Giản**.

> Cách nhanh hơn: cài tiện ích **Cookie-Editor**, bấm **Export → JSON**, rồi dán nguyên
> cả cục vào ô đó. Auto đọc được cả hai kiểu.

Lưu xong bạn sẽ thấy dòng **Đã lưu tài khoản (đã mã hoá)**, kèm số cookie nhận được.
Nếu nó báo *không thấy cookie đăng nhập*, nghĩa là bạn copy thiếu dòng
`wordpress_logged_in_...` — làm lại bước 5.

**Vài điều nên biết:**

- Chuỗi này được mã hoá khi lưu, và không bao giờ hiện lại trên màn hình.
- Đăng nhập game ở máy khác, trình duyệt khác: **không sao**.
- **Bấm Đăng xuất** trong game thì cookie chết, phải lấy lại chuỗi mới.
- Cookie cũng tự hết hạn sau một thời gian. Khi auto báo hết phiên, lấy lại là xong.
- **hoathinh3d đổi tên miền** (ví dụ `.am` → `.one`) thì cookie cũ cũng chết theo — cookie
  gắn chặt vào tên miền, không đi theo được. Lúc ấy vào tên miền MỚI lấy chuỗi mới rồi dán
  lại. Tông chủ sẽ cập nhật tên miền cho cả tông môn; việc của bạn chỉ là dán lại cookie.

### Bước 2 — Chọn nhiệm vụ

Tick những cái bạn muốn auto làm.

| Nhiệm vụ | Ghi chú |
|---|---|
| **Mê Cung** | Auto tự lập phòng, chờ đủ 5 người, rồi đánh. Đây là nhiệm vụ dài nhất. |
| **Luyện Đan Đường** | Thu đan → phân giải → khai lò mẻ mới → giữ lửa. Ghé lại mỗi ~26 phút. |
| **Nhiệm vụ ngày** | Điểm Danh, Hoang Vực, Phúc Lợi Đường, Thí Luyện, Bí Cảnh, Tế Lễ, Phúc Lợi VIP, Vòng Quay, Vấn Đáp, Khoáng Mạch. Tick là xong, không phải chỉnh gì. Bảy mục trong số này (Điểm Danh, Hoang Vực, Phúc Lợi Đường, Thí Luyện, Vòng Quay, Tế Lễ, Vấn Đáp) có flow riêng cho tài khoản thường; Mê Cung và Luyện Đan Đường chạy được cho cả hai hạng. |

Riêng **Vấn Đáp**, khôi lỗi tra danh sách đáp án cộng đồng (hiện đọc được 255 câu).
Nó chỉ trả lời khi đáp án trong danh sách khớp đúng một lựa chọn đang hiện; câu lạ hoặc nguồn
mâu thuẫn sẽ được để lại cho bạn, không hỏi Gemini và không đoán bừa. Nếu đã cài khôi lỗi trước
v0.19.0, hãy bấm **Tạo bộ cài cho máy của tôi** và cài đè một lần để nhận cả kho Vấn Đáp lẫn
heartbeat 5 giây — không cần gỡ bản cũ hay phát linh phù mới.

Mê Cung có vài tuỳ chọn đáng để ý:

- **Trục xuất theo HP** — ai yếu hơn mức này thì mời ra để nhường chỗ. Để `0` là không đuổi ai.
- **Trục xuất nếu không sẵn sàng sau (giây)** — ai vào phòng mà ngồi lì không bấm sẵn sàng
  thì mời ra, kẻo kẹt phòng. Để `0` là không giục.
- **Dừng khi đã đủ huyền tinh** — bỏ tick nếu muốn đánh hết lượt trong ngày.

Auto tự biết tài khoản bạn là VIP hay thường, rồi chọn đúng flow của hạng đó. Với tài khoản
thường: Phúc Lợi Đường mở một rương mỗi lượt rồi tự quay lại sau 30 phút, Thí Luyện mở rương
thí luyện theo cùng nhịp 30 phút (3 lượt/ngày), Tế Lễ dâng 10 Tinh Thạch một lần mỗi ngày,
còn Vòng Quay sẽ ghé lại ở vòng sau để nhận lượt thứ tư khi các nhiệm vụ ngày khác đã đủ
điều kiện. Các nhiệm vụ thường nằm ngay trong tab **Tài khoản thường**; bật/tắt ở đó sẽ đồng
bộ với công tắc cùng tên bên tab VIP, nên bạn không phải cấu hình hai lần. Mê Cung đứng
ngoài hai tab — một bộ tuỳ chọn dùng chung cho cả hai hạng. Riêng **Luyện Đan Đường** mỗi
tab có một bản tuỳ chọn riêng: loại đan và mức phân giải chỉnh trong tab VIP chỉ áp cho tài
khoản VIP, bản trong tab Thường chỉ áp cho tài khoản thường — chỉnh bên này không đè bên kia.

Chọn xong nhớ bấm **Khắc Ngọc Giản**.

### Bước 3 — Khai Đàn

Bấm **Khai Đàn**. Xong. Auto tự canh thời gian chờ rồi chạy hết vòng này sang vòng khác;
không cần quay lại bấm Khai Đàn sau mỗi vòng. Tắt trình duyệt đi ngủ cũng được.

Nhưng nhớ một điều: **tắt máy thì tuỳ ai đang chạy hộ bạn.** Khôi lỗi tông môn nằm ở máy
khác nên vẫn chạy tiếp; còn khôi lỗi cài trên máy bạn thì tắt máy là nghỉ theo. Xem mục 3
để biết mình đang thuộc trường hợp nào.

Mở lại trang lúc nào cũng thấy auto đang làm tới đâu, trong khung **Nhật ký tu luyện**.
Muốn dừng hẳn thì bấm **Thu Đàn** — auto dừng ở điểm an toàn gần nhất, không cắt ngang trận.

Khi cạnh tiêu đề nhật ký hiện **● Trực tiếp**, trạng thái và từng dòng khôi lỗi kể được đẩy lên
ngay, không phải chờ trang hỏi lại. Mạng chập chờn thì nó tự hiện **Đang nối lại…** và dùng nhịp
dự phòng; bạn không cần F5. Cài đè khôi lỗi v0.19.0 một lần để nút Thu Đàn được máy đang bận
nhận trong khoảng 5 giây thay vì nhịp 20 giây của bản cũ.

Nếu khôi lỗi máy nhà được cài trước v0.20.0, hãy tạo lại bộ cài và cài đè một lần để nhận ba
flow tài khoản thường mới. Cài đè giữ nguyên thư mục hồ sơ trình duyệt và không cần gỡ trước.

### Sửa hồ sơ và bổ sung email

Bấm **Hồ Sơ** trên thanh đầu trang để đổi danh xưng hiển thị hoặc email. Đạo hiệu đăng nhập
không đổi ở đây. Tài khoản tạo từ bản cũ có thể chưa có email; chỉ cần điền một lần rồi bấm
**Lưu Hồ Sơ**. Mỗi email chỉ dùng được cho một đạo hiệu.

### Khi tông môn bế quan trùng tu

Lúc trưởng môn khai bảo trì, **mọi trang đều đóng**: đạo hữu thấy một bảng「Tông môn đang bế quan
trùng tu」kèm đồng hồ đếm ngược, và bảng đó **không tắt được** — không có nút đóng, vì trong lúc
ấy không trang nào mở. Bảng chỉ có một nút duy nhất là **Xuất Quan**, cho ai muốn đăng xuất.

Không phải làm gì cả và không mất gì cả:

- Đàn đang chạy dở **vẫn hoàn thành nốt vòng** rồi nghỉ — khôi lỗi không bị cắt giữa nhiệm vụ.
- Mở cửa lại là **mọi đàn tự chạy tiếp**, không cần Khai Đàn lại.
- Bảng **tự biến mất** ngay khi cửa mở lại, không cần F5. Đạo hữu ở lại đúng trang đang muốn vào.

Trưởng môn và các vai trị sự thì vẫn đi lại được mọi trang trong lúc bảo trì — họ chỉ thấy một
dải nhắc mỏng trên đầu trang — vì công tắc tắt bảo trì nằm trong trang Tông Môn của họ.

### Đặt ảnh đại diện

Cũng trong trang **Hồ Sơ**, mục ở trên cùng: bấm **Chọn ảnh**, chọn một tấm PNG, JPEG, WebP
hoặc GIF. Ảnh hiện lên ngay cạnh tên bạn trong Phòng Chat và trên thanh đầu trang; chưa đặt
thì hệ thống vẽ chữ đầu của danh xưng trên một màu nền riêng của bạn. Bấm **Bỏ ảnh** là trở
về chữ đầu ấy.

Ảnh thường được **tự thu nhỏ ngay trên máy bạn** về 512px và cắt vuông ở giữa trước khi gửi
đi, nên chọn thẳng ảnh từ điện thoại cũng được, không cần cắt trước và không tốn nhiều mạng.
Riêng **GIF động thì được giữ nguyên** để không mất phần động, nên tấm GIF phải dưới 2MB.

Đổi ảnh là ảnh cũ bị xoá khỏi kho — không có chỗ nào giữ lại tấm trước đó. Ảnh không bị đóng
băng vào từng tin nhắn: đổi một lần là mọi tin cũ của bạn trong sảnh cũng mang mặt mới.

---

## 3. "Khôi lỗi" là gì, và khi nào bạn phải quan tâm

Khôi lỗi là người thật sự mở trình duyệt và chơi hộ bạn. Web chỉ ghi nhận ý muốn của bạn;
khôi lỗi mới là kẻ làm.

Trong mục **Khôi Lỗi** bạn sẽ thấy một trong hai:

**"Bạn không cần cài gì cả"** — có khôi lỗi tông môn trực sẵn, dùng chung cho mọi người.
Cứ Khai Đàn là chạy. Bỏ qua phần còn lại của mục này.

**"Chưa có khôi lỗi nào trực"** — bấm Khai Đàn lúc này thì đàn pháp phải nằm chờ.
Bạn có thể tự nuôi một khôi lỗi trên máy mình:

1. Bấm **Tạo bộ cài cho máy của tôi**.
2. Bấm **⬇ Tải bộ cài cho Windows**. Tệp `cai-linh-su.cmd` về thư mục Tải xuống.
3. Bấm đúp vào tệp đó. Windows hỏi thì chọn **Run anyway**.
4. Đợi vài phút. Xong thì tên khôi lỗi hiện ở danh sách, kèm chấm xanh.

Bạn **không cần cài Node.js hay phần mềm nào khác** — bộ cài mang sẵn mọi thứ, và không
cần quyền quản trị.

**Lưu ý quan trọng:** khôi lỗi máy nhà chỉ chạy khi máy bạn bật. Tắt máy là auto dừng.

**Gỡ đi:** chạy `uninstall.ps1` trong thư mục cài
(`%LOCALAPPDATA%\AutoHH3D\LinhSu`). Nó xoá sạch, máy trở lại như trước.

> **Đừng bấm "Phát linh phù mới" nếu không cần.** Nó thay chìa khoá, và khôi lỗi đang chạy
> sẽ lặng lẽ ngừng nhận việc cho tới khi bạn cài lại bằng bộ cài mới.

---

## 4. Khi có trục trặc

| Bạn thấy | Nghĩa là | Làm gì |
|---|---|---|
| *Chưa có tài khoản game* | Chưa dán cookie | Làm lại Bước 1 |
| *Chưa chọn nhiệm vụ nào* | Chưa tick nhiệm vụ nào | Tick rồi bấm Khắc Ngọc Giản |
| *Auto đang chạy* | Đang có lượt chạy dở | Bấm Thu Đàn trước |
| *Chuỗi cookie không đọc được* | Copy thiếu hoặc sai định dạng | Làm lại Bước 1, nhớ lấy dòng `wordpress_logged_in_` |
| *Tài khoản hoathinh3d đã hết phiên đăng nhập* | Cookie hết hạn, hoặc bạn đã đăng xuất game | Lấy cookie mới, dán lại |
| *Site đã dời tên miền: … sang …* | Game đổi tên miền, cookie cũ chết theo | Vào tên miền mới lấy cookie, dán lại |
| *Không xác nhận được phiên đăng nhập, và hub cũng không dựng nổi…* | Cookie chết, hoặc game đang chắn | Dán cookie mới; nếu vẫn vậy thì báo tông chủ |
| *Không có khôi lỗi nào tiếp nhận* | Không ai đang trực | Xem mục 3, cài khôi lỗi cho máy mình |
| *Màn kiểm tra của trang game không tự qua* | Game đang chặn bot | Chờ lượt sau, auto tự thử lại |
| Khôi lỗi chuyển sang **vắng** | Máy tắt, mạng rớt, hoặc bạn vừa phát linh phù mới | Bật máy lại, hoặc cài lại bằng bộ cài mới |

Nhật ký đầy quá thì bấm **Dọn nhật ký** cho sạch. Lịch sử cũ mất luôn, nhưng lượt đang
chạy không bị ảnh hưởng.

---

## 5. Hỏi nhanh đáp gọn

**Auto có cần mở trình duyệt của tôi không?**
Không. Bấm Khai Đàn xong là tắt trình duyệt được ngay.

**Thế tắt máy thì sao?**
Nếu khôi lỗi tông môn chạy hộ bạn thì không sao, nó nằm ở máy khác. Nếu bạn tự cài khôi lỗi
trên máy mình thì tắt máy là auto dừng, bật lại là nó tự trực tiếp.

**Tôi đổi sang trình duyệt khác thì sao?**
Chỉ cần đăng nhập lại vào web. Khôi lỗi không liên quan gì tới trình duyệt bạn dùng.

**Có phải đưa mật khẩu game không?**
Không bao giờ. Chỉ chuỗi cookie, và nó được mã hoá.

**Nhiều người cùng chạy một lúc được không?**
Được. Mỗi người một lượt riêng, không giẫm chân nhau.

**Auto chạy Mê Cung mất bao lâu?**
Chờ đủ người có thể vài chục phút, đánh xong tới 35 phút. Cứ để đó.

**Tôi vừa sửa cấu hình lúc auto đang chạy?**
Lượt đang chạy giữ cấu hình cũ. Lượt sau mới dùng bản mới.

**Thấy popup「đang bế quan trùng tu」?**
Tông chủ đang nâng cấp hệ thống. Popup có đồng hồ đếm ngược cho biết khi nào xong. Đàn đang
chạy dở sẽ hoàn thành nốt vòng rồi nghỉ — không mất gì; mở cửa lại là mọi đàn tự chạy tiếp,
bạn không phải bấm gì cả.

---

Có gì lạ thì nhắn trong **Phòng Chat** — kèm ảnh chụp nhật ký thì dễ xem giúp hơn.
