# Oracle Cloud (OCI) — truy cập, khôi lỗi tông môn, tàng khố media

Tông môn dùng **một** tài khoản OCI Always Free cho hai việc: nuôi **khôi lỗi tông môn** (worker
chạy 24/7) và giữ **tàng khố media** (file đính kèm đàm đạo). Tệp này là chỗ duy nhất chép
cách vào tài khoản ấy và cách phát hành lên nó — đọc từ trên xuống là đủ.

---

## 1. Truy cập OCI từ máy này

Có hai lối, và lối mặc định **không** phải lối hay được nghĩ tới trước.

### Lối nên dùng: profile `jarvis` (khoá API, không hết hạn)

```bash
oci os ns get --profile jarvis      # sống thì trả về: fr5enftxwrc3
```

Profile nằm trong `~/.oci/config`, ký bằng `~/.oci/jarvis_api_key.pem`:

| Trường | Giá trị |
|---|---|
| user | `ocid1.user.oc1..aaaaaaaab3xazdjv2mqzgn3kpglwr6fl2vnapcgfl2uadz7qr2qstsabzpja` (hanam.tranle.5@gmail.com) |
| tenancy | `ocid1.tenancy.oc1..aaaaaaaa7ja4sgwekszyo365l5uq7fdp6jfjuv2cxct6n6o34amuolvkfngq` |
| region | `eu-frankfurt-1` (home region) |
| fingerprint | `64:74:2f:93:7d:3e:8f:8f:ce:60:f6:e6:75:d1:40:a3` |

Khoá API **không hết hạn**, nên lối này dùng được trong mọi phiên mà không cần ai mở trình duyệt.

### Lối cũ: session token — hay chết, và chết thì không tự cứu được

`~/.oci/sessions/{DEFAULT,nampro,nampro8796}` là session token của `oci session authenticate`.
Chúng sống **tối đa 60 phút**, và quá hạn refresh thì `oci session refresh` trả lời dứt khoát:

```
Your session is no longer valid and cannot be refreshed.
```

Lúc ấy đường ra DUY NHẤT là `oci session authenticate` — một lần đăng nhập bằng mật khẩu + MFA
trên trình duyệt, tức **phải là đạo hữu tự làm**. Đó chính là lý do profile `jarvis` tồn tại:
để chuyện đó không bao giờ chặn một phiên làm việc nữa.

### Dựng lại profile `jarvis` khi mất

Nếu `~/.oci/config` mất mục `[jarvis]` nhưng cặp khoá còn:

```bash
openssl rsa -pubout -outform DER -in ~/.oci/jarvis_api_key.pem | openssl md5 -c   # fingerprint
```

Fingerprint khớp bảng trên nghĩa là khoá vẫn là khoá cũ — chép lại mục `[jarvis]` với đúng
các giá trị trong bảng là xong. Nếu OCI trả **401 `NotAuthenticated`** thì khoá công khai chưa
nằm trên user: Console → *My profile* → **API keys** → *Add API key* → **Paste a public key**,
dán `~/.oci/jarvis_api_key_public.pem`.

> **Bẫy đã trả giá:** OCID của user lấy được từ claim `sub` của một session token **đã hết hạn**
> (`cut -d. -f2 ~/.oci/sessions/DEFAULT/token | base64 -d`) — token chết vẫn đọc được danh tính.
> Nhờ đó không phải hỏi đạo hữu OCID.

---

## 2. Khôi lỗi tông môn — worker trên VM

Tiến trình `worker.mjs` chạy 24/7 trên VM Always Free, thay hoàn toàn Vercel Sandbox từ v0.11.
Nó cầm `WORKER_TOKEN` toàn cục nên nhận job của **mọi** thành viên; giữ token đó như giữ chìa
tàng khố — không bao giờ đưa cho người dùng (họ có linh phù riêng, phát ở mục Khôi Lỗi).

| Thông số | Giá trị |
|---|---|
| IP | `144.24.177.55` |
| SSH | `ssh -i ~/.ssh/jarvis_oci_ed25519 ubuntu@144.24.177.55` |
| service | `auto-hh3d-linh-su.service` |
| thư mục | `/opt/auto-hh3d/linh-su` |
| env | `/opt/auto-hh3d/linh-su/.env` (`WEB_URL`, `WORKER_TOKEN`, `WORKER_ID=tong-mon-linhsu`) |

### Cài đè engine mới (phát hành)

