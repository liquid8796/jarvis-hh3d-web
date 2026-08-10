# Gương Trạm — thiết kế hệ thống trạm dự phòng (mirror site)

> Bản thiết kế 10/08/2026. Trạng thái: phần 1–3 của §12 ĐÃ thực thi (0.60.0 lõi bảng điều
> phối + middleware; 0.61.0 sổ gương trên trang admin), và trạm gương đầu tiên
> `auto-hh3d-1` đã dựng thật trên tài khoản `zhangyu4` — tầng chuyển hướng đo được trên hai
> trạm sống (§13). Phần 4–5 chưa. Đọc cùng [deploy/oracle/README.md](../oracle/README.md)
> (VM + Object Storage — hai thứ KHÔNG đổi trong mọi kịch bản) và ghi chú migrate database
> 10/08/2026 (đổi `jarvis-auto-hh3d` → `jarvis-hh3d`): phần đồng bộ Postgres dưới đây chính là
> bản sản phẩm hoá của quy trình đã chạy tay hôm ấy.

## 1. Bài toán

Một trạm chính đang chạy trên một tài khoản Vercel. Cần:

1. Trang admin nhập trước **sổ gương trạm**: mỗi trạm một URL + một cặp database riêng
   (Postgres Neon + MongoDB Atlas) thuộc tài khoản Vercel khác.
2. Tới ngày, admin vào trang admin **chọn một gương trạm** → dữ liệu đồng bộ từ trạm đang
   hoạt động sang trạm ấy → người dùng mở URL trạm cũ thì bị **chuyển hướng** sang URL mới.
3. **VM OCI (khôi lỗi) và Object Storage OCI giữ nguyên** — chúng là phần bất biến.
4. Codebase phải deploy được thành trạm chính **hoặc** bất kỳ gương trạm nào, trên bất kỳ
   tài khoản Vercel nào.

**Ngoài phạm vi (nói thẳng):** nếu trạm cũ chết HẲN (tài khoản Vercel bị khoá, domain không
trả lời) thì không có gì để phát lệnh chuyển hướng — người dùng gõ URL cũ sẽ chỉ thấy lỗi
của Vercel. Chuyển hướng chỉ hoạt động khi trạm cũ còn thở. Muốn sống cả kịch bản chết hẳn
thì cần một custom domain trỏ bằng DNS — ghi ở §11, không nằm trong đợt đầu.

## 2. Ba quyết định xương sống

**(a) Mọi deploy đều giống hệt nhau — "trạm đang hoạt động" là DỮ LIỆU, không phải cấu hình
build.** Không có "bản build cho main" và "bản build cho mirror". Mỗi deploy chỉ khác nhau ở
biến môi trường (`SITE_ID`, database của chính nó). Trạm nào đang là trạm chính do **một tấm
bảng điều phối** quyết định, và mọi trạm tự soi bảng ấy để biết mình nên phục vụ hay chuyển
hướng. Nhờ vậy "chuyển trạm" và "chuyển về" là cùng một thao tác — không deploy lại gì cả.

**(b) Bảng điều phối nằm trên OCI Object Storage — mảnh đất duy nhất không bao giờ đổi chủ.**
Đặt nó trong database là chết vòng lặp (chuyển database xong thì bảng nằm ở đâu?); đặt trên
Vercel Edge Config là buộc vào đúng tài khoản đang muốn thoát ra. Bucket `jarvis-media` đã
`ObjectReadWithoutList` (ai có URL thì đọc được, cần khoá mới ghi được) và mọi trạm lẫn VM
đều đã có sẵn đường tới nó.

**(c) Đồng bộ dữ liệu chạy trên VM OCI, không chạy trong serverless.** Lượt đồng bộ là việc
chạy vài phút, cần cầm credential của cả hai phía, và phải sống sót qua trần thời gian của
function. VM là máy luôn bật, đã được tin cậy ở mức cao hơn nhiều (nó cầm cookie game của
mọi thành viên), và đã có sẵn giao thức `claim → event → complete` để nhận việc + báo tiến
độ về trang admin. Đồng bộ chỉ là một loại việc mới trên giao thức cũ.

## 3. Bảng điều phối (`control/site.json` trên bucket)

