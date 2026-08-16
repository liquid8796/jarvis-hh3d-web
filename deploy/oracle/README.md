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
| fingerprint | `e9:4b:11:60:e2:3a:04:70:ec:be:07:1f:ea:f3:5f:d2` |

Khoá API **không hết hạn**, nên lối này dùng được trong mọi phiên mà không cần ai mở trình duyệt.

> Trên user còn một khoá cũ `64:74:2f:93:…` (10/08/2026 vẫn ACTIVE) mà **phần riêng đã thất
> lạc** — nó là fingerprint tệp này ghi trước đây. Giữ lại vì không loại trừ được khả năng
> `.pem` của nó nằm ở một máy khác; đừng lấy nó ra dùng, và đừng tưởng gặp nó là gặp profile
> đang chạy.

**Khoá mới cần ~45 giây mới hiệu lực, và lan không đều giữa các endpoint.** Vừa upload xong mà
gọi ngay thì OCI trả **401 `NotAuthenticated`** — đọc y hệt lỗi "khoá chưa nằm trên user" ở mục
dựng lại bên dưới, nhưng là lỗi **chưa lan tới nơi**. Tệ hơn: object-storage nhận khoá trước,
còn `instance-agent` thì sau, nên sẽ có giai đoạn lệnh này chạy được mà lệnh kia vẫn 401. Đúng
cái bẫy đã ghi cho khoá S3 ở mục 3 — hoá ra khoá API cũng vậy. Thử lại là hết, đừng đi sửa cấu hình.

### Lối cũ: session token — hay chết, và chết thì không tự cứu được

Mỗi thư mục con trong `~/.oci/sessions/` là một session token của `oci session authenticate`
(10/08/2026 trên máy làm việc: `linhsu-bootstrap`, `jarvis-session`).
Chúng sống **tối đa 60 phút**, và quá hạn refresh thì `oci session refresh` trả lời dứt khoát:

```
Your session is no longer valid and cannot be refreshed.
```

Lúc ấy đường ra DUY NHẤT là `oci session authenticate` — một lần đăng nhập bằng mật khẩu + MFA
trên trình duyệt, tức **phải là đạo hữu tự làm**. Đó chính là lý do profile `jarvis` tồn tại:
để chuyện đó không bao giờ chặn một phiên làm việc nữa.

### Dựng lại profile `jarvis` khi mất

Phần dưới chỉ dùng được **khi cặp khoá còn**. Mất `~/.oci/jarvis_api_key.pem` thì không có
đường vá: khoá riêng không tái tạo được từ khoá công khai đang nằm trên OCI, nên dù Console
vẫn hiện fingerprint cũ ACTIVE, nó đã thành một dòng chết. Lúc ấy phải đi lối trình duyệt
đúng một lần rồi tự đúc khoá mới:

```bash
oci session authenticate --region eu-frankfurt-1 --profile-name jarvis-session
openssl genrsa -out ~/.oci/jarvis_api_key.pem 2048
openssl rsa -pubout -in ~/.oci/jarvis_api_key.pem -out ~/.oci/jarvis_api_key_public.pem
oci iam user api-key upload --user-id <user OCID ở bảng trên> \
  --key-file ~/.oci/jarvis_api_key_public.pem --profile jarvis-session --auth security_token
```

Rồi chép mục `[jarvis]` với fingerprint mà lệnh upload trả về, và nối thêm một dòng
`OCI_API_KEY` vào cuối tệp `.pem` — thiếu nó thì mọi lệnh đều kèm một dòng cảnh báo nhiễu mắt.
Đặt tên session là
`jarvis-session` chứ **không** phải `jarvis`: hai profile phải sống cạnh nhau trong lúc chuyển,
trùng tên là mục khoá-API bị session token đè mất. Mỗi user tối đa **3 khoá API**, nên còn chỗ
cho một lần đúc mà chưa cần xoá gì.

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

## 2. VM OCI — máy chung của tông môn