Chạy **sau khi Vercel đã `READY`** — `setup.sh` tải gói từ `WEB_URL/linh-su/goi-linh-su.tgz`,
mà gói ấy được đóng lại ở mỗi lần deploy. Deploy trước, cài sau; ngược lại là cài phải gói cũ.

```bash
ssh -i ~/.ssh/jarvis_oci_ed25519 ubuntu@144.24.177.55 \
  'sudo bash -c "set -a; . /opt/auto-hh3d/linh-su/.env; set +a; bash /home/ubuntu/setup.sh"'
```

Token đọc từ chính `.env` trên VM nên không phải mang bí mật qua máy khác. `setup.sh` idempotent.

**Chỉ chạy khi patch có đụng engine**, kiểm bằng:

```bash
git diff --stat <thẻ-cũ>..HEAD -- scripts/worker.mjs src/lib/quest-engine scripts/buildWorkerBundle.mjs
```

Trống thì **đừng chạy**: cài đè là restart service, và restart giữa chừng thì giết job đang chạy.
Số `version` trong `/opt/auto-hh3d/linh-su/package.json` thấp hơn web là **bình thường** — nó
là phiên bản của lần engine đổi gần nhất, không phải của lần deploy gần nhất.

### Vận hành

```bash
journalctl -u auto-hh3d-linh-su -f     # nhật ký sống
systemctl status auto-hh3d-linh-su     # trạng thái
systemctl restart auto-hh3d-linh-su    # khởi động lại
```