```jsonc
{
  "revision": 7,                          // đơn điệu tăng — số lớn hơn LUÔN thắng
  "activeSiteId": "mirror-b",             // SITE_ID của trạm đang hoạt động
  "activeUrl": "https://hh3d-b.vercel.app",
  "switchedAt": "2026-08-10T13:00:00Z",
  "switchedBy": "<userId của admin bấm nút>",
  "sig": "<base64url HMAC-SHA256 của phần trên, khoá = WORKER_TOKEN>"
}
```

- **Ghi**: chỉ trạm đang cầm khoá OCI (mọi trạm đều có, trong env) — một `PutObject` duy nhất
  nên lượt lật là nguyên tử; ghi xong đọc lại để xác nhận.
- **`revision` đơn điệu**: chống chuyện hai bảng chép đè nhau lúc mạng chập — bên đọc chỉ
  chấp nhận bảng có `revision` cao hơn bảng đang giữ.
- **`sig` bắt buộc, khoá là `WORKER_TOKEN`**: bucket đọc công khai, nhưng VM sẽ **đi theo**
  `activeUrl` trong bảng này — và mỗi lượt gọi nó gửi kèm `WORKER_TOKEN` trong header. Một
  tấm bảng giả trỏ VM về máy kẻ xấu là cách rẻ nhất để câu trộm token ấy. HMAC bằng chính
  `WORKER_TOKEN` thì mọi bên cần xác minh (các trạm, VM) đều đã có khoá, không phải phát
  thêm bí mật mới. Middleware của các trạm cũng chỉ tin bảng có chữ ký đúng.
- **Cache 30 giây** ở mọi bên đọc — trần độ trễ lan truyền khi lật trạm là 30s, đủ nhanh cho
  một thao tác mỗi vài tháng và đủ thưa để không cộng một lượt GET vào mọi request.

## 4. Sổ gương trạm (trong `app_settings`, nhánh `mirrors`)

```jsonc
{
  "mirrors": [{
    "id": "mirror-b",                     // trùng SITE_ID của deploy bên kia
    "name": "Trạm B — tài khoản dự phòng",
    "url": "https://hh3d-b.vercel.app",
    "pg": "<secretBox v1...>",            // DATABASE_URL của trạm B, mã hoá at-rest
    "mongo": "<secretBox v1...>",         // MONGODB_URI của trạm B, mã hoá at-rest
    "lastProbeAt": "…", "lastProbeOk": true
  }]
}
```

- Mã hoá bằng `secretBox` sẵn có (AES-256-GCM, khoá `ENCRYPTION_KEY` trong env) — cùng lý do
  với cookie game: quyền đọc database không được đồng nghĩa quyền cầm database khác.
- Sổ nằm trong `app_settings` nên **tự đi theo mọi lượt đồng bộ**: chuyển sang trạm B xong,
  trạm B có nguyên sổ để ngày sau chuyển tiếp sang C hoặc quay về A. Điều kiện để chuỗi này
  chạy: **mọi trạm dùng chung `ENCRYPTION_KEY`** (xem §9 — danh sách biến chung/riêng).

## 5. Tầng chuyển hướng (`src/middleware.ts` — chưa tồn tại, tạo mới)

Luật, theo thứ tự:

1. Request tĩnh (`/_next`, ảnh, favicon) → cho qua, không tốn lượt soi bảng.
2. Đọc bảng điều phối (cache 30s, xác minh `sig` + `revision`). Đọc **hỏng** → cho qua
   (fail-open): thà trạm cũ phục vụ tiếp còn hơn cả hệ thống quỳ theo một lượt GET bucket.
3. `activeSiteId === SITE_ID` của mình → phục vụ bình thường.
4. Khác → **chuyển hướng 307** sang `activeUrl` + nguyên path/query, TRỪ các miễn trừ:
   - `/admin`, `/api/admin/**`, `/login`: admin phải vào được trạm cũ để thao tác/quay lui.
     (Miễn trừ theo path là đủ — guard quyền thật nằm ở `requireAdmin()` như mọi khi.)
   - `/api/worker`: trả `409 { activeUrl }` thay vì redirect — khôi lỗi đọc JSON, không đi
     theo HTTP redirect mù (POST redirect làm mất kiểm soát header Authorization).
   - `/api/cron`: trạm không hoạt động trả 204 ngay — hai trạm cùng nổ cron thì chỉ trạm
     đang hoạt động được dọn dẹp thật (không thì hai bên purge chat đua nhau trên hai Mongo
     khác nhau, vô hại nhưng loạn log; và các cron sau này có thể KHÔNG vô hại).