| Thông số | Giá trị |
|---|---|
| tên | `jarvis-oci-01` (hostname `jarvis01`) |
| IP | **`92.5.130.32`** — public IP **RESERVED**, thuộc về tài khoản chứ không thuộc về máy |
| SSH | `ssh -i ~/.ssh/jarvis_oci_ed25519 ubuntu@92.5.130.32` |
| shape | `VM.Standard.A1.Flex` — 4 OCPU / 24 GB / 4 Gbps |
| đĩa | boot volume **100 GB**, VPU 10 |
| OS | Ubuntu 24.04 LTS aarch64 |
| vị trí | `eu-frankfurt-1`, AD-1, FAULT-DOMAIN-2 |
| vai trò | **BACKEND CHÍNH THỨC của tông môn** (từ 16/08/2026 — xem mục 2b) |

## 2b. Backend trên VM — kiến trúc từ 16/08/2026

Cùng ngày dựng lại máy, tông chủ quyết: **backend + database rời hẳn Vercel/Neon/Atlas về
đây.** App Next.js (UI + API) chạy trọn trên VM sau Caddy; 5 trạm Vercel chỉ còn là vỏ proxy
(xem `deploy/vercel-proxy/README.md`); khôi lỗi GitHub gọi thẳng VM.

| Mảnh | Ở đâu |
|---|---|
| app | systemd `jarvis-web` — `/opt/jarvis/app` (symlink → `/opt/jarvis/releases/<sha>`) |
| env | `/opt/jarvis/shared/.env` (jarvis-only 600; mỗi release symlink `.env` về đây) |
| TLS | Caddy, `https://92.5.130.32.sslip.io` (Let's Encrypt HTTP-01 qua sslip.io) |
| Postgres 17 | localhost:5432, db/role `jarvis`, mật khẩu `/etc/jarvis/pg-password` (root-only) |
| MongoDB 8.0 | localhost:27017, db `jarvis` (tên theo nấc mặc định của `dbName.ts`) |
| cron | systemd `jarvis-cron.timer` 03:00 UTC → `/api/cron` với `CRON_SECRET` — thay Vercel Cron |
| media | vẫn Object Storage `jarvis-media` (mục 3) — không đổi |

Phát hành: `npm run deploy:all` (= `deploy:backend`) từ máy nhà. Ops đụng DB (`roster:purge`,
`github:deploy`, `db:migrate`, `verify:*`): `npm run vm -- <lệnh>` — DB chỉ nghe 127.0.0.1,
cố ý không mở cổng ra internet, nên các script ấy phải ĐỨNG TRÊN VM. Dựng lại nền từ đầu:
`setup-backend.sh` (idempotent) rồi `deploy:backend`.

> Mục 2 cũ bên dưới giữ lại nguyên vẹn phần mô tả khôi lỗi vì **nó vẫn đúng cho 6 khôi lỗi
> GitHub** (cùng `worker.mjs`, cùng `WORKER_TOKEN`, cùng luật phân công) và vì đó là công
> thức dựng lại nếu có ngày cần một khôi lỗi trên VM nữa. Đọc nó như tài liệu về WORKER.
>
> Ba hệ quả đã kiểm, không phải suy đoán:
> - **Đàn không kẹt.** `services/dispatch.ts` có cửa `ONLINE_WINDOW_MS`, khôi lỗi im lặng tự
>   rơi khỏi vòng phân công; lúc xoá máy không đàn nào đang chạy.
> - **`tong-mon-khoiloi` còn một dòng cũ trong sổ điểm danh** — vô hại, gỡ bằng `npm run roster:purge`.
> - **IP CŨ `144.24.177.55` MẤT VĨNH VIỄN.** Nó là ephemeral, và OCI không cho chuyển ephemeral
>   thành reserved — xoá máy là trả địa chỉ về pool. Địa chỉ mới đặt RESERVED chính vì vậy: lần
>   sau dựng lại máy thì gắn lại đúng IP ấy, không phải sửa tài liệu và `~/.ssh` thêm lần nào.

### Khôi lỗi — cách worker chạy (nay là 6 kho GitHub; VM từng chạy tới 16/08/2026)

Tiến trình `worker.mjs` chạy 24/7, thay hoàn toàn Vercel Sandbox từ v0.11.
Nó cầm `WORKER_TOKEN` toàn cục nên nhận job của **mọi** thành viên; giữ token đó như giữ chìa
tàng khố — không bao giờ đưa cho người dùng (họ có linh phù riêng, phát ở mục Khôi Lỗi).

| Thông số | Giá trị (khi chạy trên VM) |
|---|---|
| service | `auto-hh3d-linh-su.service` |
| thư mục | `/opt/auto-hh3d/linh-su` |
| env | `/opt/auto-hh3d/linh-su/.env` (`WEB_URL`, `WORKER_TOKEN`, `WORKER_ID=tong-mon-khoiloi`) |
| drop-in | `/etc/systemd/system/auto-hh3d-linh-su.service.d/override.conf` — `MemoryMax=18G`, `WORKER_MAX_JOBS=2`, `TimeoutStopSec=2400`, `WORKER_DRAIN_TIMEOUT_MS=2100000`. **Không** có trong `.env` và **không** có trong `setup.sh` (script chỉ viết lại unit chính), nên soi hai chỗ ấy sẽ tưởng nhầm là 4G. Tệp ấy mang sẵn một khối bình chú dài kèm số đo — đọc nó trước khi vặn. |

**Mức song song, hai tầng:** 2 đàn cùng lúc (`WORKER_MAX_JOBS`), mỗi đàn chạy nhiệm vụ TUẦN TỰ
(nhánh song song trong một đàn đã gỡ 12/08/2026 để Mê Cung luôn là nhiệm vụ cuối), nên trần thật
của cả tiến trình là **2 nhiệm vụ** chạy một lúc. Cổng toàn cục trong `questGate.mjs` (2 trang
riêng + 5 hub) vẫn còn nhưng ở mức ghế này nó không bao giờ chạm trần — nó là lưới cho ngày ai
đó nâng ghế lên lại.

> **`WORKER_QUEST_TABS` KHÔNG tồn tại trong mã (soát 14/08/2026).** Không dòng nào đọc biến ấy —
> `process.env.WORKER_*` chỉ có TOKEN, ID, POLL_MS, HEARTBEAT_MS, MAX_JOBS, MAX_LIFETIME_MS,
> DRAIN_TIMEOUT_MS, PROFILE_MAX_AGE_DAYS. Nó là di sản của thời còn chạy song song trong một
> đàn; đặt nó bằng 3 hay 400 đều không đổi gì. Đã gỡ khỏi bảng trên để người sau khỏi vặn một
> cái núm không nối vào đâu.

> **Vì sao 2 ghế (14/08/2026):** ghế là thứ CHIA việc giữa các máy, và từ bản này việc được chia
> theo LUÂN PHIÊN chứ không phải "ai hỏi trước lấy trước" — xem `src/lib/services/dispatch.ts`.
> Máy chủ giữ trần ghế của từng khôi lỗi trong sổ điểm danh (`workers.max_jobs`, do chính tiến
> trình khai ở mỗi lượt gõ cửa), nên nó biết ai còn chỗ mà không phải đoán. Hai ghế đều nhau cho
> mọi khôi lỗi — VM, `github-khoiloi`, các khôi lỗi trọ — là cách nói "không máy nào là máy
> chính": thêm một máy vào tông môn là thêm đúng 2 suất, và bộ cân tải tự trải việc sang nó ngay
> từ vòng kế (khôi lỗi chưa từng được giao việc đứng ĐẦU hàng luân phiên).
>
> Lịch sử: 12/08/2026 VM ở 3 ghế còn Actions 2 — hồi ấy không có tầng phân công nên số ghế là
> núm duy nhất để nhường việc giữa hai máy. Nay bộ cân tải làm việc ấy tử tế hơn hẳn, và con số
> ghế trở lại đúng nghĩa của nó: trần RAM của một cái máy.

**Dừng ÊM, không chém (thêm 12/08/2026).** `worker.mjs` nghe `SIGTERM` rồi vào pha rút lui: thôi
nhận việc mới, chờ đàn đang chạy đi nốt vòng, rồi thoát sạch. Trước bản này pha ấy **chưa bao giờ
dùng được trên VM**, và phải sửa BA thứ mới xong — thiếu bất kỳ cái nào là cả cơ chế vẫn vô dụng:

```
KillMode=mixed                   SIGTERM chỉ tới tiến trình CHÍNH
WORKER_DRAIN_TIMEOUT_MS=2100000  worker tự bỏ cuộc ở phút 35
  <  TimeoutStopSec=2400         systemd SIGKILL ở phút 40
```

- **`KillMode=mixed` là mảnh khó thấy nhất, và là mảnh quyết định.** Mặc định của systemd là
  `control-group`: `SIGTERM` gửi cho MỌI tiến trình trong cgroup, tức cả Chromium. Worker vẫn in
  đúng câu「Thu đàn: nhận SIGTERM」rồi ngồi chờ — trong khi trình duyệt của những đàn ấy đã chết
  ngay dưới chân nó. **Đo thật 13/08/2026:** lượt restart đầu tiên đi theo lối "êm" vẫn sinh 12
  dòng `page.goto/page.reload: Target page, context or browser has been closed` đúng giây gửi tín
  hiệu, trải khắp hai đàn VM đang giữ. Thiệt hại dừng ở đó — **không đàn nào chết**, vì worker
  còn sống nên vẫn kết thúc hai vòng ấy tử tế rồi xếp lại hàng; `reapStaleJobs` chỉ kết liễu khi
  nhịp tim TẮT HẲN. Mất là mất phần nhiệm vụ còn lại của vòng đang chạy, cộng một lượt cooldown
  dài hơn. Dấu hiệu nhận ra lần sau: nhật ký CÓ câu thu đàn mà VẪN có chùm „browser has been
  closed" đúng giây ấy.

  > **Đã đo, và kết quả KHÔNG tròn — ghi ra đây thay vì làm tròn.** Lượt restart thứ hai (đã có
  > `KillMode=mixed`) rơi trúng lúc VM giữ 1 đàn đang chạy Hỷ Sự Đường: chỉ còn **1** dòng
  > „browser has been closed" thay vì 12, đàn vẫn kết thúc vòng (`Đi hết một vòng — 3 thuận,
  > 3 trắc trở`) và không đàn nào chết. Nhưng 1 chưa phải 0, và dòng ấy rơi đúng GIÂY vòng chạy
  > kết thúc — có thể là một cuộc đua lúc dọn trình duyệt cuối vòng (không liên quan systemd),
  > cũng có thể là một đường còn sót. Phân biệt được hai khả năng ấy cần thêm vài lượt restart
  > trúng lúc có đàn; **chưa làm**. Mốc so sánh để ai đó soi tiếp: trong 3 giờ vận hành bình
  > thường trước đó, `job_events` KHÔNG có một dòng „has been closed" nào — nên dòng lẻ ấy vẫn
  > thuộc về lượt restart, không phải tiếng ồn nền.
- **Hai mốc thời gian phải theo thứ tự app-trước-nền-tảng**, cùng lối với bộ 290+50 < 350 < 360
  bên Actions: hết 35 phút mà còn đàn dở thì worker tự thoát kèm dòng nói rõ「còn N đàn chưa
  xong」, thay vì bị `SIGKILL` câm lặng ở phút 40.

Hệ quả cần biết, và nó đổi hẳn cảm giác khi vận hành: `systemctl restart` giờ **không trả lệnh về
ngay** — nó chờ hết pha rút lui. Dùng `--no-block` nếu không muốn ngồi đợi, rồi soi
`systemctl is-active` (`deactivating` = đang thu đàn). **Điều này áp cho cả `setup.sh`**, vì bước
đầu của nó là `systemctl stop`: một lượt cài đè lúc VM đang cày nay có thể đứng im tới 35 phút
thay vì xong trong một phút. Đó là cái giá của việc không chém đàn ai — nhưng biết trước thì
không hoảng, và ai cần gấp thì `systemctl kill -s SIGKILL` vẫn còn đó (chấp nhận mất vòng).

> **Trần thật của máy thấp hơn trần mã, và CPU mới là thứ chạm trần trước.** `worker.mjs` kẹp
> `WORKER_MAX_JOBS` trong `[1,8]`, nhưng 8 ghế thì gãy: đo ngày 10/08/2026 với 8 tài khoản cày
> cùng lúc — **load average 14,02 trên 4 vCPU** (vượt 3,5 lần) và đang tăng, `0,0% id`,
> `0,0% wa`, 58 tiến trình `headless_shell`. Hậu quả không phải lý thuyết: 8 dòng timeout trong
> 15 phút và một đàn `failed`.
>
> Dạng lỗi đáng thuộc mặt, vì nó **không trông giống lỗi CPU chút nào**:
>
> ```
> page.click: Timeout 6000ms exceeded
>   | waiting for element to be visible, enabled and stable
> ```
>
> Playwright chờ phần tử đứng yên qua hai khung hình liên tiếp; máy đói CPU thì khung hình bò ra
> chậm, nên phép chờ hết giờ **dù trang không hề hỏng**. Gặp dòng này thì soi `uptime` trước,
> đừng đi đổ cho site game đổi giao diện.
>
> Cùng lúc ấy `MemoryPeak` mới 3,8 GB — **20%** của trần 18G, và OOM chưa xảy ra lần nào. RAM
> chưa bao giờ là chỗ nghẽn trên máy này; mọi lần vặn hãy vặn theo CPU.
>
> Và phải vặn ở **tầng 1** chứ không phải tầng 2: cổng chỉ điều tiết số *nhiệm vụ*, không điều
> tiết số *trình duyệt*. Mỗi ghế giữ một trình duyệt riêng vẫn vẽ vẫn chạy timer kể cả khi tab
> của nó đang xếp hàng — đó là chỗ phép nhân thoát khỏi tầm với của cổng.

### Mất khoá SSH thì vào lại bằng gì

Đã trả giá ngày 10/08/2026: `~/.ssh/jarvis_oci_ed25519` biến mất khỏi máy làm việc, và cổng 22
trả `Permission denied (publickey)` — VM sống nhăn nhưng không ai vào được. Đường ra:

**Đừng đụng tới Run Command.** Plugin `Compute Instance Run Command` mang `desired-state:
ENABLED` trong `agent-config` của instance này, nhưng agent **chưa bao giờ báo nó về** — nó
không nằm trong 10 plugin agent liệt kê, kể cả sau reboot. Lệnh gửi qua `instance-agent command
create` sẽ nằm `ACCEPTED`/`VISIBLE` vĩnh viễn, `time-updated` không nhúc nhích. `agent-config`
là **ý muốn**, không phải hiện thực; muốn biết hiện thực thì hỏi:

```bash
oci instance-agent plugin list --compartment-id <tenancy> --instanceagent-id <instance OCID> --all
```

**Bastion mới là cần cẩu**, vì agent CÓ liệt kê nó (dù `STOPPED`) — plugin agent biết mặt thì
bật được, plugin nó chưa từng nhắc tới thì không.

1. Bật plugin: `oci compute instance update --instance-id <id> --agent-config …` với
   `pluginsConfig: [{name:'Bastion', desiredState:'ENABLED'}]`. Gửi **trọn** object agent-config
   kể cả `isManagementDisabled`/`isMonitoringDisabled`, thiếu trường là reset nhầm thứ khác.
2. **Reboot.** Đây là mấu chốt và không hiển nhiên: agent chỉ nạp plugin mới **lúc khởi động**.
   Bật rồi ngồi đợi thì đợi mãi — đã đo 8 phút cho Run Command và 8 phút cho Bastion, không
   nhúc nhích; reboot xong thì Bastion `RUNNING` ngay ở lần dò đầu tiên, ~100 giây sau lệnh.
   Reboot an toàn vì unit có `Restart=always` + `WantedBy=multi-user.target` và `setup.sh` chạy
   `systemctl enable --now` — khôi lỗi tự đứng dậy. Nhưng **khai bảo trì và chờ「đang chạy」về 0**
   trước đã, kẻo cắt ngang đàn của người ta.
3. Dựng bastion trong **đúng subnet của VM**, `--client-cidr-list` bó vào IP của máy mình, rồi
   `oci bastion session create-managed-ssh --target-os-username ubuntu --ssh-public-key-file <pub>`.
   Session kết thúc ở **`ACTIVE`**, không phải `SUCCEEDED` — `--wait-for-state SUCCEEDED` sẽ
   quay vô ích tới hết giờ. Session đầu tạo ngay sau khi plugin vừa lên có thể treo `CREATING`
   mãi (đã gặp: 10 phút); xoá đi tạo lại sau vài phút thì `ACTIVE` trong 75 giây.
4. Vào được rồi thì **thêm một dòng khoá mang chú thích RIÊNG**:

> **Bẫy đã trả giá:** Bastion tự nạp chính khoá công khai của bạn vào `authorized_keys`, nằm
> trong một khối gắn nhãn `#ocid1.bastionsession…`. Khối ấy **bị gỡ khi session hết hạn**. Một
> phép `grep -qF "$KEY"` để "khỏi thêm trùng" sẽ khớp đúng vào dòng tạm ấy rồi báo "đã có sẵn"
> và không thêm gì cả — ba tiếng sau khoá cửa lại như cũ. Hãy so theo **chú thích** (ví dụ
> `jarvis-oci-vinhvien`) chứ đừng so theo phần khoá.

Cuối cùng xoá bastion rồi **SSH thẳng vào IP công khai** để nghiệm thu: lúc ấy mọi dòng tạm đã
biến mất, vào được nghĩa là dòng vĩnh viễn thật sự đứng một mình.

### Cài đè engine mới (phát hành) — KHÔNG còn áp dụng cho VM

> **Từ 16/08/2026 bước này ĐÃ BỎ khỏi lệ phát hành.** VM không còn chạy khôi lỗi, nên một bản vá
> engine nay chỉ phải tới HAI nơi: các trạm Vercel (`npm run deploy:all`) và 6 kho GitHub đông
> lạnh (`npm run github:deploy`). Đừng đi tìm một VM để cài đè — không có cái nào cả, và IP dưới
> đây đã chết. Giữ lại công thức vì nó là đường dựng khôi lỗi VM nếu có ngày cần lại.

Chạy **sau khi Vercel đã `READY`** — `setup.sh` tải gói từ `WEB_URL/linh-su/goi-linh-su.tgz`,
mà gói ấy được đóng lại ở mỗi lần deploy. Deploy trước, cài sau; ngược lại là cài phải gói cũ.

```bash
ssh -i ~/.ssh/jarvis_oci_ed25519 ubuntu@<IP của VM chạy khôi lỗi> \
  'sudo bash -c "set -a; . /opt/auto-hh3d/linh-su/.env; set +a; bash /home/ubuntu/setup.sh"'
```

Token đọc từ chính `.env` trên VM nên không phải mang bí mật qua máy khác. `setup.sh` idempotent.

**Chỉ chạy khi patch có đụng engine**, kiểm bằng:

```bash
git diff --stat <thẻ-cũ>..HEAD -- scripts/worker.mjs src/lib/quest-engine src/lib/worker scripts/buildWorkerBundle.mjs
```

Danh sách đường dẫn ấy PHẢI phủ đúng những gì `buildWorkerBundle.mjs` nhét vào gói — `src/lib/worker`
vào danh sách ngày 10/08/2026 cùng lúc với `controlFollow.mjs`. Thêm tệp vào gói mà quên thêm vào
đây thì phép dò trả về trống, người ta bỏ qua bước cài, và VM chạy mã cũ trong im lặng.

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
| Kích cỡ | **4 OCPU / 24GB** | Trọn hạn Always Free của A1. Bảng này từng ghi 2/12 với lý do "xin nhỏ cho dễ được cấp" — đo lại ngày 10/08/2026 thì máy thật là 4 OCPU / 24GB (`shape-config` của OCI và `nproc`/`free` trên máy nói cùng một điều). Con số ấy là căn cứ của trần hub trong engine, nên chép sai ở đây là tính sai ở đó. |
| Đĩa | **100 GB** boot volume, VPU 10 | Hạn Always Free là **200 GB tổng** cho mọi block+boot volume, nên 100 GB vẫn còn chừa một nửa. Nâng từ 50 GB ngày 16/08/2026 lúc dựng lại máy: bản cũ dùng 17/50 GB mà riêng 13 hồ sơ trình duyệt đã ăn 12 GB — tức trần cũ chỉ còn cách đầy đúng một lần đông việc. Ubuntu cloud image tự `growpart` khi khởi động lần đầu nên không phải nới phân vùng bằng tay (đo: `sda1` = 99 G, `df` = 96 G khả dụng). |
| IP | **RESERVED** | Từ 16/08/2026. Trước đó là ephemeral, và bài học đắt: xoá máy là mất địa chỉ vĩnh viễn (OCI không cho chuyển ephemeral → reserved), kéo theo phải sửa tài liệu, `~/.ssh` và cả bản ghi nhớ. Reserved thì địa chỉ thuộc về tài khoản, dựng lại máy là gắn lại. |
| Mạng | Chỉ mở SSH (22) | Worker chỉ gọi RA (HTTPS tới web + game). Không cổng nào cần mở vào. |

### Dựng lại VM từ đầu

Làm bằng CLI, không bấm GUI — chạy thật ngày 16/08/2026 và đây là bản chép lại đúng lượt ấy.
Bảng cũ ở đây từng dạy bấm GUI với **2 OCPU/12GB**; con số đó sai so với máy thật (4/24) và đã
gỡ. Đặt `$C` = OCID compartment (chính là OCID tenancy — xem mục 1).

**Bước 0 — ĐO SỨC CHỨA TRƯỚC KHI XOÁ.** A1 Free Tier hay hết chỗ, mà xoá rồi mới biết là mất
máy hàng giờ. Có API trả lời trước, không tốn gì:

```bash
echo '[{"instanceShape":"VM.Standard.A1.Flex","faultDomain":null,"instanceShapeConfig":{"ocpus":4.0,"memoryInGBs":24.0}}]' > cap.json
for ad in AD-1 AD-2 AD-3; do
  oci compute compute-capacity-report create --profile jarvis --compartment-id "$C" \
    --availability-domain "mbwY:EU-FRANKFURT-1-$ad" --shape-availabilities file://cap.json \
    --query 'data."shape-availabilities"[0]."availability-status"' --raw-output
done   # AVAILABLE ở ít nhất một AD thì mới đi tiếp
```

**Bước 1 — xoá máy cũ.** `--preserve-boot-volume false`, không thì boot volume mồ côi vẫn ăn
hạn 200 GB mà không dòng nào nhận ra nó. `--wait-for-state` ở đây nhận trạng thái **work
request** (`SUCCEEDED`), không phải `TERMINATED` — gõ nhầm là CLI từ chối:

```bash
oci compute instance terminate --profile jarvis --instance-id "$OLD" \
  --preserve-boot-volume false --force --wait-for-state SUCCEEDED
```

**Bước 2 — dựng máy mới.** `--assign-public-ip false` là CỐ Ý: một VNIC chỉ đeo được một IP
công khai, nên xin ephemeral trước rồi mới muốn reserved là phải gỡ ra gắn vào.

```bash
oci compute instance launch --profile jarvis --compartment-id "$C" \
  --availability-domain "mbwY:EU-FRANKFURT-1-AD-1" --fault-domain FAULT-DOMAIN-2 \
  --display-name jarvis-oci-01 --hostname-label jarvis01 \
  --shape VM.Standard.A1.Flex --shape-config '{"ocpus":4,"memoryInGBs":24}' \
  --image-id "<Canonical-Ubuntu-24.04-aarch64 mới nhất>" \
  --boot-volume-size-in-gbs 100 --subnet-id "<subnet cũ>" \
  --assign-public-ip false --metadata '{"ssh_authorized_keys":"<khoá công khai>"}' \
  --wait-for-state RUNNING
```

**Bước 3 — gắn IP reserved** (địa chỉ thuộc về tài khoản, dựng lại máy là gắn lại):

```bash
PIP=$(oci network private-ip list --profile jarvis --vnic-id "$VNIC" --query 'data[0].id' --raw-output)
oci network public-ip create --profile jarvis --compartment-id "$C" \
  --lifetime RESERVED --private-ip-id "$PIP" --display-name jarvis-oci-01-ip \
  --wait-for-state ASSIGNED
```

**Bước 4 — nghiệm thu.** Security list mặc định đã chỉ mở 22 — đúng ý. Ubuntu cloud image tự
`growpart` nên `df -h /` phải ra ~96 G ngay lần khởi động đầu; ra 48 G nghĩa là partition chưa
nới và phải xem lại.

**Chỉ khi muốn máy này làm khôi lỗi** — `scp` [setup.sh](setup.sh) lên VM rồi:

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