> **Journal KHÔNG mang mức `[info]`.** Mọi kết cục nhiệm vụ (ví dụ "Hoang Vực: đã hết 5 lượt
> hôm nay") chỉ sống trong bảng `job_events` ở Postgres — thứ dashboard hiển thị. Vắng mặt trên
> journal là **dấu hiệu tốt**, không phải dấu hiệu hỏng. Muốn kiểm một nhiệm vụ có chạy không
> thì truy `job_events`, đừng grep journal.

- **Xoay token**: đổi `WORKER_TOKEN` trên Vercel → chạy lại lệnh cài đè. Trong lúc hai bên lệch,
  worker chỉ bị 401 rồi tự thử lại — không hỏng gì.
- **Kiểm tra sống**: mục Khôi Lỗi trên dashboard hiện "Khôi lỗi tông môn — đang trực".

### Vì sao cấu hình VM là như vậy

| Lựa chọn | Giá trị | Lý do |
|---|---|---|
| Shape | **VM.Standard.A1.Flex** (Ampere ARM) | Always Free cho tới 4 OCPU + 24GB RAM cho A1 — dư sức nuôi Chromium. Hai con `VM.Standard.E2.1.Micro` (x86, 1GB) cũng free nhưng 1GB thì Chromium chết ngạt. |
| OS | **Ubuntu 24.04 LTS (aarch64)** | Distro được Playwright hỗ trợ chính thức: `playwright install-deps` biết đúng danh sách gói hệ thống; Chromium có bản linux-arm64. Oracle Linux thì phải tự mò danh sách thư viện. |
| Kích cỡ | 2 OCPU / 12GB | Một worker chỉ chạy MỘT browser một lúc. Lấy 4/24 cũng free nhưng vùng hay hết capacity A1 — yêu cầu càng nhỏ càng dễ được cấp. |
| Mạng | Chỉ mở SSH (22) | Worker chỉ gọi RA (HTTPS tới web + game). Không cổng nào cần mở vào. |

### Dựng lại VM từ đầu (một lần)

1. **Compute → Instances → Create instance**: image **Canonical Ubuntu 24.04 aarch64**, shape
   **Ampere VM.Standard.A1.Flex** 2 OCPU/12GB, VCN mặc định, **Assign public IPv4**, dán SSH
   public key. *Báo "Out of capacity" thì thử giờ khác, giảm về 1 OCPU/6GB, hoặc đổi AD.*
2. Chờ **Running**, ghi lại public IP. Security list mặc định đã chỉ mở 22 — đúng ý.
3. `scp` [setup.sh](setup.sh) lên VM rồi:

```bash
WEB_URL='https://auto-hh3d.vercel.app' WORKER_TOKEN='<WORKER_TOKEN trên Vercel>' \
  sudo -E bash setup.sh
```

Gói mang sẵn playwright-core nên setup không cần `npm install`; Chromium tải bằng chính `cli.js`
của bản ấy. Thư viện hệ thống cài bằng root còn browser tải về cache của user `linhsu` — **tách
hai bước là cố ý**: gộp một lệnh thì browser rơi vào cache của root và worker mù.

---

## 3. Tàng khố media — Object Storage

Bytes của file đính kèm đàm đạo. Trước 08/08/2026 chỗ này là Vercel Blob; xem
[services/media.ts](../../src/lib/services/media.ts) để biết vì sao đổi và ghi/đọc bằng đường nào.

| Thông số | Giá trị |
|---|---|
| bucket | `jarvis-media` |
| namespace | `fr5enftxwrc3` |
| region | `eu-frankfurt-1` |
| truy cập | `ObjectReadWithoutList` — ai có URL thì đọc được, **không** ai liệt kê được bucket |
| khoá S3 | Customer secret key tên `jarvis-media-s3` trên user ở mục 1 |

Web nói với kho qua **lớp tương thích S3**, còn trình duyệt đọc bằng URL gốc:

```
https://objectstorage.eu-frankfurt-1.oraclecloud.com/n/fr5enftxwrc3/b/jarvis-media/o/{tên object}
```

### Biến môi trường (đã đặt trên Vercel, cả 3 môi trường)

`OCI_REGION`, `OCI_NAMESPACE`, `OCI_BUCKET`, `OCI_ACCESS_KEY_ID`, `OCI_SECRET_ACCESS_KEY`.

Đặt **đủ cả 5 hoặc không đặt gì**: thiếu hết = "kho chưa khai mở" (đính kèm tạm nghỉ, chat chữ
vẫn chạy); thiếu một nửa = ném ngay kèm tên biến còn thiếu.

### Trần dung lượng

Bucket OCI **co giãn, không có dung lượng để đặt**. Trần thật nằm ở quota cấp tenancy:

```
Set object-storage quota storage-bytes to 20401094656 in tenancy    # 19 GiB
```

Chính sách tên `jarvis-object-storage-always-free`. Con số là **19 GiB, dưới hạn Always Free
20 GiB của cả tenancy** — cố ý chừa 1 GiB, và cố ý đặt ở **tenancy** chứ không ở một compartment
con: hạn 20 GiB là hạn của cả tenancy, nên quota bó trong compartment con sẽ không thật sự
chặn được việc vượt hạn.

```bash
oci limits quota list --compartment-id <tenancy-ocid> --profile jarvis
```

### Xoay khoá S3

Console → *My profile* → **Customer secret keys** → tạo khoá mới (tối đa 2 khoá/user) → cập nhật
`OCI_ACCESS_KEY_ID` + `OCI_SECRET_ACCESS_KEY` trên Vercel → xoá khoá cũ.

> **Bẫy đã trả giá:** khoá mới cần **~2 phút** mới hiệu lực, và trong lúc chờ, OCI trả
> `SignatureDoesNotMatch` kèm câu *"The secret key required to complete authentication could not
> be found"* — đọc như lỗi ký sai, thực ra là lỗi **chưa lan tới nơi**. Tệ hơn: nó lan **không
> đều**, nên sẽ có giai đoạn request lúc được lúc không. Đừng đi sửa code lúc ấy; thử lại là hết.

### Kiểm chứng

```bash
npm run verify:media
```

Không có `OCI_*` thì chỉ chạy phần không cần mạng và **nói rõ là đã bỏ qua phần còn lại**. Có đủ
biến thì chạy trọn vòng đời trên bucket thật: tải lên → tải về bằng HTTPS công khai → so từng
byte → xoá. Object thử luôn bị dọn, kể cả khi một phép thử ở giữa ném.

---

## 4. Rủi ro cần biết trước

- **IP datacenter**: site game nằm sau Cloudflare, và IP dải Oracle có thể bị thử thách gắt hơn
  IP dân cư. Engine có ReadinessProbe phát hiện màn chặn Cloudflare và thuật lại vào nhật ký job
  — thấy dòng đó lặp nhiều thì đường lui là khôi lỗi máy nhà (IP dân cư, cài từ mục Khôi Lỗi).
- **Thu hồi Always Free**: Oracle có quyền thu hồi instance A1 của tài khoản Free Tier khi vùng
  thiếu tài nguyên (hiếm, nhưng có). Nâng lên Pay As You Go (vẫn không mất phí trong hạn mức
  Always Free) thì hết bị.
- **Vượt 20 GiB Object Storage** ở tài khoản Free Tier: quota ở mục 3 chặn trước khi chạm hạn,
  nên tình huống "hết hạn dùng thử là object bị xoá" không xảy ra. Bỏ quota đi thì mất lưới ấy.