5. Không đặt cookie, không nhớ trạng thái trong middleware — bảng điều phối là nguồn duy nhất.

## 6. Máy trạng thái chuyển trạm

Trạng thái sống trong `app_settings.mirrorSwitch` của trạm ĐANG hoạt động (và hiện lên trang
admin qua kênh realtime sẵn có):

```
idle → draining → syncing → verifying → flipping → done
                     ↘ failed (ở bất kỳ bước nào — bảng điều phối CHƯA lật, an toàn)
```

1. **Admin bấm「Chuyển trạm」** (gõ lại tên trạm đích để xác nhận — thao tác không đảo ngược
   bằng một cú bấm). Quyền mới `site.switch`, chỉ Gia chủ — kèm migration seed quyền (đi
   cùng đợt vá quyền `job.force_start` đang thiếu, xem ghi chú 10/08/2026).
2. **draining** — bật bảo trì (cơ chế sẵn có: đóng cửa claim, đàn đang chạy đi hết vòng),
   chờ `running = 0`. Đo thực tế 10/08: 10 phút. Có nút「cắt ngay」cho tình huống khẩn.
3. **syncing** — trạm phát một **việc đồng bộ** qua giao thức worker; VM nhận và chạy:
   - Postgres: dựng schema đích bằng chính `scripts/migrate.mjs` (21+ migration), rồi chép
     dữ liệu theo thứ tự khoá ngoại bằng `json_populate_recordset` từng lô 1000 — nguyên
     quy trình đã kiểm chứng ngày 10/08, kèm cả bước đặt lại sequence.
   - MongoDB: chép `chat_messages` + `chat_typing` theo lô `_id`, upsert idempotent.
   - Credential hai phía do trạm giải mã (bằng `ENCRYPTION_KEY`) và đưa trong payload việc,
     qua đúng kênh HTTPS + `WORKER_TOKEN` đang chở cookie game hằng ngày — không nằm lại
     trên đĩa VM.
   - Tiến độ báo về bằng `event` như đàn thường → admin thấy từng bảng chạy qua.
4. **verifying** — VM so nguồn/đích: đếm dòng + MD5 nội dung từng bảng (chấp nhận lệch duy
   nhất cột nhịp tim như đã ghi nhận 10/08), so schema object (bảng/cột/ràng buộc/index/
   **trigger**/hàm/enum — trigger là thứ checksum dữ liệu không bao giờ bắt được mà kênh
   realtime sống nhờ nó), so `count` hai collection Mongo. Lệch → `failed`, bảng điều phối
   chưa lật, không mất gì.
5. **flipping** — trạm ghi bảng điều phối mới (`revision + 1`, ký), đọc lại xác nhận, rồi
   TẮT bảo trì **ở database trạm đích** (nó là trạm hoạt động mới). Trạm cũ giữ bảo trì bật
   trong database của nó — ai lách được qua redirect cũng chỉ gặp bảng bế quan.
6. **Khôi lỗi tự theo**: mỗi 5 phút (và mỗi khi gọi API hỏng hoặc nhận 409) VM đọc lại bảng
   điều phối, xác minh chữ ký, đổi `WEB_URL` đang dùng ngay trong tiến trình. `setup.sh`
   thêm bước ghi `CONTROL_URL` vào `.env` của VM — một lần, còn lại tự động.

**Quay lui** = chạy lại đúng máy trạng thái ấy theo chiều ngược (trạm đích cũng có nguyên sổ
gương + engine sync sau khi đồng bộ). Dữ liệu sinh ra trên trạm mới trong thời gian đó được
đồng bộ ngược — vì "quay lui" cũng chỉ là một lượt chuyển trạm.

## 7. Vì sao KHÔNG đồng bộ liên tục (đã cân nhắc và bỏ)

Đồng bộ hai chiều liên tục giữa hai Neon + hai Atlas là bài toán conflict-resolution thật sự
(logical replication qua serverless driver không có; Neon chưa cho publication trên free
tier; Atlas sync là sản phẩm trả phí). Nhu cầu thật của đạo hữu là **chuyển nhà vài tháng
một lần**, không phải active-active. Một lượt chép trọn 10-15 nghìn dòng mất dưới hai phút
— rẻ hơn vô hạn so với nuôi một hệ replication chỉ để dùng ngày ấy. Cái giá chấp nhận: cửa
phát việc đóng trong lúc chuyển (đo 10/08: ~12 phút cả chờ đàn).

## 8. Khôi lỗi + Object Storage (phần KHÔNG đổi)

- Khôi lỗi **đi theo `409`, KHÔNG tự đọc bảng** (`src/lib/worker/controlFollow.mjs`). Bản thiết
  kế đầu ghi「VM: thêm vòng đọc bảng điều phối」và điều đó SAI: khoá xác minh chữ ký chính là
  `WORKER_TOKEN` của deployment, mà khôi lỗi máy nhà cầm linh phù cá nhân thì không có nó — cả
  một nhánh khôi lỗi sẽ không đọc nổi bảng. Còn 409 thì trạm đã nghỉ phát cho MỌI khôi lỗi, kèm
  sẵn `activeUrl` lấy từ bảng nó vừa xác minh. Gặp 409 có `activeUrl` https khác chỗ đang đứng
  thì đổi địa chỉ nền rồi thử lại **đúng một lần**; không ghi nhớ xuống đĩa, khởi động lại là
  đọc `WEB_URL` từ env rồi lại đi theo. `WORKER_TOKEN`/`WORKER_ID` giữ nguyên — bảng `workers`
  đồng bộ theo nên trạm mới nhận ra khôi lỗi cũ ngay nhịp tim đầu.
  - **Phân biệt hai loại 409**: `/api/worker` cũng trả 409 cho「job is no longer active」. Dấu
    hiệu để đi theo là CÓ `activeUrl` hợp lệ, không phải mã trạng thái. `verify:worker-follow`
    giữ chỗ này (23 phép, chạy bằng `fetch` giả — không cần mạng, không cần trạm nào phải nghỉ).
  - Chỉ nhận `https://`: khôi lỗi gửi token theo mọi request, nên địa chỉ nền quyết định token
    đi về đâu. Bảng chỉ chứa https nên siết ở đây không bỏ sót ca hợp lệ nào.
  - Giới hạn còn nguyên: trạm cũ chết HẲN thì không ai phát 409 — xem §11, lời giải là custom
    domain, không phải thêm mã ở worker.
- Media: URL công khai `objectstorage.…oraclecloud.com/...` nằm trong tin nhắn đã lưu —
  đổi trạm không làm vỡ một ảnh nào, vì bucket không đổi. Khoá ghi (`OCI_*`) nằm trong env
  của mọi trạm.

## 9. Deploy một gương trạm mới (checklist — cũng là lời giải "deploy bất kỳ tài khoản nào")

Biến **phải GIỐNG nhau** ở mọi trạm — khác một cái là gãy đúng chỗ ấy:

| Biến | Gãy gì nếu khác |
|---|---|
| `AUTH_SECRET` | Mật khẩu vẫn đăng nhập được (hash nằm trong DB) nhưng mọi phiên phải ký lại — chấp nhận; còn `dev:session`/`shot` lệch trạm thì hỏng |
| `ENCRYPTION_KEY` | Cookie game + sổ gương trong DB đồng bộ sang **không giải mã được** — chết cả quest engine |
| `WORKER_TOKEN` | VM không gọi được trạm mới, và chữ ký bảng điều phối không xác minh được |
| `OCI_*` (5 biến) | Mất media + mất luôn bảng điều phối |
| `MONGODB_DB` (kể cả khi **cả hai đều không đặt**) | Máy đồng bộ giải tên database cho CẢ HAI trạm bằng biến của tiến trình đang chạy — lệch nhau là chép sảnh đàm đạo vào một database mà trạm gương không bao giờ đọc tới. Đối chiếu vẫn xanh vì hai bên cùng đếm 0 |
| `CRON_SECRET`, `GIPHY_API_KEY`, `MONGODB_*` server-side khác | cron/GIF gãy tương ứng |

Biến **riêng từng trạm**: `SITE_ID` (mới — định danh trạm, trùng `id` trong sổ gương),
`DATABASE_URL` (Neon của trạm ấy, đặt `--sensitive`), `MONGODB_URI` (Atlas của trạm ấy),
`WEB_URL` nếu có nơi dùng.

**Lệ đặt tên (10/08/2026):** mọi tài khoản đặt database TRÙNG TÊN — Neon `jarvis-hh3d`,
MongoDB Atlas `atlas-jarvis-chat` — nên checklist chỉ phân biệt bằng TÀI KHOẢN, không bao
giờ bằng tên database. Vercel CLI đi bằng API token (`--token`, đặt `VERCEL_TOKEN[_<trạm>]`
trong env), không đi bằng session login — session chỉ ôm được một tài khoản một lúc.

**Quy tắc đặt tên (10/08/2026):** project gương đặt `auto-hh3d-<số tăng dần>` — trạm chính
là `auto-hh3d`, gương đầu tiên `auto-hh3d-1`. Dùng LUÔN tên ấy làm `SITE_ID` và làm `id`
trong sổ gương: một cái tên cho cả ba chỗ thì không bao giờ phải tra bảng đối chiếu.

**BỐN BẪY ĐÃ TRẢ GIÁ (10/08/2026), đừng vấp lại** — ba cái đầu khi dựng trạm gương, cái
thứ tư khi bấm diễn tập:

1. `vercel whoami --token <gương>` chạy TRONG thư mục repo trả `Not authorized` DÙ TOKEN
   TỐT — CLI đọc `.vercel/project.json` đang link project của tài khoản chính. Đã kết oan
   một token vì vậy. Kiểm token phải đứng ở thư mục trung lập, hoặc `curl -H "Authorization:
   Bearer …" https://api.vercel.com/v2/user`.
2. Project tạo bằng `vercel project add` KHÔNG tự nhận diện framework: preset về `Other`,
   output trỏ `public/`, và site trả 404 ở MỌI đường dù build log xanh và đủ mọi route. Thuốc
   là `"framework": "nextjs"` trong `vercel.json` (đã thêm) — nó thắng preset của project, dù
   dòng "Framework Preset" trong `project inspect` vẫn hiển thị `Other`. Đừng tin dòng ấy;
   tin phép thử `curl /`.
3. `vercel project rm` KHÔNG có `--yes`, nó đòi gõ tên để xác nhận — trong môi trường không
   tương tác thì treo rồi bị giết. Xoá bằng REST: `DELETE
   https://api.vercel.com/v9/projects/<tên>?slug=<team>`. Xoá project KHÔNG xoá database:
   hai resource Neon/Atlas chỉ rơi về trạng thái chưa nối, nối lại là xong.
4. **Chuỗi Atlas không mang tên database, và một luật bị chép làm hai bản thì bản sao luôn
   sai.** Lượt diễn tập đầu tiên gục ở bước `syncing` sau khi đã chép xong 11.458 dòng
   Postgres: `mirror/mongoSync.ts` tự viết một `databaseName()` chỉ đọc path của URI rồi ném
   lỗi nếu rỗng — mà nút Connect của Atlas cho ra `…mongodb.net/?retryWrites=…`, path rỗng ở
   **cả hai** trạm. Ứng dụng thật thì vẫn chạy, vì `services/chat.ts` có ba nấc
   (`MONGODB_DB` → path → mặc định `jarvis`). Nay chỉ còn MỘT luật ở `src/lib/mongo/dbName.ts`
   cho cả hai nơi gọi. Hai hệ quả đáng nhớ hơn cả bản vá:
   - `verify:mirror-sync` xanh 12/12 mà đời thật đỏ, vì fixture nào cũng có path. Phép kiểm
     phải mang **hình dạng chuỗi mà nhà cung cấp thực sự phát ra**, không phải hình dạng
     tiện cho người viết test. Nay có phép kiểm đúng chuỗi Atlas ấy.
   - 「Kiểm mạch」báo `Mongo ✔` nhưng chỉ `ping` cụm — chưa hề chạm tới tên database, tức là
     xanh ở đúng chỗ sắp gãy. Nay nó in tên database đã giải và có/chưa có `chat_messages`.
   Cái bẫy nguy hiểm hơn (chưa từng nổ, nay đã chặn): trỏ đúng cụm mà **sai tên database** thì
   nguồn đọc 0, đích nhận 0, `srcCount === destCount` — đối chiếu xanh mướt và trạm gương lên
   ngôi với sảnh đàm đạo trống trơn. `assertSourceDb` dừng ngay khi `chat_messages` đang nằm ở
   một database KHÁC trên cùng cụm (vắng ở mọi nơi thì không sao — tông môn chưa ai nhắn).

Quy trình: tạo project Vercel (tài khoản nào cũng được) → đặt env theo hai bảng trên →
deploy từ bản `git archive` (đường đã dùng vì vụ chặn git author — hoặc nối git của chính
tài khoản ấy) → `DATABASE_URL=<db trạm> node scripts/migrate.mjs` → vào trang admin trạm
chính, thêm trạm vào sổ, bấm「Kiểm mạch」(probe chỉ-đọc: nối được PG? Mongo? schema đủ 21+
migration? URL trả 200?). Trạm nằm im ở chế độ chuyển hướng cho tới ngày được chọn.

**Từ khi trạm đã vào sổ, đừng deploy tay nữa** — bấm đúp `deploy-all-stations.bat` ở gốc repo
(hoặc `npm run deploy:all`, thêm `-- --dry-run` để chỉ xem kế hoạch). Nó đọc sổ gương từ
database, tra ra project Vercel của từng trạm, rồi phát hành CÙNG MỘT tệp tar cho tất cả.

Nó tra được project mà sổ không hề lưu `projectId`/`orgId`, nhờ đúng lệ đặt tên ở trên: `url`
của trạm là `https://<project>.vercel.app` nên nhãn đầu của hostname chính là tên project, còn
chủ nhân thì hỏi Vercel — token nào nhìn thấy project ấy, token ấy là chủ. **Thêm một tài khoản
= thêm một biến `VERCEL_TOKEN_<TÊN>` trong `.env.local`, không sửa mã.** Và nó TỪ CHỐI thay vì
đoán ở ba chỗ: URL không phải `*.vercel.app`, project trùng tên ở hai tài khoản, cùng một token
khai ở hai biến — đoán sai ở đây là phát hành mã của tông môn lên project của người khác.

## 10. Các đường hỏng đã tính

| Tình huống | Hệ đỡ thế nào |
|---|---|
| Đồng bộ hỏng giữa chừng | Bảng điều phối chưa lật → trạm cũ vẫn hoạt động, `failed` hiện trên admin, bấm chạy lại (mọi bước idempotent: truncate-rồi-chép, upsert) |
| Bucket không đọc được | Middleware fail-open (phục vụ như thường); VM giữ URL đã biết; lượt lật thì dừng vì read-after-write không xác nhận được |
| Hai bảng đè nhau | `revision` đơn điệu — số cao thắng; ghi là một `PutObject` nguyên tử |
| Bảng giả mạo | `sig` HMAC — VM và middleware bỏ qua bảng chữ ký sai |
| Hai trạm cùng nổ cron | Trạm không hoạt động trả 204 (§5.4) |
| Admin lỡ chuyển nhầm | Xác nhận gõ tên trạm; và quay lui là một lượt chuyển ngược |
| Người dùng đang đăng nhập | Cookie không qua domain khác — đăng nhập lại bằng đúng mật khẩu cũ (hash đã đồng bộ). Ghi rõ trong thông báo bảo trì |
| Máy dev không nối được Atlas (DNS SRV) | Đồng bộ chạy trên VM, không dính bệnh của máy dev |

## 11. Giới hạn nói thẳng + đường mở rộng

- Trạm cũ chết HẲN → không ai phát được redirect. Đường mở rộng duy nhất đúng: một **custom
  domain** làm cửa chính, DNS trỏ vào trạm hoạt động; bảng điều phối khi ấy thành nguồn cho
  script đổi DNS. Thiết kế này không cản đường đó — `activeUrl` đã là dữ liệu.
- `job_events` sẽ phình theo năm tháng; lượt đồng bộ dài ra theo. Van xả có sẵn: retention
  cho `job_events` (một cron nữa) — ghi ở đây để ngày `syncing` vượt 10 phút thì biết vặn đâu.

## 12. Lộ trình thực thi (5 phần, mỗi phần một commit kiểm chứng được)

1. **Nền**: `SITE_ID` + module bảng điều phối (`src/lib/control/`) — đọc/ghi/ký/cache +
   `verify:control` (ký → đọc → giả mạo phải bị từ chối). Chưa đổi hành vi nào.
2. **Middleware** chuyển hướng + miễn trừ + gate cron; `verify:redirect` giả lập hai SITE_ID.
3. **Sổ gương + trang admin** (tab「Gương Trạm」, probe, migration quyền `site.switch`).
4. **Việc đồng bộ trên VM** (sản phẩm hoá cặp copy/verify 10/08 thành module dùng chung
   `scripts/mirrorSync/`) + op mới trong `/api/worker` + máy trạng thái + panel tiến độ.
5. **Diễn tập** ✔ xong 10/08/2026 — chuyển đi rồi chuyển về trên hai trạm sống. Số đo, ba lỗi
   nó lôi ra, và hai bài học vận hành nằm ở §14.

## 13. Đo thật trên hai trạm sống (10/08/2026)

Trạm gương `auto-hh3d-1` (tài khoản `zhangyu4`, Neon `jarvis-hh3d` + Atlas `atlas-jarvis-chat`,
`SITE_ID=auto-hh3d-1`) dựng xong và đo bằng curl khi bảng điều phối đang trỏ `main`:

| Đường | Kết quả | Ý nghĩa |
|---|---|---|
| `/` | 307 → `auto-hh3d.vercel.app/` | người dùng thường bị đá về trạm hoạt động |
| `/chat` | 307 → `…/chat` | giữ nguyên path |
| `/dashboard?tab=2` | 307 → `…/dashboard?tab=2` | giữ nguyên query |
| `/login` | 200 | miễn trừ — không bị đá đi |
| `/admin` | 307 → `auto-hh3d-1.vercel.app/login` | miễn trừ có tác dụng (đá về login CỦA CHÍNH NÓ, tức auth guard, không phải middleware) |
| `POST /api/worker` | 409 + `{"activeUrl":"https://auto-hh3d.vercel.app"}` | khôi lỗi đọc JSON, không đi theo redirect mù |
| `/api/cron` | 204 | trạm phụ không dọn dẹp song song |

Schema DB gương so với trạm chính: khớp cả 11 bảng / 63 cột / 24 ràng buộc / 23 index /
**7 trigger** / 4 hàm / 11 enum. Sổ gương ghi được, phong bì `v1.` giải mã lại khớp, trang
admin hiện host trần chứ không lộ chuỗi kết nối.

Chưa kiểm được từ máy dev: nhánh Mongo của「Kiểm mạch」— máy này không phân giải nổi DNS SRV
của Atlas (`querySrv ECONNREFUSED`, bệnh đã biết), nên probe dưới máy luôn báo Mongo ✗ trong
khi PG ✔ 22 migration. Probe THẬT chạy trong server action trên Vercel nên không dính bệnh
ấy; muốn xác nhận thì bấm「Kiểm mạch」trên trang admin — `npm run shot` chỉ nhận một `--click`
nên không tự bấm hộ được (mở tab đã tốn cú bấm duy nhất).

## 14. DIỄN TẬP THẬT — đi và về (10/08/2026)

Chuyển `main` → `auto-hh3d-1` rồi từ chính trạm gương chuyển ngược về `main`. Bốn lượt bấm:
ba lượt đầu gãy và mỗi lượt lôi ra một lỗi thật, lượt thứ tư đi trọn.

### Đồng hồ từng bước

| Bước | Chặng đi | Chặng về |
|---|---|---|
| Chờ đàn cạn | 0s (cạn sẵn) | **47s** (2 đàn chạy nốt vòng) |
| Chép 11 bảng (~11.500 dòng) + Mongo | 23s | 26s |
| Đối chiếu 11 bảng | 23s | 9s |
| **Bấm → sẵn sàng lật** | **46s** | **82s** |

**Con số ~12 phút đo ngày 10/08 gần như TOÀN BỘ là chờ đàn cạn, không phải chép.** Việc chép
và đối chiếu 11.500 dòng tốn dưới 40 giây mỗi chiều. Ai muốn rút ngắn bế quan thì vặn ở chỗ
hàng đợi, đừng tối ưu bước chép.

Tổng bế quan hôm ấy là 73 phút (16:01 → 17:14), nhưng đó là giá của ba lượt gãy cộng ba bản vá
giữa chừng — không phải giá của một lượt chuyển.

### Ba lỗi chỉ lộ ra khi chạy thật

Cả ba đều nằm dưới một lớp kiểm tra đang báo xanh, và đó là điểm chung đáng nhớ nhất:

1. **Tên database Mongo** — `mongoSync.ts` chép lại luật thành một bản khắt khe hơn bản thật;
   chuỗi Atlas không có tên database bao giờ. Xanh 12/12 vì fixture nào cũng có path. (§9 bẫy 4)
2. **`app_settings` tự tham chiếu** — máy chuyển trạm ghi tiến độ vào đúng bảng nó đang chép,
   nên đối chiếu không bao giờ khớp. Vá vòng một loại `value.mirrorSwitch` nhưng **bỏ sót cột
   `updated_at`**, và bỏ sót vì bảng giả trong phép kiểm chỉ có `(id, value)` — lại là bẫy
   fixture, vấp hai lần trong một buổi. Nay `app_settings` chép CUỐI và loại cả hai thứ.
3. **Khôi lỗi không đi theo bảng** — §8 chưa từng được thực thi. Web đã sang trạm mới, người
   dùng vào được, nhưng `tong-mon-khoiloi` im 20 phút vì `WEB_URL` là hằng số. Ai có khôi lỗi
   riêng thì vẫn chạy; ai không có thì không được phục vụ. Xem §8 cho bản vá.

### Hai điều về vận hành, học bằng cách trả giá

- **Đừng sửa cài đặt gì trong lúc lượt chuyển đang chạy** — kể cả ghi chú bế quan. `app_settings`
  chép xong là bản sao đứng yên; sửa nguồn sau đó thì đối chiếu đỏ, **và đỏ đúng** (bản sao đã
  cũ thật). Đặt `app_settings` ở cuối co cửa sổ ấy lại còn thời gian bước đối chiếu, nhưng nó
  không bao giờ về 0. Muốn đổi lời nhắn cho người dùng thì đổi TRƯỚC khi bấm.
- **Trạm vừa lên ngôi phải sẵn sàng ngay.** Bản đầu để nó thừa hưởng phase dở dang nên không mở
  nổi lượt kế, lại hiện nút「Lật」trỏ vào chính nó — revision nhảy 2→3→4→5 vì thế. Nay đích nhận
  `phase: idle` kèm lời kể, và `flipSwitchAction` chặn thẳng lượt lật sang chính mình.

### Điều diễn tập đã CHỨNG MINH

- Đối chiếu nội dung bắt được sai sót thật, không phải phép đếm dòng trang trí.
- **`ENCRYPTION_KEY` hai trạm khớp nhau** — chặng về là bằng chứng: trạm gương tự giải mã chuỗi
  kết nối của `main` từ sổ rồi chép ngược. API Vercel không cho đọc giá trị biến `encrypted`
  nên không có cách nào kiểm từ ngoài; chỉ chạy thật mới trả lời được.
- **`WORKER_TOKEN` hai trạm khớp nhau** — kiểm từ ngoài được: token bịa → 401, token trạm chính
  → 400 (sai định dạng). Xác thực chạy trước kiểm định dạng nên 400 chính là bằng chứng.
- **Không mất một dòng dữ liệu nào.** Main 11.173 dòng trước khi đi; gương tích lên 11.262 khi
  cầm bút; chặng về chép ngược đủ, cộng thêm phần sinh sau khi lật về ra đúng 11.302.
- Mô hình promote đứng vững: trạm được cất nhắc TỰ nó phát lệnh chuyển đi được.
