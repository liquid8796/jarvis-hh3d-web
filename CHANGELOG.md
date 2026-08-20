# Changelog

Lịch sử phát hành của Auto HH3D — Web (tên cũ: Jarvis HH3D). Mới nhất ở trên.

Mỗi mục nói **cái gì đổi và vì sao**, thường là kể đích danh lần hỏng việc đã buộc phải đổi.
Đó là chủ ý: đây là chỗ duy nhất lý do còn sống sót: mã nguồn chỉ giữ được kết quả của một
quyết định, không giữ được cái giá đã trả để biết. Và cái giá ấy mới là thứ ngăn người sau —
kể cả chính mình sáu tháng nữa — phạm lại đúng lỗi đó.

Xem [README.md](README.md) để biết hệ thống chạy thế nào.

---

## 1.3.24 — Vòng chạy NÓI RA mình mở bằng binary nào

Bản vá kênh trình duyệt (1.3.23) đặt dòng「mở bằng …」ở mức `log.debug`, mà debug chỉ vào console
của runner chứ KHÔNG vào `job_events`. Thế là đúng cái bằng chứng quyết định — máy này chạy
Chromium đầy đủ hay đã lặng lẽ lui về shell — lại không ai đọc được. Đây là lần THỨ BA cùng một
lỗi trong tuần: bật một thứ rồi không đo được nó.

Nâng lên mức info. Từ nay mỗi vòng mở đầu bằng một dòng nói thẳng binary đang dùng, nên câu hỏi
「vẫn bị chặn — vì bản vá không ăn thua, hay vì bản vá chưa hề chạy?」trả lời được bằng cách đọc,
không phải bằng cách đoán.

---

## 1.3.23 — Thủ phạm là chrome-headless-shell, không phải IP và không phải tên miền

Sáu lượt vá đi tìm nhầm chỗ. Lượt này công cụ chẩn đoán được mở rộng thành chế độ **đi bộ** —
ghé đúng chuỗi trang của một vòng thật, trong MỘT phiên — và chạy TRÊN VM. Lặp ba lượt, kết quả
y hệt cả ba:

```
chrome-headless-shell   1. /                    ok
                        2. /nhiem-vu-hang-ngay  CHẶN     ← dừng ở đây, cả ba lượt

Chromium đầy đủ         1..8  ok ok ok ok ok ok ok ok   ← đi hết, không lần nào bị chặn
```

> **Đính chính (20/08/2026).** Bản đầu của mục này viết rằng phép đo trên VM chạy「đúng dải IP
> trung tâm dữ liệu mà khôi lỗi GitHub dùng」. SAI: VM là IP của Oracle Cloud, khôi lỗi chạy trên
> IP của GitHub Actions — hai dải khác hẳn. Phép đi bộ chứng minh được chuyện BINARY, nó không
> chứng minh gì về IP. Câu đã gỡ; bằng chứng cho dải IP GitHub nằm ở đoạn dưới, đo trên production.

**Xác nhận trên production, đúng dải IP GitHub** (đo 20/08/2026, nhóm theo giờ UTC):

```
giờ    lần bị CHẶN   việc xong   vòng đi trọn
15h          4            0            0        ← bản cũ (chrome-headless-shell)
16h          0            4            1        ← bản này (Chromium đầy đủ)
```

Và khôi lỗi tự khai binary nó dùng: `Chromium đầy đủ` — không lượt nào phải lui về shell. Mẫu
một giờ thì nhỏ, nói thẳng vậy; nhưng **`vòng đi trọn` nhảy từ 0 lên 1 là lần đầu tiên có một
vòng nào đi hết kể từ lúc lỗi bắt đầu**, và đó là thứ sáu lượt vá trước không lượt nào làm được.

**Cái bẫy đã giấu nguyên nhân suốt sáu lượt: TRANG CHỦ QUA ĐƯỢC Ở CẢ HAI.** Mọi phép đo một
trang — kể cả phép đo của chính lượt 1.3.22, thứ đã dẫn tới kết luận「không phải Cloudflare, là
tên miền」— đều báo xanh. Chỉ phép đi bộ nhiều trang trong cùng một phiên mới lộ ra, đúng thứ
khôi lỗi làm mà chẩn đoán trước đó không làm.

**Nguyên nhân.** Từ Playwright 1.49, `headless: true` KHÔNG còn mở Chromium: nó mở
`chrome-headless-shell`, một bản dựng riêng, gọn hơn, thiếu nhiều thứ của trình duyệt thật.
Cloudflare phân biệt được hai thứ ấy và chặn đúng cái shell.

**Bản vá.** `launchProfile` khai `channel: "chromium"`, và mọi lượt mở đi qua
`openBrowserPreferringFullChromium`: ưu tiên Chromium đầy đủ, **lui về shell** nếu máy này không
có nó. Đường lui bắt buộc phải có — `npx playwright install chromium` cài cả hai binary, nhưng một
khôi lỗi cũ, một máy nhà cài tay, hay một image gọt bớt thì có thể chỉ có shell; đòi cứng ở đó là
đổi một cú chặn Cloudflare lấy một cú CHẾT HẲN từ dòng mở trình duyệt. Lượt chạy cũng nói ra mình
mở bằng binary nào, để bản vá tự chứng minh thay vì hứa.

**Về pupflare** (repo tông chủ chỉ sang): tinh thần đúng — đừng chạy cái binary tự khai là bot —
nhưng ta KHÔNG cần dựng proxy hay thêm `puppeteer-extra-plugin-stealth`. Bệnh của ta cụ thể hơn:
sai BINARY, không phải thiếu vá dấu vân tay. Đổi kênh rẻ hơn và ít rủi ro hơn hẳn việc chèn một
tầng proxy vào đường chạy của mọi đàn.

Lưới mới `npm run verify:browser-channel` — 12 phép kiểm trên một `chromium` giả: có đòi kênh đầy
đủ không, máy chỉ có shell thì có LUI được không (nhánh nguy hiểm nhất), hồ sơ bền có đi cùng lối
không, và hỏng cả hai kênh thì có NÉM chứ không nuốt lặng lẽ. Lưới này cố ý KHÔNG giả vờ đo
Cloudflare — nó đo phần đo được.

> Ghi lại một ca chập chờn, không giấu: lượt smoke đầu sau bản vá ra 447/1 (một ca Khoáng Mạch),
> lượt sau 448/0. Đã loại một giả thuyết bằng đo đạc — Chromium đầy đủ có xin thêm `/favicon.ico`
> nhưng fixture trả nhánh mặc định nên KHÔNG đổi trạng thái. Ca ấy đáng theo dõi ở những lượt sau.

---

## 1.3.22 — KHÔNG phải Cloudflare: khôi lỗi vào nhầm một tên miền đã dời

Năm lượt vá (1.3.14 → 1.3.21) đều đi chữa trình duyệt, vì triệu chứng đọc y hệt một cú chặn của
Cloudflare. Lượt này tông chủ chỉ sang bản PC — máy vừa CHẠY ĐƯỢC vừa SOI ĐƯỢC — và chuỗi bằng
chứng lật ngược toàn bộ chẩn đoán.

**1. Trình duyệt vô can.** `npm run diagnose:cf` (công cụ mới) hỏi thẳng trang game bằng ba biến
thể — `chrome-headless-shell` (đúng thứ khôi lỗi chạy), Chromium đầy đủ headless mới, và bản có
giao diện. Trên `hoathinh3d.so`: **cả ba vào sạch, không màn kiểm tra nào.**

**2. Hai nửa hệ thống trỏ hai tên miền khác nhau.**

| | tên miền | từ máy nhà | từ VM |
|---|---|---|---|
| app PC (`settings.json`) | `hoathinh3d.so` | HTTP 200 | 403 (curl trần — bình thường) |
| worker web (hằng số) | `hoathinh3d.one` | treo 15s rồi đứt | **301 → `hoathinh3d.so`** |

**3. `.one` là tên miền ĐÃ DỜI.** Nó 301 sang `.so`, mà cookie gắn chặt theo tên miền nên KHÔNG
đi theo cú nhảy. Tới `.so`, khôi lỗi là **khách lạ**: Cloudflare dựng màn kiểm tra, hub không bao
giờ dựng bảng nhiệm vụ, mọi nhiệm vụ chết ở một selector vô tội. Mọi triệu chứng của năm ngày qua
rơi ra từ đúng một sự thật này.

**4. Tông chủ ĐÃ đặt đúng `.so` ở trang Tông Môn — giá trị ấy không có đường nào tới khôi lỗi.**
`user_configs.config` giữ `gameBaseUrl` RIÊNG của từng người (mặc định rỗng — và cả 29 người đều
rỗng), `claimNextJob` chép thô đúng document ấy, còn workflow khôi lỗi tông môn không đặt
`GAME_BASE_URL`. Nên `runCycle` rơi xuống nấc cuối cùng của thứ tự nguồn: hằng số trong mã, vẫn
là `.one`. Lời báo thành công của form đổi tên miền hứa「khôi lỗi dùng ngay từ vòng kế」— lời hứa
suông từ ngày viết ra.

**Bản vá.** Cửa phát việc (`api/worker/route.ts`) ghép tên miền của tông môn vào snapshot khi
người dùng để trống — chỗ duy nhất mọi vòng chạy đều đi qua, và snapshot được dựng lại ở MỖI lượt
claim nên đúng nghĩa「từ vòng kế」. Ai tự gõ tên miền riêng vẫn được tôn trọng, đúng thứ tự nguồn
`runCycle` vẫn theo. Hằng số cuối nguồn cũng nhích `.one → .so`, và doc của nó nay chép lại cú dời
này để lần sau không mất năm lượt nữa.

Ba lưới ghim ba mệnh đề: cửa phát việc CÓ ghép, CHỈ ghép khi để trống, và hằng số không còn trỏ
vào `.one`. Lưới cuối cố ý không ghim một chuỗi cụ thể — site đổi TLD định kỳ — chỉ ghim điều bất
biến: không được là tên miền ta đã biết chắc là chết.

**Bài học đắt nhất, ghi để đời sau đọc:** một cấu hình có UI, có lời báo thành công, và KHÔNG có
đường dây tới nơi dùng nó thì tệ hơn là không có cấu hình ấy — nó khiến người ta tin rằng việc đã
làm xong. Cả năm lượt vá trước đều đi tìm lỗi ở chỗ triệu chứng kêu to nhất (Cloudflare), trong
khi nguyên nhân nằm ở một sợi dây chưa bao giờ được nối.

Kèm theo: `npm run diagnose:cf` — công cụ sinh ra vì câu hỏi「chặn vì IP hay vì trình duyệt?」đã
không ai trả lời được suốt năm lượt. Nó phân biệt rõ ba trạng thái (vào được / màn kiểm tra / đứt
kết nối), vì gộp「đứt TLS」với「màn kiểm tra」chính là cách chẩn đoán sai chỗ.

---

## 1.3.21 — Gỡ màn kiểm tra GIỮA VÒNG, chỗ nó thật sự xuất hiện

Đo sản xuất ngay sau khi bật cờ ở 1.3.20, và số liệu bác một giả định của chính tôi:

```
19:08:27  Trang game dựng màn kiểm tra (Cloudflare) GIỮA VÒNG …
19:08:28  (lần nữa)
--- 25 phút qua: việc thuận=0 · lần chặn=2
```

**Không một dòng「Đã bấm ô kiểm tra」.** Cú bấm dựng ở 1.3.18 vẫn chưa từng chạy, dù cờ đã bật ở
1.3.20 — vì nó chỉ nằm trong vòng chờ của `ensureReady`, tức CỔNG ĐẦU VÒNG, còn màn kiểm tra thì
đến GIỮA VÒNG. Lượt 1.3.19 tôi cố ý hoãn chỗ ấy với lý lẽ「vòng sau cổng sẽ bắt được」; sản xuất
vừa chứng minh là không: cổng qua sạch (`phiên đăng nhập còn hiệu lực`), rồi mới bị chặn ở nhiệm
vụ đầu tiên. Cứ thế lặp, nên cú bấm vĩnh viễn không có cơ hội nào.

**Bản vá.** Engine nhận `clickTurnstile` **tiêm vào** thay vì tự biết cách bấm: nó không sở hữu
danh tính trình duyệt (việc của runCycle), và nhập thẳng `attemptTurnstileClick` từ runCycle.mjs
sẽ tạo vòng import. Gặp màn kiểm tra giữa vòng: bấm → hỏi lại trang tối đa 12 giây (nhịp 1,5s) →
qua được thì **chạy lại nhiệm vụ ấy và đi tiếp**; không qua mới ném `CycleBlocked` như cũ, kèm
câu「Đã thử bấm ô kiểm tra mà không qua」để lần đọc nhật ký sau phân biệt được hai cảnh.

**MỘT DEFECT DO REVIEW BẮT ĐƯỢC, không phải do lưới:** nhánh「gỡ được → chạy lại」dùng `continue`,
mà `continue` NHẢY QUA phép kiểm `attempt >= MAX_PAGE_RENDER_ATTEMPTS`. Một trang cứ dựng lại màn
kiểm tra sau mỗi cú bấm sẽ giữ khôi lỗi trong **vòng lặp vô tận** — mỗi vòng 25 giây chờ + 12
giây hỏi lại, ghế bị giữ mãi mà nhật ký không có dấu hiệu gì bất thường. Thêm trần
`MAX_CHALLENGE_CLEARS = 2`, và thêm ca thử giả lập đúng cái bẫy ấy (một `clickTurnstile` luôn
khai「gỡ được」trong khi trang vẫn là challenge).

Lưới `verify:challenge-abort` lên **16 phép kiểm**: thêm nhánh gỡ-được-thì-đi-tiếp (đúng một cú
bấm), nhánh chạm-trần-thì-dừng, và nhánh **cờ TẮT giữ nguyên nết 1.3.19** — kể cả việc lời báo
không được nhận vơ là đã thử bấm.

> Nói thẳng phần chưa biết: lưới chứng minh CƠ CHẾ (bấm, chờ, hỏi lại, dừng đúng lúc). Nó KHÔNG
> chứng minh Cloudflare chấp nhận cú bấm — chuyện đó chỉ sản xuất trả lời được, và câu trả lời sẽ
> nằm ngay trong Hoạt động ở dạng một trong hai dòng mới.

---

## 1.3.20 — Bật cú bấm Turnstile cho khôi lỗi tông môn, và bắt nó NÓI RA

Tông chủ báo「vẫn dính」. Bản vá 1.3.19 chạy đúng thiết kế — vòng dừng sau ~25 giây thay vì 16
phút và gọi đúng tên Cloudflare — nhưng nó chữa *lãng phí*, không chữa *bị chặn*. Lượt này đo
tiếp và tìm ra hai điều.

**1. Cú bấm Turnstile dựng ở 1.3.18 CHƯA TỪNG CHẠY.** Nó ship mặc định TẮT, và
`deploy/github/linh-su.yml` không hề đặt `WORKER_SOLVE_TURNSTILE` — nên bốn khôi lỗi tông môn
chưa một lần thử bấm. Cân nhắc hồi 1.3.18 (tắt mặc định vì「một cú bấm sai chỗ trên hạ tầng CHUNG
có thể làm Cloudflare nghi hơn」) nay đã đổi: đo 20/08/2026 thì **cả bốn khôi lỗi đều bị chặn,
`việc xong = 0` suốt ba giờ**. Không còn gì để mất. Bật ở WORKFLOW chứ không đổi mặc định trong
mã — máy nhà vẫn tự quyết.

**2. Bật một thứ KHÔNG ĐO ĐƯỢC thì bằng không.** Cú bấm chỉ ghi `log.debug`, mà `log.debug` đi
vào console của runner chứ **không** vào `job_events` — bật lên rồi cũng không ai biết nó có bấm
hay không, càng không biết bấm xong có qua không. Nên lượt này:

- cú bấm ĐẦU TIÊN của mỗi lượt ghé cổng nói đúng **một** dòng lên Hoạt động (vòng poll chạy mỗi
  2 giây — nói mỗi nhịp là rác);
- lời báo cuối kể **đã bấm mấy lần**: phân biệt「chưa từng thử」với「thử rồi mà vẫn không qua」—
  hai kết luận dẫn tới hai việc phải làm hoàn toàn khác nhau. Không bật cờ thì câu chữ y như cũ.

**Điều thứ ba, không sửa bằng mã được, nhưng là gốc của「vẫn dính」:** đo sổ điểm danh thì cả ba
máy nhà (`desktop-9jg1gme` 1.2.0, `pc-photo` 1.3.0, `desktop-br33ug2` 1.3.0) đều mang linh phù
**CÁ NHÂN** — chúng chỉ nhận đàn của chính chủ. Nên mọi đàn của thành viên khác **chỉ** khôi lỗi
tông môn phục vụ được, mà khôi lỗi tông môn thì nằm trọn trên IP trung tâm dữ liệu của GitHub
Actions — thứ Cloudflare chặn. Ba máy IP dân dụng đứng không suốt ba giờ trong lúc bốn máy
datacenter đâm đầu vào tường.

Đường ra không nằm ở mã: chạy **một worker mang `WORKER_TOKEN` tông môn trên máy nhà** là có ngay
IP dân dụng phục vụ mọi đàn (token quyết định vai trò — xem đầu `scripts/worker.mjs`). Cái giá
phải cân: token ấy là chìa toàn cục, đặt lên máy nhà là một quyết định của tông chủ, không phải
của tôi. Và ba máy ấy còn đang chạy bản quá cũ (1.2.0/1.3.0) — thiếu cả bản vá client hints
(1.3.14) lẫn phép dừng sớm (1.3.19).

---

## 1.3.19 — Bị chặn ở cổng thì DỪNG NGAY, thay vì mười ba nhiệm vụ cùng đâm vào một bức tường

Tông chủ báo「vẫn lỗi」kèm ảnh, và đoán là cần nâng chờ trang từ 25s lên. Đo trước khi sửa, và số
liệu **bác giả thuyết ấy** — đây là chỗ đáng ghi nhất của lượt này.

**Bằng chứng, cùng MỘT đàn (`3ea5ccf0`), cùng một khôi lỗi, cùng một tài khoản:**

| giờ | cảnh |
|---|---|
| 05:10 | vòng KHOẺ — mỗi nhiệm vụ **~9 giây**, không một lượt treo |
| 14:18 | vòng CHẶN — mọi trang câm, mỗi lượt **đúng 25s**, 3 lượt mỗi nhiệm vụ |
| 14:51 | vòng CHẶN — engine gọi **đích danh**「màn kiểm tra (Cloudflare)」|
| 15:23 | lại câm | 
| 15:56 | lại đích danh Cloudflare |

Hai loại vòng chặn ấy **là cùng một sự kiện**, chỉ khác ở chỗ cổng đầu vòng có bắt được màn kiểm
tra trên TRANG CHỦ hay không. Khi không bắt được, cổng báo「phiên đăng nhập còn hiệu lực」rồi thả
cả vòng vào mười ba nhiệm vụ, mỗi nhiệm vụ tự chứng minh lại đúng một điều.

Nên **25s không phải chỗ thắt**: một vòng khoẻ chỉ cần ~9 giây cho cả navigate + render + đọc,
tức 25s đã rộng gấp ba. Còn khi bị chặn thì trang KHÔNG BAO GIỜ dựng — nâng lên 60s chỉ biến một
vòng chết 16 phút thành một vòng chết 39 phút, và giữ ghế khôi lỗi suốt chừng ấy.

**Bản vá.** `CycleBlocked` (engine.mjs) — một kiểu lỗi nói về CẢ VÒNG, cùng lối `QuestAborted`.
Khi một bước `waitForSelector` gục, trước khi tốn lượt thử lại thứ hai, engine **hỏi lại xem đó
có còn là trang game không** (`readinessProbe`, phép đọc sẵn có). Gặp màn kiểm tra thì ném
`CycleBlocked`; `runCycle` bắt, nói đúng tên nguyên nhân, nhả ghế và hẹn vòng sau theo nhịp
thường.

Ba điều cố ý giữ nguyên: (1) probe **chỉ chạy trên đường hỏng** — đường khoẻ không tốn một mili
giây nào; (2) probe hỏng hoặc trả `undefined` thì coi như không có màn kiểm tra — một phép chẩn
đoán không bao giờ được tự nó giết một vòng chạy; (3) trang hỏng THẬT (không màn kiểm tra) vẫn
thử đủ 3 lượt như cũ.

**Một cái bẫy do chính lưới bắt được:** bản đầu ném `CycleBlocked` từ trong `runCustomSteps`,
nhưng `engine.run` có một `catch` gói mọi lỗi thành outcome `failed` — chỉ `QuestAborted` được
xuyên qua. Thế là lệnh dừng bị nuốt thành một dòng nhật ký, và mười hai nhiệm vụ sau vẫn lần lượt
đâm vào đúng bức tường ấy. Lưới đỏ ngay ca đầu; đã cho `CycleBlocked` xuyên qua cùng lối.

Lưới mới: `npm run verify:challenge-abort` — 9 phép kiểm trên engine THẬT + Chromium THẬT, ba
fixture: trang challenge (phải dừng sau ĐÚNG một lượt tải, và lời báo phải gọi tên Cloudflare chứ
không đổ cho `.nv-quest`), trang CHẬM 1,2s (không được nhầm là bị chặn), và trang hỏng thật (vẫn
thử đủ 3 lượt — nết cũ không đổi).

---

## 1.3.18 — Tự bấm ô Turnstile khi vấp màn Cloudflare (cách 2, tắt mặc định)

Tông chủ chọn「cách 2」sau khi cân nhắc: chín khôi lỗi đều SỐNG, đúng bản mới, mà vòng nào cũng
`0 thuận` vì trang game dựng màn Cloudflare「Just a moment」và IP trung tâm dữ liệu không qua nổi.

**Vì sao KHÔNG mượn được repo solver.** Cả `Turnstile-Solver` (harvest token) lẫn
`cloudflare-bypass-2026` (SeleniumBase UC) đều solve ở MỘT NƠI rồi trả token/cf_clearance để dùng
chỗ khác. Không dùng được cho ta: `cf_clearance` bị Cloudflare khoá theo **IP + User-Agent + dấu
tay TLS**, nên token giải ở IP khác (hoặc bằng Python/Selenium — khác TLS với Node/Playwright của
worker) là vô hiệu ngay khi worker dùng. Đường duy nhất đúng kiến trúc: để CHÍNH browser của
worker bấm ô Turnstile, cùng phiên, cùng IP.

**Bản vá.** `attemptTurnstileClick` (runCycle.mjs) tìm iframe `challenges.cloudflare.com`, tính
toạ độ ô tick (`turnstileCheckboxPoint` — thuần, kiểm được), di chuột một quãng ngắn rồi bấm qua
toạ độ trang (xuyên được iframe khác gốc). Best-effort: không bao giờ ném, trả `{ clicked, note }`.
Gọi trong vòng chờ của `ensureReady`, nhiều nhất 2 lần mỗi màn, cách nhau 6s — màn managed
non-interactive không có ô thì `clicked=false`, ghi Debug rồi chờ tiếp như cũ.

**TẮT mặc định (`WORKER_SOLVE_TURNSTILE=1` để bật).** Chưa đo được với Cloudflare thật, và một cú
bấm sai chỗ trên hạ tầng CHUNG (nhiều đàn của người khác trên cùng worker) có thể làm Cloudflare
nghi hơn. Đáng bật nhất cho máy **IP dân dụng** — nơi nó có cửa ăn thua.

**Hai giới hạn nói thẳng:** (1) chỉ giúp màn Turnstile *tương tác*; (2) **không chữa gốc IP** —
một IP đã bị đánh dấu thì bấm kiểu gì cũng bị phát lại màn kiểm tra, đường chữa gốc là proxy dân
dụng. Lưới `verify:turnstile` (10 phép kiểm, Chromium thật + fixture iframe) đo được CƠ CHẾ — tìm
iframe, tính toạ độ, cú bấm rơi đúng vùng ô tick — nhưng KHÔNG đo được liệu Cloudflare có chấp
nhận, vì không dựng lại được màn ấy từ máy.

---

## 1.3.15 — Dính chân: một đàn ở lại với một khôi lỗi, thay vì đi tuần mười cái IP

Tông chủ, sau bản vá client hints: *"vẫn bị CF phát hiện nếu 1 tk chạy ở nhiều IP khác nhau cùng
lúc"*, kèm ảnh Turnstile「Xác minh bạn là con người」của `hoathinh3d.so`.

**Đo trước khi sửa** (`job_events`, 6 giờ gần nhất):

| tài khoản | số vòng | số khôi lỗi khác nhau |
|---|---|---|
| `fptshop` | 39 | **10** |
| `long01` | 41 | **10** |
| `vinhhades` | 8 | 7 |
| `gaga` | 11 | 7 |

Mỗi khôi lỗi là một IP khác — runner GitHub đổi IP mỗi lượt chạy — nên với Cloudflare thì đó
không phải mười lượt khách, mà là **một phiên đăng nhập nhảy qua mười địa chỉ trong một buổi
sáng**. `cf_clearance` gắn chặt với IP đã giải nó, nên mỗi cú nhảy là một lần trình diện từ một
địa chỉ chưa từng qua cửa: một màn Turnstile mới, và lần này là loại phải bấm.

Nguyên nhân nằm ở chính bộ cân tải luân phiên (0027): nó trải việc đều theo TỪNG VÒNG — đúng
điều nó sinh ra để làm, và cũng chính là thứ đẩy một tài khoản đi tuần khắp đội máy.

**Luật mới thêm một nấc TRƯỚC luân phiên** (`preferredRunner` trong `services/dispatch.ts`): đàn
nào đã có khôi lỗi chạy nó thì trả về đúng khôi lỗi ấy — **miễn là** nó còn trực, còn ghế, và vẫn
đủ tư cách. Ba điều kiện ấy là toàn bộ cái van an toàn, và cả ba đều có ca kiểm riêng.

**Dính chân là ƯU TIÊN, không phải sợi xích.** Bốn đường thoát, mỗi đường một ca:

- chủ cũ **vắng mặt** → đàn về luân phiên ngay, không chờ một giây nào;
- chủ cũ **hết ghế** → cũng ngay, và đây là đánh đổi có chủ ý: chờ một ghế trống có thể mất vài
  phút (trọn một vòng chạy), đắt hơn hẳn cái lợi của việc ở lại đúng IP;
- chủ cũ **không còn trong sổ** (đã bị gỡ) → về luân phiên;
- **van chống đói** (20 giây, có sẵn từ 0027) vẫn thắng tất cả — đàn quá hạn thì ai đủ tư cách
  cũng nhận được, dính chân thôi giữ chỗ.

Và dính chân **đi trước luân phiên cho chính chủ cũ**: nó không phải chờ tới lượt để nhận lại đàn
của mình. Thiếu vế này thì mỗi vòng lại là một cuộc đua mới, tức lại nhảy IP — đúng cái vừa vá.

**Cột thứ hai, không dùng lại `worker_id`** (migration `0029`): `worker_id` cố ý bị xoá về null
lúc đàn quay lại hàng chờ (0027) để bảng Hàng Đợi thôi vẽ ra một sự phân công không có thật. Phép
dính chân thì cần đúng cái ký ức ấy sống qua quãng cooldown, nên `last_worker_id` chỉ để NHỚ.
Migration điền sẵn từ `worker_id` cho những đàn đang chạy; đàn đang nghỉ vốn đã null nên không có
gì để chép, và null mang đúng nghĩa「chưa từng chạy, không ưu ái ai」.

`verify:dispatch`: **46 phép kiểm** (35 cũ + 11 ca dính chân), tất cả xanh · `tsc` sạch ·
`typecheck:scripts` đỏ đúng bốn tệp nợ cũ.

**Điều KHÔNG hứa:** đây chữa cảnh một tài khoản đi vòng quanh đội máy theo THỜI GIAN. Nếu đạo hữu
tự mở trang game ở nhà trong lúc khôi lỗi đang chạy chính tài khoản ấy thì vẫn là hai IP cùng lúc,
và không dòng mã nào ngăn được — đó là hai người dùng thật của cùng một phiên.

---

## 1.3.14 — Chromium thôi tự khai「HeadlessChrome」với Cloudflare

Tông chủ: *"fix lỗi chromium ở các khôi lỗi đang bị CF đánh captcha"*. Sổ `job_events` hôm nay có
đúng cảnh ấy — ba lượt chạy chết ở dòng「Màn kiểm tra (Cloudflare) của trang game không tự qua」—
và chỗ rò nằm ở nửa mà `userAgent` **không với tới được**.

**Đè `userAgent` chỉ sửa được một nửa danh tính.** Nó rewrite header `User-Agent` và
`navigator.userAgent`. Bộ **client hints** — `Sec-CH-UA`, `Sec-CH-UA-Full-Version-List`,
`navigator.userAgentData` — do CHÍNH BINARY tự khai và không đi theo phép đè ấy. Đo trên VM ngày
19/08/2026, đúng cấu hình khôi lỗi đang chạy:

```
user-agent : … Chrome/151.0.0.0 Safari/537.36            ← thứ ta đè
sec-ch-ua  : "Not=A?Brand";v="99", "HeadlessChrome";v="151", "Chromium";v="151"
```

Hai dòng nói hai chuyện khác nhau, và dòng thứ hai còn tự xưng là trình duyệt không đầu.
Cloudflare đối chiếu đúng cặp ấy. Chú thích cũ trong `runCycle.mjs` đã lo về chính phép đối chiếu
này và ghim số hiệu「151」cho khớp — nhưng nó chỉ khớp được phần SỐ, còn phần THƯƠNG HIỆU thì vẫn
là lời tự thú, nằm nguyên đó từ đầu.

**Chữa bằng CDP** `Emulation.setUserAgentOverride`, cửa duy nhất Chromium mở cho client hints. Ba
luật giữ nó khỏi thành một dấu vân tay tự chế:

1. **Mọi con số đọc từ chính binary** (`Browser.getVersion`) — hết ghim tay. Cái ghim「151」từng là
   một quả bom hẹn giờ: nâng playwright là nó lệch mà không ai thấy. Nay UA, client hints và
   binary không thể lệch nhau nữa vì cả ba lấy từ một nguồn.
2. **Chỉ thay đúng chữ「HeadlessChrome」thành「Google Chrome」**, giữ nguyên brand GREASE và
   「Chromium」của chính bản dựng ấy. Bịa cả danh sách là dựng một dấu vân tay không tồn tại ngoài
   đời — dễ nhận ra hơn cả cái nó định giấu.
3. **Hỏng thì KÊU rồi đi tiếp.** Không có phép đè, lượt chạy vẫn chạy (và trước hôm nay nó vẫn
   chạy như thế) — chỉ dễ ăn captcha hơn. Ném ở đây là đổi một cái bất lợi lấy một lượt chết hẳn.

Phiên CDP cố ý **không** `detach()`: phép đè sống theo phiên, gỡ phiên là trả trang về lời tự thú
cũ. Nó tự tan khi trang đóng.

**Đo được, trước và sau** (`verify:browser-fingerprint`, máy chủ nội bộ, không chạm mạng — vì
`127.0.0.1` là secure context nên client hints vẫn được gửi đủ):

```
sau : "Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"
      user-agent … Chrome/151.0.0.0 …    ← UA · hints · binary cùng một số hiệu
```

12 phép kiểm, gồm cả ca「UA, client hints và binary phải cùng số hiệu」— thứ sẽ đỏ ở lượt nâng
playwright sau này, đúng chỗ cái ghim cũ từng trôi lặng lẽ.

**Bản PC nhận cùng bản vá** (`jarvis-hh3d-pc@fa5276f`), và ở đó vết thương còn sâu hơn: UA ghim
`Chrome/131` trong khi Microsoft.Playwright 1.61.0 ship **Chromium 149.0.7827.55** — lệch 18 đời.
Đo trên chính bản Chromium ấy bằng đúng khối mã đã port: `sec-ch-ua` nay khai
`"Google Chrome";v="149"` khớp UA `Chrome/149.0.0.0`. Bản desktop còn áp phép đè cho **cả tab do
site mở lẫn tab worker tự mở** — phép đè là của từng target, một tab bỏ sót là một tab đi khai
HeadlessChrome trong khi tab chính thì không.

**Điều KHÔNG hứa:** đây là gỡ một tín hiệu bot **chắc chắn** đang tự phát ra, không phải một lời
hứa hết captcha. Danh tiếng IP (khôi lỗi GitHub chạy trên dải IP trung tâm dữ liệu) là một yếu tố
lớn hơn và nằm ngoài tầm mã nguồn. Đo thử ngay lúc vá từ IP của VM thì trang **không** dựng màn
kiểm tra cho cả bản cũ lẫn bản mới, nên lượt vá này **chưa tái hiện được** cảnh captcha để chứng
minh kết cục — thứ chứng minh được là tín hiệu đã tắt. Một dấu hiệu ủng hộ: máy nhà của một đạo hữu
(IP dân cư, không phải trung tâm dữ liệu) cũng ăn màn kiểm tra hôm nay, tức dấu vân tay có phần của
nó trong đó.

---

## 1.3.13 — Hỷ Sự Đường có bản VIP (schema hồ sơ 71)

Tông chủ chốt: chép flow Hỷ Sự Đường từ hạng thường sang cho hạng VIP. Và chép ở đây nghĩa là
**dùng lại**, không phải nhân bản: `WeddingHallFree(L)` thành `WeddingHall(L, requiresVip)`,
hai lượt gọi, đúng khuôn mọi cặp sinh đôi khác trong tệp (Hoang Vực, Khoáng Mạch, Mê Cung,
Luyện Đan). Hai bản khác nhau ĐÚNG hai trường: `Id` và `RequiresVip`.

**Vì sao một bộ bước phục vụ được cả hai hạng** — điều này KHÔNG đúng với mọi quest, nên phải
nói rõ: cả đường đi của Hỷ Sự Đường đều nằm trên trang chung. Sảnh treo trên `/tien-duyen`,
phòng cưới là `/hong-nhan` và `/phong-cuoi`; không trang nào có nhánh riêng cho hạng, không
selector nào trong bộ bước hỏi tới hạng. Ba quest cùng mục tiêu mà dùng selector khác nhau
giữa hai hạng (Điểm Danh, Phúc Lợi, Thí Luyện) là lý do `questsForAccount` tồn tại — cặp sinh
đôi ở đây sinh ra vì cái cửa chia việc ấy, chứ không vì hai trang khác nhau.

**Một khác biệt đã đo được nhưng chưa có bản ghi**, ghi ra để khỏi phát hiện lại: thân trả lời
`show_all_wedding` mang `is_vip` và `show_auto_blessing` — bản ghi 18/08 quay trên tài khoản
thường nên cả hai đều `false`. Nếu site vẽ thêm nút chúc-tự-động cho VIP thì bộ bước này không
biết dùng: nó vẫn đi từng phòng, tức CHẬM HƠN chứ không sai. Muốn dạy nó phải có bản ghi trên
tài khoản VIP; đừng đoán markup của cái nút ấy.

**`FREE_ONLY_QUESTS` đã gỡ.** Hỷ Sự Đường là thành viên cuối cùng của khái niệm「nhiệm vụ chỉ
hạng thường」; giữ lại một mảng rỗng cùng hai chỗ spread không bao giờ spread gì là mã chết.
Luật nó canh thì vẫn còn giá trị nên được chép vào doc của `FREE_QUESTS`: một khoá chỉ được vào
`SIMPLE_QUESTS` khi hồ sơ CÓ bản VIP để chạy, bằng không ô tick ở tab VIP là lời hứa suông.

Lưới: năm phép kiểm mới — đủ cặp và đúng hạng mỗi bản; hai khối khác nhau đúng hai trường (kể
cả `note`); hai bản cùng TÊN, vì lớp dịch cấu hình tìm quest theo tên nên lệch tên là cách im
lặng nhất để một tài khoản VIP bật mà không có gì chạy; một công tắc `hySuDuong` bật cả hai;
và `questsForAccount` phát đúng một bản cho mỗi hạng, không tài khoản nào chạy cả hai.

---

## 1.3.12 — Nhật ký của đàn thôi hiện đôi

Tông chủ chụp lại hai dòng liền nhau, cùng giây `16:49:38`:

```
Quest:Mê Cung: đã đủ huyền tinh hôm nay
Mê Cung: đã đủ huyền tinh hôm nay
```

Soi ra **HAI** nguồn chứ không phải một, và cả hai đều tất định. Đo trên `job_events` thật của ba
ngày gần nhất (7.490 dòng, trong đó 2.031 mang tiền tố `Quest:`):

**Lớp 1 — 323 đôi, trải 11 nhiệm vụ.** `stopIf` khớp thì `engine.mjs` kể lý do dừng ở mức info
(`Quest:<tên>: <lý do>`), rồi chính `stopReason` ấy đi tiếp vào `result.message` và `OUTCOME_TEXT`
của `runCycle` kể lại y hệt (`<tên>: <lý do>`). Hai dòng khác nhau đúng tiền tố `Quest:` của
scope. Đo được cách nhau **3ms** — và vì cả hai đều là POST bắn-rồi-quên nên thứ tự còn đảo qua
đảo lại giữa các lượt, khiến một lỗi trông như hai.

**Lớp 2 — 414 dòng.** Từ schema 45 mỗi tên nhiệm vụ là một CẶP flow VIP/thường dùng chung cấu
hình, nên mọi vòng dịch trong `profileForConfig` chạy hai lượt và `setOption` kể lại hai lần:
`Option 'kickIdle' của「Mê Cung」nhận giá trị tự nhập: '20'.` × 2, cách nhau **156ms**.

**Chữa ở NGUỒN, không lọc ở chỗ hiển thị — và đây là phần đáng ghi nhất.** Một phép lọc
「hai dòng giống nhau trong N giây thì bỏ một」nghe gọn hơn nhiều, nhưng nó quét luôn một lớp thứ
ba mà ta KHÔNG được mất: `Quest:Khoáng Mạch: Đang ở đúng mỏ «Hỗn Độn»` lặp lại là hai VÒNG CHẠY
khác nhau (đo được cách nhau 8 phút), và vòng `repeat` kể lại sau một cú tải lại trang là lời khai
ĐÚNG rằng nhiệm vụ đã được thử hai lần. Lọc theo thời gian không phân biệt nổi「nói hai lần」với
「xảy ra hai lần」; sửa ở nguồn thì không phải phân biệt.

- **`engine.mjs`**: gỡ `log.info(scope, state.stopReason)` ở nhánh `stopIf`. Lý do dừng vẫn tới tay
  người đọc — người kể nay là vòng chạy, và dòng của nó sạch hơn (không tiền tố `Quest:`) lẫn đúng
  khuôn với mọi nhiệm vụ khác. Ngả `onCooldown` còn gộp được đồng hồ vào cùng một dòng:
  `Mê Cung: đang chờ — còn 2h 5m (đã đủ huyền tinh hôm nay)`.
- **`profile.mjs`**: `profileForConfig` lọc trùng ngay tại CỬA RA (một `Set` bọc lấy hàm `say` của
  người gọi), chứ không lọc ở từng vòng dịch. Đặt ở cửa ra vì hai lẽ: người gọi nào cũng khỏi tự
  lọc, và một vòng dịch thêm sau này không kéo cái lỗi ấy sống lại. Lọc được mà KHÔNG mất gì, vì
  tên nhiệm vụ nằm sẵn trong mọi câu — trùng chữ nghĩa là trùng cả nhiệm vụ lẫn option.

**Một lưới cũ đang bám đúng dòng vừa gỡ, và nó nói lên vì sao dòng ấy từng tồn tại.** Chốt
「nhật ký kể lý do trần, không lộ từ ngữ của script」(sinh từ ảnh 05/08) đọc `infos` để chắc rằng
người đọc thấy「đã tế lễ hôm nay」chứ không phải「stopIf khớp」. Ý định ấy còn nguyên giá trị — chỉ
là nó phải hỏi ĐÚNG CHỖ. Nay nó hỏi `result.message`, hợp đồng thật của engine; nửa canh
「không lộ stopIf/repeat/until」giữ y nguyên. Đây là chỗ dễ sa vào việc sửa lưới cho vừa mã: phân
biệt nằm ở chỗ ý định được giữ, chỉ đổi nhân chứng.

Thêm ba chốt canh chính cái lỗi này: engine KHÔNG được tự kể lý do dừng; một câu dịch phải ra đúng
một lần dù nhiệm vụ có cặp flow; và không câu dịch nào được kể hai lần.

**Kiểm chứng.** `npm run smoke` **440 thuận, 0 nghịch** (bốn chốt liên quan đều xanh, trong đó chốt「engine KHÔNG tự kể lý do dừng」chạy qua trình duyệt thật trên nhiệm vụ Tế Lễ). Đo trực tiếp lớp 2 trước/sau trên cùng
một cấu hình: **10 dòng (5 bản sao) → 5 dòng, 0 bản sao**. Và một phép so sâu 24 ca cấu hình giữa
`profileForConfig` cũ và mới: hồ sơ trả về **giống hệt** — phép lọc không chạm gì tới việc dịch,
cả hai twin vẫn nhận đủ option. `npx tsc --noEmit` sạch; `typecheck:scripts` đỏ đúng bốn tệp nợ cũ.

Hai lưới đang đỏ SẴN, không liên quan bản vá này (phép so sâu ở trên là bằng chứng): `verify:maze-cap`
đòi vòng ngoài 6 lượt trong khi hồ sơ nay khai 18, và `verify:phu-daily` đòi chuỗi「doat thanh cong」
mà `ca2cd48` đã đổi sang nghe xác nhận ở ngả mạng.

---

## 1.3.11 — Từ điển tên kho: 38 chữ → 465 chữ

Tông chủ: *"random ít tên quá dẫn tới dễ trùng nhiều"*. Đúng, và chỗ nó trùng không phải chỗ dễ
đoán nhất — nên ghi lại cho rõ **cái gì hỏng và cái gì thì không**.

**Không hỏng:** tên trùng khít. Đuôi 4 hex vốn đã lo việc ấy — 360 cặp × 65536 ≈ 23,6 triệu, nên
một cú đụng độ thật là chuyện của thần thoại.

**Hỏng:** **giống mặt nhau**. Cả cú đổi sang tên ngẫu nhiên ngày 17/08 sinh ra để mỗi kho đứng một
mình, mà 20 từ đầu × 18 từ đuôi thì chín kho gần như chắc chắn có mấy cái chung một nửa. Sổ ngày
19/08 đo được đúng thế: `vellum-loom-ee60` và `vellum-loom-bd35` trùng **cả cặp**, `amber-bridge` /
`amber-render` chung từ đầu, `jade-pier` / `garnet-pier` chung từ đuôi. Ba cái tên như vậy nằm trên
ba tài khoản khác nhau vẫn nhận ra nhau bằng mắt thường — tức cái đàn vẫn lộ, chỉ là lộ chậm hơn.

Nay **221 từ đầu × 244 từ đuôi = 53.924 cặp**, và đây là con số đo được chứ không phải ước:

| với 9 kho | 20 × 18 = 360 | 221 × 244 = 53.924 |
|---|---|---|
| trùng cả cặp | 9,59% | **0,07%** |
| chung từ đầu | 88,10% | **15,21%** |
| với 50 kho, trùng cặp | 97,19% | **2,25%** |
| trần cả tên (× 65536) | 23,6 triệu | **3,53 tỉ** |

Chạy 200.000 lượt rút thử 9 kho bằng chính `randomSoftwareName`: trùng cặp ở **0,06%** số lượt —
khớp với lý thuyết. Con số「chung từ đầu」vẫn còn 15%: đó là trần của 221 từ, và nới tiếp thì lợi
giảm dần, nên dừng ở đây là có chủ ý chứ không phải quên.

**Cái giá của một cú trùng, thứ khiến việc này đáng làm hơn vẻ ngoài của nó:** phép soát trùng
`WORKER_ID` bên `newGithubStation.mts` đứng **SAU** lượt dựng kho, nên một cú đụng để lại một **kho
công khai mồ côi** trên GitHub, phải vào xoá tay. Đó là lý do lời giải là nới rổ từ chứ không phải
thêm một vòng rút-lại ở cửa ấy.

Ba luật mới do lưới canh, mỗi luật chống một kiểu hỏng riêng: mỗi từ chỉ `a-z` và dài 3–10 (một
dấu gạch lọt vào là `GENERATED_NAME_SHAPE` thôi khớp chính cái tên ta vừa sinh, tức lượt XOÁ mất
bộ lọc khoanh vùng); không từ nào chép hai lần trong một rổ (một từ được rút với xác suất gấp đôi
là thứ không ai thấy khi đọc mảng); và **hai rổ không giao nhau** (`prism-prism-4f2a` đọc lên là
biết ngay có máy sinh ra nó). Sàn 150 từ mỗi rổ + 20.000 cặp cũng vào lưới, thay cho sàn 10 cũ —
sàn ấy chỉ chống được cảnh「ai đó xoá gần hết rổ」, không chống được cái hỏng thật.

`verify:khoiloi-naming`: **502 phép kiểm**, tất cả xanh — trong đó 465 phép soi từng từ một trong
hai rổ trước danh sách cấm mười một chữ. Kho và khôi lỗi đang chạy giữ nguyên tên; luật chỉ áp cho
tên sinh ra từ hôm nay.

---

## 1.3.10 — `github:revive`: dựng dậy khôi lỗi đã chết đứng, không chờ hết bốn giờ

Tông chủ gửi ảnh tab Khôi Lỗi 19/08/2026: năm khôi lỗi「đang trực」ở bản 1.3.9, bốn cái khác xám
ngắt kèm「vắng 1 giờ 37 phút」và đứng nguyên ở bản 1.3.6. Lượt Actions của chúng vẫn còn đó —
runner bên trong đã chết (hết RAM, đứt mạng, GitHub cắt ngang) mà lượt chạy thì chưa kết thúc, nên
`schedule` không phát lượt mới và bốn cái ghế ấy nằm chết tới bốn giờ.

**Vì sao `--restart` không chữa được cảnh này** — và đây là lý do lệnh mới đáng tồn tại chứ không
phải một cờ nữa: hai bên hỏi hai câu khác nhau, bằng hai loại bằng chứng khác nhau.

| | câu hỏi | bằng chứng | chừa ai |
|---|---|---|---|
| `deploy --restart` | lượt này có mang MÃ CŨ không | `head_sha` | khôi lỗi đang giữ đàn |
| `github:revive` | khôi lỗi này còn SỐNG không | sổ điểm danh | khôi lỗi đang trực |

Một runner đã ngừng gõ cửa là một cái xác còn chiếm ghế — dù nó đang chạy đúng bản mới nhất, nên
phép so `head_sha` không nhìn thấy nó. Ngược lại, `revive` không quan tâm mã cũ hay mới; nó chỉ
hỏi sổ điểm danh.

**Nó KHÔNG hỏi `heldJobs`, và đó là chủ ý.** Nghe liều nhưng ngược lại: một khôi lỗi im quá
`STALE_AFTER_MS` (3 phút) đã bị `reapStaleJobs` tước sạch đàn từ lâu, nên tới lúc ngưỡng mặc định
(10 phút) chạm tới thì không còn đàn nào để cắt. **Hàng rào thật là NGƯỠNG**, và nó rộng có lý do:
10 phút = 20 lần cửa sổ「vắng mặt」30 giây của sổ điểm danh, đủ cho một lượt bàn giao giữa hai lượt
Actions hay một nhịp mạng xấu. Khôi lỗi gõ cửa mỗi 5 giây thì không đời nào lọt vào danh sách.

**Lượt ĐANG XẾP HÀNG không bị cắt.** `cancel-in-progress: false` giữ đúng một-chạy-một-chờ, nên
lượt đang chờ chính là thứ sắp hồi sinh khôi lỗi ấy — cắt nó rồi phát lại một lượt y hệt là tự làm
chậm mình. Cùng lẽ ấy: đã có lượt chờ thì KHÔNG phát thêm.

Ba chi tiết nhỏ mà thiếu là hỏng: `WORKER_ID` đọc theo luật cũ (sổ trước, tệp workflow sau — đoán
bừa ở đây là đọc sổ điểm danh của một khôi lỗi KHÁC rồi cắt nhầm lượt); nhánh để `dispatch` **hỏi
GitHub** (`default_branch`) chứ không đoán là `main`; và sổ điểm danh chỉ lấy dòng `user_id is
null` — máy nhà của đạo hữu không do lệnh này dựng lên.

Lệnh này **không đẩy một byte mã nào**. Muốn vừa hồi sinh vừa nâng bản thì `github:deploy
--restart` trước, `github:revive` sau.

Cửa bấm đúp: `revive-github-khoiloi.bat` (xem trước → hỏi → làm thật, cùng khuôn với
`force-github-khoiloi.bat`). Lưới: `verify:github-deploy` thêm mục 6b — 13 khẳng định thuần cho
`reviewRevive`, gồm cả hai ca biên ngưỡng, ca「chưa từng điểm danh」và ca「đã có lượt xếp hàng」
— 91 phép kiểm, tất cả xanh.

---

## 1.3.9 — Hỷ Sự Đường khai hồng bao ở CẢ phòng Đạo Lữ (schema hồ sơ 70)

Bản ghi `hy-su-duong-20260819-110345`, kèm lời dặn của tông chủ nằm ngay trong `steps.json`:
「check phòng cưới loại đạo lữ nào mà có Trạng thái lì xì: Đã phát lì xì nhé, sau đó bấm vào chúc
ngay để vào phòng đó nhận lì xì」→「sau khi vào phòng bấm mở lì xì」.

Cụm hồng bao của schema 69 chỉ biết bộ id **`#hn*`** của phòng Hồng Nhan. Phòng **Đạo Lữ**
(`/phong-cuoi`) dùng bộ id TRẦN — `#liXiModal` · `#openButton` · `#closeButton`, thiệp thưởng là
`#rewardReveal > #rewardItem` với `.lixi-reward-name` / `.lixi-reward-amount`. Nên flow vào tới
phòng, đứng nhìn cái khay, rồi đi ra: hồng bao hết hạn theo tiệc mà mọi dòng nhật ký vẫn xanh.

**Mọi thứ khác trùng khít giữa hai họ phòng** — khay mở sẵn che kín trang, nút khai nhận
`display:none` ngay khi máy chủ nhận, thiệp lật ra tên + số lượng, và CÙNG một endpoint
(`POST /wp-json/hh3d/v1/action`, `action=hh3d_receive_li_xi`, `wedding_room_id`; bản ghi đo được
41 Tiên Ngọc). Nên bản vá là một phép **hợp selector**, không phải một nhánh thứ hai: thêm một họ
id nữa sau này chỉ tốn một dấu phẩy.

Cửa vào không phải đụng một dòng: nó vẫn là lời hứa của danh sách
(`.wedding-now-li-xi-available`「🧧 Có lì xì chưa mở!」), và bản ghi cho thấy dòng ấy nằm trên mục
Đạo Lữ y hệt mục Hồng Nhan.

Sửa kèm một ghi chú SAI trong nguồn: điều 3 của khối tài liệu Hỷ Sự khai `.lixi-envelope` 「chỉ là CSS bên Đạo Lữ」— probes của bản ghi này đo được nó là một `<div>` 81×81 có thật trong
khay. Nó vẫn không phải cái để bấm, nhưng lý do thì khác hẳn, và lượt đo 11/08 sai vì rơi vào một
phòng không có hồng bao nên khay chưa được dựng.

Fixture nay dựng khay Đạo Lữ chép từ `dom/10-load.html` + `dom/12-click.html`, giữ đúng ba chỗ
khác biệt (bộ id trần · khay `.active` ngay từ lúc trang vẽ xong, không có nhịp 1,2 giây · có
`.lixi-envelope` thật), và định tuyến phòng trong fixture nay chọn theo HỌ PHÒNG thay vì theo
`preBlessed`.

## 1.3.8 — Tab Khôi lỗi mở cho mọi đạo hữu, và tên máy hiện ở tab Hàng đợi

Tông chủ ra lệnh 19/08/2026: môn đồ thường từ nay thấy danh sách khôi lỗi **giống hệt** bậc trị
sự, và tab Hàng đợi hiện luôn tên máy đang cầm mỗi đàn — nhưng **không** được thấy nút Dừng.

**Đây là một ranh giới được DỊCH có chủ ý, không phải một chỗ rò rỉ**, nên nó được ghi lại đúng
lối mà cú đổi phía của tên nhiệm vụ ngày 08/08 đã ghi. Luật cũ (12/08–19/08): id khôi lỗi tông
môn chỉ bậc trị sự thấy, môn đồ thường nhận MỘT dòng gộp「có ai đó đang trực」, với lập luận rằng
id một tiến trình tông môn là chi tiết vận hành (máy nào, trạm nào) mà môn đồ không dùng được vào
việc gì, còn tông môn thì hở ra hình dạng hạ tầng của mình. Lập luận ấy bị bác vì một lẽ khác:
đây là hạ tầng **của chung**, cả tông môn đang xếp hàng chờ nó, nên「đàn của tôi đang nằm trong
tay tiến trình nào」là một phần của chính câu hỏi trang này sinh ra để trả lời.

**Cái KHÔNG dịch, và đó mới là phần phải canh:**

- **Khôi lỗi RIÊNG của người khác** vẫn không bao giờ đi xuống dây — không id trong sổ, không id
  trên dòng đàn, kể cả với bậc trị sự. Máy ở nhà người ta không phải hạ tầng của tông môn.
- **Nút Dừng / Khai hộ** vẫn nằm sau `job.force_stop` / `job.force_start` (Thái thượng trưởng lão
  trở lên), gác ở `forceStopJobAction` chứ không ở giao diện. `verify:permissions` đóng đinh ma
  trận ấy: `de-tu` và `chuong-mon` KHÔNG có. **Thấy không phải là được chạm.**

**Không dòng giao diện nào phải sửa** — và đó là bằng chứng cho một quyết định cũ đã đúng: cả
`QueueBoard` lẫn `describeAssignment` vốn không hỏi quyền, chúng chỉ vẽ thứ service đưa. Nên cú
dịch này gọn trong hai chỗ: bỏ tham số `detailed` của `getWorkerRoster`, và bỏ `canInspectSect`
khỏi `visibleWorkerId`. `hasPermission` rời khỏi `services/queue.ts` hoàn toàn, và `QueueViewer`
teo lại còn `{ id }` — một trường không ai đọc là một lời hứa suông về việc có phép gác.

Dòng GỘP (`id: null`) không bị xoá: nó còn đúng một việc — nói「tông môn đang vắng」khi sổ chưa có
khôi lỗi nào (trạm vừa dựng, hay vừa chuyển trạm), để người xem không phải đoán giữa「vắng」và
「trang hỏng」. Trần `ROSTER_LIMIT = 10` mỗi nhóm giữ nguyên, tức môn đồ thường nhận đúng cùng
một danh sách bị cắt như bậc trị sự — "giống hệt" nghĩa là giống cả chỗ ấy.

Lưới: `verify:queue-pools` thêm 6 khẳng định thuần cho `visibleWorkerId` (bốn tổ hợp, cộng hai ca
「chưa ai cầm」), 37 khẳng định tất cả xanh. `verify:continuous` viết lại năm khẳng định vốn đóng
đinh luật CŨ, và giữ nguyên phép quét thô trên nguyên payload cho vế không dịch — nay quét id máy
nhà của người khác bằng **cả hai** con mắt, chứ trước chỉ quét một. Chạy trên database thật của VM:
xanh.

---

## 1.3.7 — Sổ Kho GitHub bỏ trần 8, và vòng nuôi thôi lặp theo thứ tự sổ

Tông chủ gõ `new-github-khoiloi.bat` và bị chặn bằng *"Sổ đầy (8 kho) — dọn kho chết trên tab Kho
GitHub trước"*, rồi ra lệnh gỡ trần. Soát trước khi gỡ cho thấy trần ấy đứng trên hai lý lẽ rất
khác nhau, và chỉ một trong hai là thật.

**Lý lẽ mềm** — *"danh sách do người gõ tay, quá tám dòng thì thứ cần sửa là cách làm việc"* — là
một lời khuyên về cách vận hành, tức lựa chọn của tông chủ chứ không phải của mã. Gỡ.

**Lý lẽ thật** — `runKeepalive` chạy TUẦN TỰ và tự cắt ở `LOOP_BUDGET_MS` (40 giây) — thì không
gỡ được bằng cách xoá một hằng số, vì nó không nằm ở con số 8 mà nằm ở **THỨ TỰ LẶP**: vòng nuôi
đi theo đúng thứ tự sổ, tức thứ tự người ta thêm vào. Sổ ngắn hơn ngân sách thì vô hại; sổ dài
hơn thì **cú cắt rơi vào đúng cái đuôi ấy ở mọi lượt chạy** — mấy kho cuối không bao giờ tới lượt,
im lặng 60 ngày rồi bị GitHub tắt lịch, đúng cái chết mà cả hệ nuôi kho sinh ra để ngăn. Và
`skipped` trong bảng tổng kết vẫn chỉ nói "còn n kho chưa tới lượt", không nói "vẫn là n kho ấy".
Gỡ trần mà không thay hàng rào là **đổi một câu chối từ ồn ào lấy một cái chết lặng lẽ**.

Nên trần đi cùng một luật mới, `keepaliveOrder` (thuần, `validation/githubStations.ts`): xếp theo
`lastCommitAt` cũ nhất trước — rỗng hoặc không đọc được thì coi như cũ nhất, cùng lẽ với
`isCommitDue` — rồi `lastPingAt` cho sổ mới toanh, rồi tên kho để thứ tự không nhấp nhổm giữa hai
lượt chạy. Hệ quả: cú cắt luôn bỏ lại kho CÒN NHIỀU HẠN nhất, và mọi kho đều tới lượt đứng đầu.
Sổ dài hơn ngân sách từ nay chỉ có nghĩa *"phải vài lượt cron mới phủ hết"*.

**Ngân sách 40 giây giữ nguyên, có đo mới nói.** Nhật ký `jarvis-cron` lúc 03:00:24→25 UTC ngày
18/08: 8 kho khoẻ **cộng** ba việc quét dọn xong trong dưới một giây — ~0,12s một kho, tức 40 giây
đủ cho hàng trăm kho ở đường sung sức. Trần chỉ có tiếng nói vào ngày GitHub treo (mỗi kho tối đa
3 × 10s), và đó đúng là ngày nên dừng sớm để lượt mai tiếp — nay an toàn vì thứ tự đã công bằng.
Đường gọi thật (`curl -m 300` từ `jarvis-cron.timer`) cho tới 300 giây, nhưng nâng lên chẳng mua
được gì mà lại lệch với `maxDuration = 60` đang khai ở `/api/cron`.

**Không cần migrate.** `appSettingsSchema` không có `.max()` trên mảng `githubStations` (đã soát),
nên một dòng thứ chín chưa bao giờ có thể làm hỏng phép gán settings. Và `recordPing` tìm kho
theo **slug** chứ không theo chỉ số, nên đổi thứ tự lặp không thể ghi lệch dòng.

Bốn chỗ gỡ: cửa chặn trong `saveGithubStationAction`, hai cửa trong `github:new` (một trước khi
tạo, một sau khi tạo để bắt cảnh sổ vừa đầy giữa lúc dựng), và hằng `GITHUB_STATION_LIMIT`. Lý lẽ
cũ trong `github:remove` ("mỗi dòng ma là một chỗ ngồi bị chiếm") cũng chết theo, nhưng dòng ma
vẫn đáng dọn vì lý do MỚI: `keepaliveOrder` xếp mốc rỗng lên đầu, nên nó ăn ngân sách trước cả kho
còn thật.

`verify:github-stations` thêm một nhóm ca cho luật thứ tự, gồm **ca đói hai lượt** (ngân sách đủ
hai kho, sổ có năm: kho bị bỏ lại lượt trước phải được nuôi lượt sau) và **một ca đối chứng** giữ
vĩnh viễn: cùng cảnh ấy với cách lặp CŨ phải nuôi lại đúng hai kho đầu và không bao giờ với tới
kho cuối. Thiếu ca đối chứng thì mấy assert kia có thể xanh chỉ vì cảnh dựng quá dễ — cùng kỷ luật
với ca "gỡ bước nhân chứng" của Bí Cảnh. 13 nhóm ca, tất cả xanh.

---

## 1.3.6 — Hỷ Sự Đường khai hồng bao, kể cả ở tiệc đã chúc (schema hồ sơ 69)

Bản ghi `hy-su-duong-20260818-094945`, và một ghi chú của tông chủ nằm ngay trong `steps.json`:
「nếu thấy phòng cưới hồng nhan nào có `trạng thái: đã chúc` và `Trạng thái lì xì: Đã phát lì xì`
thì bấm vào chúc ngay để nhận lì xì nhé」.

**Ba lỗ hổng, và cái đầu tiên là một khoản mất tiền im lặng.**

1. **Phòng chỉ-còn-hồng-bao không bao giờ được ghé.** Hàng ấy mang
   `.wedding-now-li-xi-available`(「🧧 Có lì xì chưa mở!」) nhưng trạng thái chúc là `.blessed`,
   mà bộ lọc mặc định là `.not-blessed` — nên hồng bao nằm đó tới lúc tiệc tan (bản ghi:「Thời
   gian còn lại: 5 giờ」) rồi mất hẳn. Không một dòng nhật ký nào đỏ, vì theo bộ lọc thì lượt
   chạy đã làm đúng việc của nó. Bộ ứng viên nay là HỢP của hai tập: khớp bộ lọc, HOẶC còn hồng
   bao chưa khai. Bộ lọc giữ nguyên nghĩa cũ cho phần chúc; hồng bao thì không hỏi ý ai, vì nó
   không tốn gì và mất là mất hẳn.
2. **Khay hồng bao che kín form chúc.** `#hnLiXiModal` tự mở ~1,2 giây sau khi trang phòng vẽ
   xong, `position:fixed; inset:0; z-index:10002`, và khi `.active` thì `pointer-events:all`.
   Một phòng vừa chưa chúc vừa có hồng bao sẽ nuốt trọn cú bấm「Gửi Chúc Phúc」. Nên cụm hồng
   bao chen vào GIỮA bước chờ phòng và bước đọc trạng thái chúc, và bước đóng khay chạy kể cả
   khi khai trượt.
3. **`.lixi-envelope` là một phép đoán, và nay đo được là sai ở cả hai loại phòng.** Bên Đạo Lữ
   nó chỉ là CSS trong thẻ `<style>` (đo 11/08), bên Hồng Nhan `grep dom/08-load.html` ra 0. Đã
   gỡ khỏi cả hồ sơ lẫn fixture. Cái có thật là `#hnOpenBtn` trong khay; bấm nó là một POST
   `hh3d_receive_li_xi` trả về đúng món thưởng (bản ghi đo được 49 Tiên Ngọc).

**Phép hỏi hiển thị trong khay phải LEO NGƯỢC lên cha.** `conditionProbe` của engine chỉ đọc
chính phần tử, mà `#hnOpenBtn`/`#hnCloseBtn` vẫn có kích thước thật khi khay đang
`opacity:0; pointer-events:none` — hỏi thẳng cái nút thì một phòng KHÔNG có hồng bao cũng trả
lời「có」, rồi đẻ ra một dòng TRƯỢT oan cho mỗi phòng. Nên `WeddingLiXiScanScript` tự leo cây
cha, và hai cờ nó cắm (`jvz-hy-su-lixi` / `jvz-hy-su-lixi-box`) mới là thứ các bước dưới hỏi.
Bước chờ thì hỏi thẳng `Visible #hnLiXiModal` được, vì `opacity` nằm trên chính cái khay.

**Khai trượt KHÔNG giết lượt** — khác hẳn lời chúc. Một lời chúc tiêu 30 Tiên Ngọc nên trượt
phải kêu to tới mức hỏng cả nhiệm vụ khi mọi phòng đều trượt (`jvz-hy-su-all-failed`); hồng bao
không tốn gì và còn nguyên bên máy chủ cho lượt sau, nên nó chỉ kêu trong lời kể.

**Và một chuyện đáng ghi hơn cả bản vá: nguồn C# đang THIẾU một bản vá web đã ship.** Lượt xuất
hồ sơ đầu tiên của hôm nay cắt mất nửa Hồng Nhan của ba selector —
`#hn-select, .hn-already-blessed` ở bước chờ phòng, `#hn-bless-btn` ở nút gửi,
`#hn-confirm-modal .hn-modal-btn.confirm` ở hộp xác nhận — cùng ba script đọc chúng. Không phải
công cụ xuất sai: `git log -S "hn-bless-btn"` bên kho PC ra RỖNG, bên web ra `29e4fd1`. Bản vá
hai-loại-phòng ấy chưa từng về tới nguồn. Ghép thẳng bản xuất là một bước lùi ngay giữa lượt vá
đang nói về chính phòng Hồng Nhan — và bộ chạy thử đã bắt được nó: ba ca đỏ với
「trang phòng không có form chúc lẫn dấu đã chúc」. Lượt này chép ngược nội dung ĐANG CHẠY từ
`HEAD:profile.json` về `DefaultQuestProfile.cs` trước, rồi mới xuất lại.

Bài học cho lưới ghép: **「quest nào lệch」là chưa đủ, phải soi「lệch CHỖ NÀO」** — với chính
quest mình đang sửa thì mọi khác biệt đều dễ bị đọc thành「việc của mình」.

Fixture chép từ bản ghi: hàng modal có dòng「Có lì xì chưa mở!」và nút `.has-gift-btn`; trang
phòng Hồng Nhan có khay thật, gắn `.active` sau 1,2 giây đúng nhịp đo được, và khay dựng sẵn
**kể cả ở phòng không có hồng bao** — cố ý khó hơn đời thật, vì đó là ca duy nhất bắt được lỗi
「hỏi thẳng cái nút」ở trên.

---
## 1.3.5 — Hoang Vực lĩnh phần thưởng treo TRƯỚC khi khiêu chiến (schema hồ sơ 68)

Bản ghi `hoang-vuc-20260818-013720`, kèm hai lời dặn của tông chủ nằm ngay trong `steps.json`:
「lúc vào page của hoang vực nếu ko thấy nút khiêu chiến thay vào đó là nút nhận thưởng thì sẽ
nhận thưởng thay vì khiêu chiến nhé」→「sau đó tiến hành flow khiêu chiến như bình thường」.

**Đây không phải một tính năng thêm — nó là một cái bẫy đang mở.** Khi boss đời trước bị hạ mà
thưởng mốc sát thương chưa lĩnh, trang vẽ khối boss KHÁC HẲN: ảnh xám `…-die.png`, HP `0.00%`,
và chỗ `#battle-button` là `#reward-button`「Nhận thưởng」. Cùng lúc biến mất luôn
`#change-element-button`, `.remaining-attacks`, `#countdown-timer` — `probes.json` của chính bản
ghi đo đủ cả bốn ("no match"). Kịch bản cũ rơi thẳng vào lưới cuối「nút KHIÊU CHIẾN không có
trên trang」— một `StopIf` KHÔNG kèm đồng hồ, tức `alreadyDone` — mà `hoang-vuc` nằm trong
`DAILY_QUOTA_QUEST_IDS`, nên lượt ấy **khoá cả ngày**: phần thưởng nằm đó không ai lĩnh, và 5
lượt đánh của boss mới mất trắng theo. Im lặng hoàn toàn, mọi dòng nhật ký đều xanh.

**Bản vá**: một cụm 7 bước chèn ngay sau cổng render, trước mọi cửa sổ chờ.

- `HvRewardScanScript` hỏi CHÍNH cái nút, không suy từ ảnh boss xám hay HP 0% — ảnh là trang trí
  của trạng thái ấy, nút mới là thứ bấm được; trang đổi ảnh die thì phép đọc theo ảnh chết lặng.
- `HvRewardTellScript` kể món vừa lĩnh, đọc từ `.reward-item`/`.amount` của hộp `Thành công!`
  (bản ghi: 1800 Tu Vi · 390 Tinh Thạch · 120 Tinh Huyết · 300 Tiên Ngọc — khớp từng số với thân
  trả lời AJAX `claim_chest`).
- Lĩnh xong thì **tự `Navigate` lại** thay vì đợi lượt tải lại của site: trang thật CÓ tự tải lại
  khi hộp đóng, nhưng đặt nhịp sau vào tay một thứ mình không điều khiển là chỗ để hỏng.
- Bước chờ hộp và bước đóng hộp đều `optional`/có `when`: cú bấm đã đi rồi thì phần thưởng đã vào
  túi, một cái hộp hụt không được phép giết cả lượt.

Bộ chạy thử có **ca đối chứng giữ vĩnh viễn**: bỏ cụm lĩnh thưởng ra khỏi kịch bản thì trên CÙNG
fixture ấy phải khai `alreadyDone` + `dailyCapReached` và không lĩnh gì — fixture nào để kịch bản
cũ đi qua êm là fixture đang nói dối. Fixture chép từ `dom/01-load.html` (khối thưởng treo) và
cắt sạch bốn thứ mà `probes.json` đo là vắng mặt.

## 1.3.4 — Bí Cảnh Tông Môn có bản THƯỜNG: một đòn mỗi lượt ghé, trên trang riêng (schema 67)

Yêu cầu 18/08/2026, kèm bản ghi `bi-canh-tong-mon-20260818-013136` quay trên một tài khoản
thường thật — thân trả lời của `attack-boss` tự khai `"user_role":"de_tu"`.

**Vì sao phải là một nhiệm vụ riêng chứ không phải một nhánh `if` trong bản VIP.** Bản VIP bấm
`#nv-btm-attack-btn`, một nút quick-click mà hub CHỈ vẽ cho hạng VIP. Sổ probe của bản ghi là
bằng chứng gọn nhất: mọi lượt lấy mẫu đều `no match` cho selector ấy, trên một tài khoản hoàn
toàn đánh được. Hàng của hạng thường chỉ có một link `Đến Đánh ›` mở trang riêng — đúng hình
dạng đã gặp ở Điểm Danh, Phúc Lợi và Vòng Quay.

**Bốn chỗ bản ghi dạy, và cả bốn đều nằm trong script:**

- **Trang đi đường EMBED** (`/bi-canh-tong-mon/?nv_embed=1`). URL trần trả **503** ngay trong
  `network.json` của bản ghi, còn bản `?nv_embed=1` trả 200 — cùng hình dạng đã trả giá ở
  Khoáng Mạch, và cũng là URL mà chính hub mở trong khung nhúng của nó.
- **Vỏ trang KHÔNG có nút nào.** 14KB HTML chỉ chở một khối JSON và `boss-system.js`; mọi nút
  trong script này do JS vẽ ra sau. Nên cổng render là chính nút KHIÊU CHIẾN — ngược hẳn luật
  của các script hub, nơi chờ nút của quest là cái bẫy.
- **Cả ba lời khai của trang nằm trên MỘT nút.** `updateChallengeButton()` viết đúng ba trạng
  thái vào `#challenge-boss-btn`: "KHIÊU CHIẾN" (đánh được), "Còn M:SS" (đang trong cooldown),
  "Hết lượt hôm nay" (hết ngày). Đồng hồ đọc từ chính nút ấy, nên lượt dừng giữa cooldown mang
  theo thời gian thật (412s) thay vì im lặng.
- **Nhịp ghé lại 420s** — đúng `cooldown_interval` mà `/check-attack-cooldown` trả về.

**Nhân chứng sau cú Tấn Công hỏi CHỮ, không hỏi `disabled`.** Một nút KHÔNG được vẽ ra cũng
thoả `disabled` (phép hỏi ấy là ∀), nên một trang đổi hình dạng sẽ đọc ra y hệt một đòn đánh
thành công — đúng cái bẫy đã làm Hoang Vực báo "xong" cho một trận chưa từng đánh suốt một đêm.
Điều kiện là `":|hết lượt"`: đòn ăn thì nút đếm ngược, còn đòn thứ năm của ngày thì nhảy thẳng
sang "Hết lượt hôm nay". Bản ghi đo cú lật ấy ~2,5s sau khi bấm, lúc modal vẫn còn mở.

**Công tắc:** khoá `biCanh` có sẵn từ trước (bản VIP) nên không phải thêm khoá mới; nó chỉ được
đưa vào `FREE_QUEST_KEYS` để ô tick hiện ở thẻ Thường, và `bi-canh-tong-mon-thuong` vào sổ
trần-ngày (5 lượt là trần NGÀY, và trang phân biệt được "hết ngày" với "đang chờ").

Nguồn thật vẫn là `DefaultQuestProfile.cs` bên bản desktop (commit `6cccf47`); khối quest ở đây
được cắt từ bản xuất của chính nó, 25 quest cũ giữ nguyên từng byte.

---

## 1.3.3 — Phòng Chat: mỗi khoảnh tin thu lại, và 24px trống của tin nối tiếp bị dẹp

Yêu cầu 17/08/2026: *"giảm kích thước mỗi container chứa message chat của từng user"*. Lượt
11/08 đã hạ một nấc (khe hàng 24→14px, đệm bong bóng 12/18/11 → 8/16), nên lượt này bắt đầu
bằng phép cộng xem chiều cao thật sự đi đâu — chứ không hạ tiếp cho có:

| | tin ĐẦU của một người | tin NỐI TIẾP |
|---|---|---|
| `margin-top` của `.chat-row` | 14 | 2 |
| hàng danh tính (bài vị 74 − 26 margin âm, + 2 khe) | 50 | — |
| bong bóng (8+8 đệm + 24 dòng + 2 viền) | 42 | 42 |
| **chân dung `flex: none`** | 62 (không phải trần) | **62 — CHÍNH LÀ trần** |
| **tổng** | **106px** | **64px** |

**Chỗ lãng phí lớn nhất không nằm ở đệm, mà ở làn chân dung của tin nối tiếp.** Vòng tròn ấy
đeo lớp `.invisible` (Tailwind: `visibility: hidden`) — ẩn đi nhưng vẫn là một flex item cao
62px, trong khi bong bóng một dòng chỉ cao 42px. Chú thích cũ trong `ChatRoom.tsx` nói rõ ý đồ
chỉ là *"để mọi bong bóng của cùng một người thẳng một hàng lề"* — tức bề NGANG. 24px trống
kia là tác dụng phụ chưa ai đo, và nó gánh trên MỌI tin nối tiếp của MỌI người.

Nay tin nối tiếp vẽ một `<span class="chat-avatar-gap">` rộng đúng `AVATAR_SIZE`, cao **0**.
`height: 0` phải viết tường minh: `align-items` mặc định là `stretch`, một flex item không khai
chiều cao sẽ bị kéo cao bằng cả hàng — đúng cái bẫy vừa gỡ. Bề rộng do TSX đặt, dùng chung hằng
`AVATAR_SIZE` với chính vòng tròn, vì hai làn lệch nhau một pixel là cả cột bong bóng gãy lề.

Các con số còn lại, toàn bộ là chỗ **không có gì để đọc**:

- `.chat-row` khe hàng 14 → 10px
- `.chat-author` khe tên↔bong-bóng 2 → 1px
- `.chat-bubble` đệm `8px 16px` → `6px 14px`, bo góc 14 → 12px, khoảng dòng 1.5 → 1.45
- `.chat-quote` (bong bóng lồng trong bong bóng, nên đệm cộng dồn) `4px 8px`/mb 6 → `3px 8px`/mb 5
- `.chat-meta` `6px 0 0 12px` → `4px 0 0 10px`, theo đệm vừa thít lại

**Ba số KHÔNG đụng tới: chân dung 62px, bài vị `.chat-tagframe` 74px, tên 1.05rem.** Chúng là
một thế cân đã đo bằng bàn thử bốn cỡ ngày 09/08 (ở 66px chữ khắc trên bài vị bắt đầu bết), và
hạ chúng là hạ thứ người ta phải ĐỌC. Cùng lẽ ấy, cỡ chữ tin nhắn giữ nguyên 1rem.

Cộng lại theo đúng bảng trên: **tin đầu 106 → 96px (−9%), tin nối tiếp 64 → 39px (−39%)** —
và đã soát lại bằng ảnh chụp production trước/sau, vì một phép cộng CSS không nói hộ được
「trông có chật không」. Khe hàng hạ được xuống 10px mà không mất phép phân nhịp là nhờ chính điều đó: hai
loại hàng nay chênh nhau gấp hai lần rưỡi, mắt bắt được nhịp mà không cần khoảng trống.

## 1.3.2 — `github:new`: 5xx của GitHub thôi bị đổ cho PAT, và thôi vứt chuỗi vừa gõ tay

Lượt chạy `new-github-khoiloi.bat` chết với:

```
✖ GitHub từ chối lượt hỏi danh tính (HTTP 503). Kiểm lại PAT.
```

**503 không phải lỗi xác thực.** PAT sai thì GitHub trả 401, thiếu quyền thì 403 — đo lại ngay
sau đó: `GET /user` không chìa trả đúng `401 Requires authentication`, và `/`, `/rate_limit`,
trang trạng thái đều 200. Cái 503 là một nhịp hỏng thoáng qua bên GitHub.

Cái giá của câu chữ sai ấy đã trả bằng tiền thật: tông chủ đọc「Kiểm lại PAT」nên tạo một PAT
mới — chìa TOÀN TÀI KHOẢN — cho một sự cố không hề thuộc về chìa.

**Hai chỗ hỏng, cả hai đều trong `whoami` của `newGithubStation.mts`.**

*Một: nó tự chế câu lỗi.* Repo đã có `explainFailure` — bộ từ điển dùng chung cho vòng nuôi kho
và lượt phát hành, và bình chú của chính nó ghi「cùng một mã lỗi phải đọc ra cùng một câu ở cả
hai, bằng không người vận hành phải học hai từ điển cho một API」. `whoami` đứng ngoài từ điển ấy
với đúng hai dòng, và dòng thứ hai gộp MỌI mã không-401 thành「Kiểm lại PAT」. Nay nó gọi
`explainFailure`, nên còn được thêm câu nguyên văn của GitHub («Bad credentials») mà bản cũ vứt.

*Hai: gọi đúng một lần rồi chết.* Đây là công cụ TƯƠNG TÁC — `.bat` hỏi PAT ở dấu nhắc, ký tự
không hiện — nên một cú 503 năm phút bắt gõ lại từ đầu cả chuỗi. Nay thử lại **3 lần, nghỉ 2
giây**, và chỉ cho hai ngả đáng thử: mạng ném, và 5xx. 4xx thì không thử lại — một PAT sai không
tự đúng lên. Trần xấu nhất 64 giây.

`explainFailure` cũng mọc thêm nhánh 5xx nói THẲNG「lỗi phía HỌ, KHÔNG phải PAT của bạn — chờ
một lát rồi chạy lại」, và nhánh ấy chảy sang cả sáu chỗ gọi.

Hàm này có sáu chỗ gọi mà tới hôm nay vẫn chưa có phép thử nào; nhóm ca thứ 12 của
`verify:github-stations` đóng đinh luật: **4xx mới được nhắc tới PAT, 5xx thì không** — kèm ca
ngược chiều bắt 401/403/404/409/422 không được mang câu trấn an của 5xx.

Đo đầu-cuối bằng một chìa giả: `✖ PAT bị từ chối (401) khi hỏi danh tính: token hết hạn hoặc đã
bị thu hồi — Bad credentials`. Vòng thử-lại thì mới chỉ được soát bằng mắt, chưa có ca chạy —
`whoami` không xuất khẩu và tệp chạy `main()` ngay lúc nạp.

## 1.3.1 — Workflow「Vercel usage」: phiên chết nay kêu sau 6 giây thay vì 18 phút

Tông chủ báo workflow đang đỏ. Lượt 145 và 146 (17/08/2026) hỏng; lượt 144 và trước đó xanh.
Hai lượt đỏ **kéo dài 1007s và 1088s**, trong khi một lượt khoẻ chỉ tốn ~100s — gấp mười lần, và
sát trần `timeout-minutes: 20` của job. Không trạm nào đẩy được số liệu: cả năm dòng trong sổ
gương đứng im ở `12:56Z`, đúng lượt 144.

**Cái hỏng nằm ở phép gác, không ở hai commit đứng cạnh nó.** Script cào chỉ có một lưới chống
phiên chết:

```ts
if (res && res.status() >= 400) { … "cookie hết hiệu lực" … }
```

Lưới ấy **không bao giờ chạy được**. Đo trực tiếp 17/08: `GET https://vercel.com/<slug>/~/usage`
không cookie trả **307 → `/auth-redirect/<slug>/~/usage`**, rồi tiếp tới `/login`. Playwright đi
theo chuyển hướng và dừng ở một trang đăng nhập **HTTP 200 hoàn toàn hợp lệ**. Nên thay vì kêu,
lượt chạy đem trang đăng nhập ra cào: thiếu cả tám cột → tải lại → chờ thêm 90 giây → thiếu tiếp
→ chết sau 180 giây mỗi trạm. Đầu tệp workflow hứa「COOKIE HẾT HẠN thì workflow ĐỎ chứ không im
lặng」; lời hứa ấy đúng về mã thoát và sai về mọi thứ còn lại.

Tệ nhất là câu chẩn đoán cuối: nó đoán giữa ba nguyên nhân không liên quan — chưa render xong,
cookie mở được một phần, hay Vercel đổi chữ — nên đọc log xong vẫn không biết phải sửa gì. Đó
chính là lý do lượt hỏng này phải lần ra bằng cách đo thời lượng chạy chứ không đọc được thẳng.

**Thuốc: `reviewUsageLanding` (thuần, trong `usageStations.mts`)** — so ĐƯỜNG DẪN nơi trình duyệt
thật sự dừng lại với `/<team>/~/usage`, rồi chia hai ngả hỏng thay vì gộp:

| ngả | nghĩa | việc phải làm |
|---|---|---|
| `signedOut` | rơi vào `auth-redirect` · `login` · `signin` · `sso` | xuất lại cookie, cập nhật secret |
| `elsewhere` | dừng ở chỗ khác hẳn | Vercel dời trang — sửa đường dẫn, ĐỪNG đụng cookie |

Gộp hai ngả lại là đẩy người ta đi làm mới cookie cả buổi cho một cái hỏng không nằm ở đó, nên
chúng tách. Dòng lỗi kể nguyên văn URL đích, kèm hạn cookie còn lại (`daysUntilExpiry` vốn có
sẵn và đã được kiểm kỹ — chỉ là script cào chưa từng hỏi tới nó).

Còn một lỗ hẹp: phép gác chạy ngay sau `domcontentloaded`, nên một cú đá về cửa đăng nhập bằng
JS xảy ra SAU đó vẫn lọt. Bịt bằng cách cho chính lời chẩn đoán「thiếu cột」khai luôn trang đang
đứng — đường duy nhất còn lại để nhận ra ngả ấy.

**Đo trên Vercel thật, cookie giả, đội `jarvis8796`: dừng sau 6 giây**, mã thoát 1, và dòng lỗi
gọi đúng tên cả nguyên nhân lẫn secret phải làm mới. Năm trạm ≈ 30 giây thay cho 1088 giây.

Mười hai phép thử mới trong `verify:usage-push` (61 phép, tất cả thuận): trang đúng · query/hash
· gạch chéo đuôi · slug viết hoa · ba cửa đăng nhập · trang bị dời · đội khác · `about:blank` ·
chuỗi rỗng.

**Bản vá này KHÔNG làm workflow xanh lại** — nó làm cho lượt đỏ kế tiếp nói ra nguyên nhân trong
sáu giây. Nếu đó là cookie hết hạn thì việc làm mới là của tông chủ (`npm run usage:cookie`).

## 1.3.0 — Phần Thưởng Hoạt Động: hai rương mốc 75%/100% trên hub (schema hồ sơ 66)

Nhiệm vụ mới, hai twin VIP/thường, dựng từ bản ghi `phan-thuong-hoat-dong-20260817-022120`
(6 click, 2 lượt AJAX, video 91 giây) — tông chủ dặn kèm trong bản ghi:「mỗi ngày luôn check 2
rương phần thưởng này nhé, sẽ xuất hiện bất ngờ」.

**Trang khai ba trạng thái bằng CLASS, nên script hỏi đúng ba class ấy** — `.nv-rcard.locked`
(chưa tới mốc) · `.unlocked` (còn `button.nv-claim-btn`) · `.claimed` (nút bị GỠ, thay bằng
`.nv-claimed-txt`「Đã nhận」). Không dò chữ, không đếm vị trí. Nút mờ (`:disabled` — CSS của
trang có hẳn luật cho nó) bị loại khỏi phép chọn: bấm vào là ngồi chờ một hộp không bao giờ mở.

**Hộp thưởng là hộp DÙNG CHUNG, phân biệt bằng class chứ không bằng tiêu đề.** Video cho thấy
hai rương ra hai tiêu đề khác nhau —「Nhận Thưởng Thành Công!」(mốc 75%) và「Hoàn Thành Xuất
Sắc!」(mốc 100%) — nên một phép kiểm đi so tiêu đề sẽ khai rương thứ hai là hỏng. Thứ phân biệt
mừng/dữ là `.nv-err`/`.nv-warn` trên `#nv-modal-overlay`, và rương bị từ chối được đánh dấu để
vòng lặp KHÔNG bấm lại vào cánh cửa vừa đóng sập.

**Ba nhịp ghé lại, ba ý khác nhau, và chỉ MỘT ngả vào sổ ngày.** Cả hai thẻ `.claimed` →
`alreadyDone` (mai ghé lại). Còn rương khoá → 30 phút. Không thấy mục này trên trang → 60 phút.
Hai ngả sau cố ý KHÔNG phải `alreadyDone`: mốc mở ra theo tiến độ các nhiệm vụ khác trong ngày,
và một mục vắng mặt có thể chỉ là trang dựng thiếu — nhớ nhầm thành「hết ngày」là khoá mất đúng
cái rương sắp mở. Cùng bài học đã trả giá ở Vòng Quay bản thường.

**Order 99, không phải 120.** Bộ chạy thử bắt được: đặt 120 là chen sau Mê Cung, phá luật「Mê
Cung chạy cuối」(nó giữ trình duyệt tới 35 phút với một phòng 5 người). Mà vòng tiến độ chỉ đếm
BỐN nhiệm vụ ngày (Điểm Danh · Hoang Vực · Phúc Lợi Đường · Vấn Đáp — mọi thứ trong「Hoạt Động
Khác」không cộng vào %), nên 99 là chỗ sớm nhất mà cả hai rương đã có thể mở.

**Twin thường dùng NGUYÊN script của bản VIP**: mục rương nằm ở thân trang hub, không phải một
nút quick-click, nên không selector nào phụ thuộc hạng. Bản ghi là tài khoản VIP, nên khả năng
「hub bản thường không có mục này」được xử bằng một lượt hẹn giờ có lời giải thích chứ không
phải một quest đỏ.

Fixture của bộ chạy thử chép từ `dom/01-load.html` (thẻ mở), `dom/06-click.html` (thẻ đã nhận)
và `dom/03-click.html` (hộp thưởng); chữ trong `.nv-locked-txt` là chỗ DUY NHẤT không có trong
bản ghi — hôm ấy cả hai rương đều đã mở — và script không đọc chữ ấy.

## 1.2.1 — Khoáng Mạch nghe lời xác nhận đoạt mỏ ở NGẢ MẠNG (schema hồ sơ 65)

Tông chủ báo 17/08/2026 kèm ảnh nhật ký: trong game đã đoạt được mỏ, mà auto khai
「Đoạt mỏ KHÔNG thành (trang không nói câu xác nhận nào) — lượt này KHÔNG mua phù」. Dòng ngay
sau đó tự tố cáo lời khai ấy: bonus tu vi của mỏ nhảy `100%` → `55%` lúc `00:35:21`, rồi
`00:35:34` dòng mình đổi sang「đang khai thác — chưa đạt tối đa」, tức chu kỳ đào vừa reset. Cú
đoạt THÀNH, chỉ có phép kiểm là mù.

**Chỗ hỏng: bằng chứng bị đi tìm sai chỗ.** Bản ghi 14/08 đọc câu「Đã đoạt thành công quyền chủ
mỏ.」trong `network.json` — tức trong THÂN TRẢ LỜI AJAX — rồi `KmHostWonScript` lại đi tìm nó
trong DOM bằng `fold(body.textContent)`. Hai chỗ ấy không phải một, và trang không có nghĩa vụ
nào phải vẽ câu ấy ra. Không đổ được cho「toast sống ngắn」như ghi chú cũ đoán: cái chờ 8 giây ở
trên nó đã chạy bằng MutationObserver trong trang (`conditionWaitSource`), nên một toast dù chỉ
sống 200ms cũng bị bắt. Tám giây trắng nghĩa là chữ ấy chưa bao giờ vào DOM.

**Bản vá: một bước gài tai nghe TRƯỚC cú bấm Xác nhận** (`KmWinWatchScript`). Nó bọc `fetch` và
`XMLHttpRequest`, cộng một `MutationObserver` đọc `textContent` của node MỚI CHÈN, rồi cắm cờ
`jvz-km-won` khi nghe thấy câu xác nhận ở BẤT KỲ ngả nào. Ba chi tiết không cắt được:

- **Mở lớp escape trước khi so.** PHP `json_encode` mặc định bẻ mọi ký tự ngoài ASCII, nên câu
  tiếng Việt về tới nơi có thể không còn một chữ tiếng Việt nào.
- **Bước chờ đổi `When` sang `body.jvz-km-host-go`.** Nó vốn hỏi `.jvz-km-doat` — chính cái nút
  vừa bấm — mà cú AJAX vẽ lại sổ và cuốn nút ấy đi, nên cái chờ sẽ bị bỏ qua ĐÚNG ở ca thành công.
- **Câu「không thành」nay kéo theo 120 ký tự đầu của thứ trang vừa trả lời.** Không có bản ghi cho
  ngày ấy, nên đây là cách rẻ nhất để lượt hỏng kế tiếp tự khai thay vì bắt người đi mò.

**Và phép đọc DOM cũ bị GỠ HẲN, không giữ lại cho chắc.** `body.textContent` gộp cả mã nguồn của
mọi thẻ `<script>` trong trang (đó là chỗ nó khác `innerText`), nên chỉ cần JS của site mang một
literal là cửa tiêu tiền mở suốt ngày. Không phải giả thiết: chính fixture của bộ chạy thử đã
xanh nhầm y như vậy — nó gọi `toast('Đã đoạt thành công…')` ngay trong script của trang, nên ca
「đoạt thành」đậu kể cả khi không toast nào được vẽ. Fixture nay giữ câu ấy trong một `data-*`
(textContent không đọc tới), trả lời AJAX theo ba đường `net` / `dom` / `khac`, và ca「trang trả
lời câu lạ」là ca đã bắt được lỗi này.

## 1.2.0 — Mê Cung thôi nghỉ một giờ giữa hai đợt đánh (schema hồ sơ 64)

Tông chủ báo 16/08/2026: đánh xong một đợt là đàn dừng, đợi một giờ, không ghé lại tìm phòng.
Nhật ký của đàn `9f646e8a` cho đủ hình dạng — sáu lượt「Xong lượt đánh」lúc `14:31:39 · 14:34:02
· 14:40:47 · 14:42:58 · 14:56:22 · 15:07:38` (UTC), rồi `15:07:57` quest kết thúc và vòng chạy
khai「Tự chạy vòng 4 sau khoảng 1 giờ」.

**Hai chỗ hỏng, độc lập nhau.**

*Một: trần vòng ngoài là 6, mà 6 là hình dạng sai.* Một lượt 5 ải dài từ ~2 tới ~11 phút, nên
với một đội nhanh thì trần 6 vòng luôn nổ TRƯỚC trần 35 phút — engine kiểm `maxIterations` rồi
mới kiểm deadline, cái nào chặt hơn thắng trong im lặng. Cái giá là giải tán một phòng 5 người
còn sống khi ngân sách thời gian còn quá nửa, mà dựng lại phòng ấy mới là phần đắt: phút chờ
người lạ. Nay trần là 18 — đúng số lượt mà 35 phút chứa nổi ở nhịp nhanh nhất từng đo — nên nó
lui về đúng vai một lưới chặn vòng lặp điên, còn hạn mức thật là thời gian.

*Hai: hết vòng thì rơi về trần một giờ.* Mê cung KHÔNG có đồng hồ của máy chủ, nên `completed`
không mang theo `cooldownSeconds` nào và engine lấy `FallbackCooldownSeconds = 3600`. Nhưng
「hết vòng」ở đây nghĩa là *còn việc ngay bây giờ* — chỉ là script thôi giữ trình duyệt. Nay bước
CUỐI của script là `readCooldownSeconds` với `script: () => 60`: tự khai một phút.

**Vì sao một giờ vẫn còn nguyên cho ngày đã xong, mà không cần thêm điều kiện nào.** Ngả「đã đủ
huyền tinh hôm nay」dừng ở `StopIf` gần đầu script, và `executeSteps` cắt hẳn phần đuôi khi
`state.stopReason` được cắm (`if (state.stopReason) break;`). Bước đọc đồng hồ nằm ở cuối nên
ngả ấy không bao giờ chạm tới nó: kết cục vẫn là `alreadyDone` + trần một giờ, không đổi một
dòng nào. Đây là giả định chịu lực của cả bản vá, nên nó có phép thử riêng trong `npm run smoke`
— kèm ca script vỡ (evaluate nuốt lỗi, trả `undefined`, cooldown ở nguyên `null` → rơi về đúng
hành vi cũ, không bao giờ là một lượt hỏng).

**60 giây, không phải sàn 30 giây.** Thứ chờ sau một lượt khởi động lại là dựng phòng 5 người,
tính bằng phút — bớt xuống dưới một phút không mua được gì, mà mỗi vòng thức là cả kế hoạch
thức: bộ lập lịch lấy đồng hồ SỚM NHẤT trong mọi nhiệm vụ của vòng.

Hồ sơ quest sửa ở nguồn thật (`DefaultQuestProfile.cs`) rồi vá tay sang `profile.json`, cả hai
bản sinh đôi `me-cung`/`me-cung-thuong`, kèm bump schema 63 → 64 ở cả ba chốt.

## 1.0.0 — Backend rời Vercel về VM OCI; Vercel chỉ còn là cửa trước

Tông chủ quyết 16/08/2026. Kiến trúc mới, một câu: **app Next.js + PostgreSQL 17 + MongoDB
8.0 chạy trọn trên `jarvis-oci-01` (https://92.5.130.32.sslip.io, Caddy + TLS Let's Encrypt);
5 trạm Vercel thành VỎ PROXY** — một tấm rewrite chuyển nguyên request về VM và trả nguyên
câu trả lời, người dùng giữ đúng URL cũ, cookie phiên vẫn same-origin. Khôi lỗi GitHub gọi
THẲNG VM, không qua proxy.

Vì sao vỏ proxy chứ không tách hai codebase: các trang dashboard/admin đọc database ngay
trong lúc render (server components + server actions) — tách UI khỏi data là viết lại ~10
tệp action cùng mọi trang đọc-DB thành REST, nhiều tuần và fork codebase vĩnh viễn. Vỏ proxy
đạt cùng mục tiêu vận hành (backend + data trên máy của mình) với diff nhỏ hơn hàng chục lần,
và còn giữ được cookie same-origin — gọi thẳng VM từ trình duyệt là rơi vào third-party
cookie, Safari chặn.

- **Driver: neon-http → pg.** neon-http nói giao thức fetch riêng của Neon, Postgres thường
  không trả lời được; pg nói giao thức chuẩn nên phủ cả localhost lẫn Neon. Từ nay có
  transaction thật. LISTEN của realtime sang pg.Client (vốn là cha đẻ của bản Neon fork);
  NOTIFY đi qua pool của db().
- **Dữ liệu**: pg_dump từ Neon của trạm phục vụ cuối (auto-hh3d-4) → Postgres 17 local
  (users=33, workers=8, jobs=357); mongodump Atlas → mongod local, db `jarvis`
  (chat_messages=0 — Atlas nguồn cũng 0, sweep đã dọn từ trước; cấu trúc + index về đủ).
  DNS SRV hỏng dưới máy nhà thành vô nghĩa: Mongo nay là localhost của VM.
- **Phát hành**: `deploy:all` nay = `deploy:backend` (git archive HEAD → build trên VM →
  lật symlink release, nghỉ ~2s); `deploy:proxy` lật vỏ trạm qua API v13 files-inline —
  không CLI, không git metadata, hết bệnh BLOCKED git-author. Lệ cũ của các phiên
  («sau patch chạy deploy:all») giữ nguyên nghĩa: phát hành bản vá.
- **Cron**: Vercel Cron (03:00 UTC gọi /api/cron) thay bằng systemd timer cùng giờ trên VM,
  CRON_SECRET đọc từ .env của app — đã chạy thử một lượt thật, exit 0.
- **Ops đụng DB dời hẳn lên VM**: Postgres/Mongo chỉ nghe 127.0.0.1 (cố ý — không mở cổng
  DB ra internet), nên roster:purge / github:deploy / db:migrate / verify:* chạy qua
  `npm run vm -- <lệnh>`. Chạy chúng ở máy nhà từ nay là đọc database CŨ đã đông cứng.
- **.bat**: 11 tệp cũ vào `backup/` — toàn bộ họ mirror/station (kiến trúc gương trạm nghỉ
  việc cùng Neon) và các tệp DB-side nay phải chạy trên VM. Thay bằng `deploy-backend.bat`.
- Ba cái giá đã trả trong chính lượt dựng: `ln -sfn` vào thư mục có thật tạo symlink BÊN
  TRONG nó (app khởi động trong thư mục rỗng); `npx next build` nhảy qua hook prebuild nên
  gói khôi lỗi 404 (public/ chỉ được quét lúc khởi động); API list env chỉ trả blob mã hoá
  — CLI `vercel env pull` là đường giải mã duy nhất còn tin được.

Hệ gương trạm (mirror/*, sổ gương, bảng điều phối, sync) là ĐỒ THỪA KẾ từ hôm nay: mã còn
trong cây, UI admin còn hiện, nhưng không còn gì để điều phối. Gỡ dần ở các bản sau.

## 0.95.0 — Hỷ Sự Đường: một phòng hỏng thôi giết những phòng chưa ai ghé

Tông chủ báo「quest chúc còn sót các phòng cưới」kèm bản ghi `hy-su-duong-20260815-205221`, và
ghi chú tự tay viết trong lúc quay: *"cần check kỹ toàn bộ danh sách tiệc cưới nhé, phòng nào có
Trạng thái: Chưa chúc thì vào chúc ngay bất kể có Trạng thái lì xì: Đã phát lì xì hay chưa"*.

**Lì xì chưa bao giờ là bộ lọc** — đọc lại `show_all_wedding` trong `network.json` thì 8 phòng
đều `has_blessed: false`, và bộ lọc chỉ hỏi `.wedding-now-blessing-status`. Nên chỗ sót nằm ở
nơi khác, và nó nằm ngay trong bộ chạy thử của chính repo này, chép nguyên văn một sự cố
07/08:「Hỷ Sự Đường: repeat vòng 3: Trang chưa dựng xong sau 25s」.

Đó mới là cơ chế: `executeSteps` trả lỗi ở bước bắt buộc đầu tiên, `repeat` bọc lại thành
`repeat vòng N: …` rồi **kết liễu cả nhiệm vụ**. Thân vòng có ba bước bắt buộc nằm trong phòng
(chờ form 25s, chờ hộp xác nhận 8s, chờ nút gửi biến mất 15s), nên **bất kỳ phòng nào lạ cũng
cắt cụt phần đuôi danh sách** — hai phòng đầu chúc xong, phòng thứ ba vấp, phần còn lại không ai
ghé. Người dùng thấy đúng một thứ: "còn sót phòng".

Cái vá là **cách ly lỗi theo từng phòng**, không đụng gì tới `engine.mjs`:

- Mọi bước TRONG phòng thành `optional` (vẫn chờ đủ số giây cũ, chỉ thôi kết liễu script).
- Thêm một bước **phán xử** bắt buộc — nó chỉ đọc DOM rồi ghi sổ nên không bao giờ hỏng vì
  trang: nút gửi mất = `ok`, còn nguyên = `fail` kèm lý do, phòng vốn đã chúc = `skip`.
- Sổ kết cục `__jvz_hy_su_log` đi cùng `__jvz_hy_su_seen`, và bước đếm cuối mỗi vòng kể ra
  「chúc được N, TRƯỢT M」**gọi đích danh từng phòng trượt**.

Lời hứa cũ「gửi trượt phải kêu to, không nhận vơ là xong」được giữ, chỉ đổi chỗ đứng: trước đây
nó to bằng cách giết luôn các phòng chưa ghé. Nay nó to bằng tên phòng trong lời kể, cộng cờ
`jvz-hy-su-all-failed` — ghé phòng nào cũng trượt thì vẫn là một lượt **hỏng thật**, vì đó là
"trang đã đổi", không phải "hôm nay không có gì để chúc".

Ba thứ đi kèm, mỗi thứ tự nó là một đường sót phòng:

- **Trần vòng lặp 15 → 40.** Chạm trần thì `repeat` kết thúc ÊM (không phải lỗi), quest báo xong,
  phòng thứ 16 trở đi biến mất không dấu vết. Trần cũ đặt theo con số 6 tiệc của tháng trước;
  bản ghi 15/08 đếm 8. Trần thật của lượt chạy vẫn là `maxSeconds`.
- **Duyệt đúng thứ tự danh sách.** Bản cũ đẩy mọi phòng Hồng Nhan (`/hong-nhan`) xuống cuối vì
  chỉ phòng Đạo Lữ có bản ghi hình. Tông chủ chốt 15/08: vào cả, không phân biệt thứ tự — nay
  làm được, vì một trang lạ chỉ mất chính phòng ấy.
- **Lời kể tự chứng minh chuyện lì xì.** Mỗi lần mở modal kể thêm số phòng `.li-xi-sent`, và
  dòng「Vào phòng」đánh dấu phòng nào đã phát lì xì — để lần sau không ai phải quay một bản ghi
  mới chỉ để hỏi lại câu ấy.

Fixture của bộ chạy thử được chép lại từ `dom/02-click.html` của bản ghi: thêm
`<p class="wedding-now-li-xi-status">` (bản dựng tay trước đây thiếu hẳn, nên không phép thử nào
chạm được tới câu hỏi của tông chủ) và badge loại phòng. Ba ca mới: phòng lạ nằm GIỮA danh sách
→ phòng đứng sau nó vẫn được chúc; phòng「Đã phát lì xì」vẫn được vào; ghé đâu cũng trượt → nhiệm
vụ hỏng thật.

`schemaVersion` 60 → 61 ở cả ba chỗ (C#, `profile.json`, chốt trong `smokeQuestEngine.mjs`) —
desktop chỉ thay hồ sơ đã lưu khi schema tăng.

**Bản desktop sửa cùng lượt**: `DefaultQuestProfile.cs` là nguồn, `profile.json` ghép từ bản xuất
của chính nó. Đo được lúc ghép: khối `hy-su-duong-thuong` trong `profile.json` trùng bản xuất từ
HEAD ở MỌI trường chạy được, chỉ lệch chữ `note` — tức web đã trôi khỏi nguồn ở phần chú thích
từ trước; lượt này ghép cả note nên hai bên khớp lại.

---

## 0.94.0 — Vòng Quay Phúc Vận lấy được vòng quay thứ tư

Tông chủ báo: mỗi ngày chỉ quay 3 vòng trong khi trần là 4. Script quest KHÔNG sai — cả hai bản
(VIP trên hub, thường trên `/vong-quay-phuc-van`) đều đã bấm tới 4 lượt trong một lượt ghé, và
`profile.json` không phải sửa một dòng nào. Chỗ sai là **sổ đủ lượt hôm nay** của runner web.

Site khoá lượt thứ 4 cho tới khi xong hết nhiệm vụ ngày. Trước lúc ấy vòng quay báo「hết lượt
quay hôm nay」bằng một `stopIf` — và `engine.mjs` gắn `dailyCapReached` cho MỌI `stopIf`, nên
`runCycle` ghi `vong-quay-phuc-van` vào sổ và cả ngày không mở lại trang ấy nữa. Đúng cái lượt
ghé có thể lấy vòng thứ 4 — lượt sau khi mọi nhiệm vụ khác đã xong — là lượt bị sổ cấm.

Đo trên trạm đang phục vụ ngày 15/08/2026, trọn chuỗi trên năm đàn: `20:41 hết lượt quay hôm
nay` → `20:44 Đã đủ lượt hôm nay … Vòng Quay Phúc Vận` → `20:51–20:54 Bỏ qua … Vòng Quay Phúc
Vận`. Mất im lặng: mọi dòng nhật ký đều xanh, vì theo chỗ đứng của runner thì nó đã làm đúng.

Thuốc là một cổng THỨ BA trong `dailyQuota.mjs`, hẹp đúng bằng chỗ hỏng: `PEER_GATED_QUEST_IDS`
— những nhiệm vụ mà「hết lượt」chỉ trả lời cho HIỆN TẠI chứ không cho cả ngày. Lời khai của
chúng chỉ vào sổ khi `peersDoneForQuota` xác nhận mọi nhiệm vụ ngày KHÁC trong kế hoạch đã vào
sổ; lúc ấy điều kiện mở lượt cuối đã thoả, nên「vẫn hết lượt」mới thật là hết. Cờ mặc định là
`false` — phía an toàn: quên truyền thì cùng lắm mở thừa một trang, ngả nhầm chiều kia là mất
hẳn một vòng quay mỗi ngày.

Giá phải trả, đã cân: một hai lượt ghé thừa vào cuối ngày, và `nothingLeftToday` (nhánh không
mở trình duyệt) tới muộn hơn chừng ấy. Nếu một nhiệm vụ ngày hỏng cả ngày thì vòng quay ở trạng
thái chờ cả ngày — đúng như vậy, vì lượt cuối kia có thể mở ra ngay khi nhiệm vụ ấy chạy được.

**Bản desktop không cần sửa gì**: `AccountRunner` không có sổ, nó ghi log rồi quay lại ở vòng
sau — đúng như XML doc của `LotteryWheel` đã dự tính («a later visit's business»). Cái bẫy sinh
ra từ chỗ bản web thêm sổ mà không hỏi lại giả định ấy.

## 0.93.0 — gỡ khối dặn dò dưới ô soạn bản tin

Tông chủ yêu cầu gỡ bốn gạch đầu dòng nằm dưới ô soạn bản tin (tab Bản Tin, trang Tông Môn).

Ba điều chúng từng nói vẫn ĐÚNG y nguyên — hành vi không đổi một dòng nào — nên chúng dời vào
bình chú đầu `ChangelogPanel.tsx`, chỗ người sửa mã đọc: ô rỗng = trả về danh sách gốc; gỡ một
mục là gỡ hẳn, gõ lại số bản là lấy lại; mục của bản phát hành sau vẫn tự hiện. Xoá thẳng mà
không chép lại chỗ nào là để người sau phải suy ra ba luật ấy từ hai hàm `mergeReleaseNotes` và
`hiddenVersionsFor`.

Dòng cảnh báo「Chưa có mục nào cho v0.93.0」thì GIỮ: nó không phải lời dặn chung chung mà là một
phép đo trên đúng bài đang gõ, và nó chỉ hiện khi có chuyện.

## 0.92.0 — nhãn khôi lỗi trở lại đúng nghĩa: chỉ nói khi CÓ máy đang cầm

Bản 0.91.0 hiểu sai ý tông chủ. Câu「hiển thị loại khôi lỗi đang đảm nhận」được đọc thành「nói cho
mọi dòng, kể cả dòng chưa ai nhận」, nên dòng đang nghỉ mang một nhãn DỰ ĐOÁN suy từ「Giao đàn
cho」: `chờ tông môn`, `chờ máy nào rảnh`. Tông chủ bác ngay trong ngày — chỗ ấy cần **tên khôi
lỗi**, mà một dòng chưa ai nhận thì chưa có tên nào để mà nói.

Nay luật gọn lại còn một câu: **có máy đang cầm thì nói tên, không thì im.**

| dòng | nhãn |
|---|---|
| đang chạy, tông môn | `khôi lỗi tông môn` (+ tên máy khi người xem được biết) |
| đang chạy, máy nhà | `khôi lỗi máy nhà` (+ tên máy) |
| đang nghỉ · đang xếp hàng · đã tắt | *(không nhãn)* |

Tên hạng đứng TRƯỚC tên máy chứ không bị nó thay: một chuỗi id trần trụi không nói được đó là máy
của tông môn hay máy nhà ai đó, mà đấy mới là điều cái nhãn này sinh ra để trả lời.

Cột trạng thái vốn đã kể phần chờ đợi —「Đang nghỉ — tới lượt lúc …」,「Chờ máy nhà · thứ 2」— nên
nhãn dự đoán ở đuôi dòng vừa thừa vừa mang hình dạng một lời hứa. Đây cũng đúng bài học 0.83.0:
dòng đang nghỉ KHÔNG được đeo tên máy vì cái tên ấy chỉ là phỏng đoán. Nay nó không đeo gì cả.

Gỡ luôn `ownerPref` khỏi `QueueEntry` và `normalizeOwnerPref` khỏi lớp thuần — cả hai sinh ra chỉ
để nuôi nhãn dự đoán, giữ lại là nuôi mã chết.

`verify:queue-pools` còn **31 khẳng định** (0.91.0 phình lên 40 vì mấy ca dự đoán). Hai ca đột
biến đã thử, cả hai đỏ đúng chỗ: cho dòng chưa ai cầm cũng ra nhãn; và để id trần trụi thay tên hạng.

## 0.91.0 — mỗi dòng Hàng Đợi nói ra AI ĐANG ĐẢM NHẬN nó

Tông chủ nêu: bảng Hàng Đợi cần hiện loại khôi lỗi đảm nhận từng dòng. Đo trước khi sửa — chụp
bảng trên trạm đang phục vụ — thì thấy đúng chỗ hụt: `0 đang chạy · 0 chờ tới lượt · 10 đang
nghỉ`, và **mười dòng ấy không mang nhãn nào cả**. Nhãn cũ chỉ hiện khi đã có máy CẦM đàn, mà
「đang nghỉ」lại là trạng thái thường gặp nhất của bảng.

**Hai sự thật khác hẳn nhau, và đó là toàn bộ cái khó.** Dòng đang chạy có một cái máy thật đang
cầm nó — đó là SỰ KIỆN. Dòng đang nghỉ thì chưa ai cầm; thứ duy nhất biết được là HẠNG máy nào đủ
tư cách nhận, suy từ lựa chọn「Giao đàn cho」của chủ đàn — đó là DỰ ĐỊNH. Trộn hai thứ ấy vào một
câu chữ chính là cái sai bản 0.83.0 đã phải đi vá (dòng đang nghỉ đeo tên máy sẽ chạy nó, người
đọc tưởng đàn đã được đặt chỗ trước).

Nên chúng mang hai hình dạng khác nhau, và cờ `planned` là thứ giao diện dùng để vẽ khác nhau:

| dòng | nhãn | dáng |
|---|---|---|
| đang chạy, tông môn | `tông môn · <tên máy>` (hoặc `tông môn` khi người xem không được biết tên) | đậm |
| đang chạy, máy nhà | `<tên máy>` hoặc `máy nhà` | đậm |
| chưa ai cầm | `chờ tông môn` · `chờ máy nhà` · `chờ máy nào rảnh` | nhạt hơn, luôn mở đầu bằng「chờ」|
| đã tắt | *(không nhãn)* | — |

Dòng ĐÃ TẮT không mang nhãn nào: nó chỉ nán lại 30 phút để có chỗ bấm Bắt Đầu, nên một câu
「chờ …」ở đó là hứa một lượt chạy sẽ không bao giờ tới.

Luật nằm ở `validation/queueAssign.ts` — **thuần và không import gì**, vì `QueueBoard` là
`"use client"`: đặt nó trong `services/queue.ts` là kéo cả client database vào bundle trình duyệt
(bài học đã chép ở `validation/retention.ts` và `worker/version.ts`). `QueueEntry` vì thế mang
thêm `ownerPref`, đi CÙNG `workerKind` chứ không thay nó — một bên là ai đang cầm, một bên là ai
được phép cầm.

Giá trị `workerPref` lạ đọc như `any` (fail-open), cùng lối `queuePoolOf` và `mayServe`: sửa tay
database ra một chuỗi không ai biết thì đàn vẫn được kể là ở hàng chung, thay vì mang một nhãn hẹp
hơn sự thật.

`verify:queue-pools` lên **40 khẳng định** (+14). Hai ca đột biến đã thử, cả hai đỏ đúng chỗ: bỏ
nhánh「dòng đã tắt」; và bỏ fail-open cho giá trị lạ.

Kèm một câu chữ tông chủ yêu cầu gỡ khỏi thẻ Khôi Lỗi:「và với hầu hết mọi người thì đó đúng là
cách nhàn nhất」.

## 0.90.0 — khôi lỗi trọ thôi khai「1.0.0」, và lưới chặn lockfile lệch bản

Tông chủ phát hiện: mọi khôi lỗi trọ trên bảng Khôi Lỗi đều đứng im ở `1.0.0`. Không phải chúng
cũ — mà `renderPackageJson` ghi CỨNG chuỗi ấy vào `package.json` của kho sinh ra, còn
`readOwnVersion` của worker thì đọc đúng tệp đó rồi khai lên sổ điểm danh.

Hệ quả không chỉ là một con số xấu: **cột「lệch bản」của dashboard mù hẳn với nhóm máy này.** Bảy
kho dựng ở bảy thời điểm, mang bảy đời mã khác nhau, đều hiện một con số — nên câu hỏi「máy nào
đang chạy mã nào」không có chỗ nào trả lời được. Chính vì thế lượt truy vụ Luyện Đan hôm 14/08 đã
phải đi vòng qua GitHub API đọc `profile.json` của từng kho.

Nay `package.json` của gói mang **số bản của kho gốc lúc phát hành**, nên mỗi lượt `github:deploy`
tự cập nhật con số ấy. Không có thói quen nào phải nhớ: nó là một dòng trong bộ dựng gói.

**Cái bẫy đi kèm, và lưới chặn nó.** `npm ci` ĐỐI CHIẾU `package.json` với `package-lock.json` rồi
từ chối chạy khi hai bên lệch — và nó từ chối trên runner, tức mọi khôi lỗi chết cùng một lúc ở
một chỗ không ai đang nhìn. Từ khi số bản thôi là hằng số, cửa lệch ấy mở ra thật: lượt phát hành
sinh lockfile TRƯỚC rồi mới dựng gói, nên chỉ cần hai chỗ đọc số bản khác nhau một nhịp là hỏng.

Vá bằng hai việc, không phải một: (1) cả hai chỗ nay gọi CÙNG một hàm `renderPackageJsonFor`, nên
không còn hai bộ tham số để mà trôi; (2) `buildKhoiloiPayload` đối chiếu số bản trong lockfile với
số bản vừa đóng dấu, lệch thì NÉM kèm cả hai con số và nói thẳng hậu quả. Lockfile không khai số
bản (bản cũ, tệp lạ) thì im lặng cho qua — đây là lưới bắt lệch, không phải phép soát định dạng.

`verify:github-deploy` lên **56 phép kiểm** (+8). Hai ca đột biến đã thử, cả hai đỏ đúng chỗ: quay
lại hằng số `1.0.0`; và gỡ lưới lockfile lệch bản.

## 0.89.0 — Khoáng Mạch (schema 60): chín rồi mới hành động, phù 1 lá/ngày, và lời chia tay con số「2 lần」

Bản ghi thứ hai (`khoang-mach-20260815-153847`, 15/08) ngắn mà nặng ký, ba điều nó dạy:

**Trần ngày là thứ duy nhất đáng tin.** Hôm 14/08 trần là 300 Tu Vi + 100 Tinh Thạch — vừa vặn
hai lần nhận, và con số「tối đa 2 lần/ngày」lọt vào doc từ đó. Hôm 15/08 trần là **600/200** —
ba lần nhận. Ghi chú người ghi hình:「giới hạn này thay đổi mỗi ngày」. Engine vốn đã dừng theo
trần (không theo đếm lần), nên phần sửa là gỡ con số 2 khỏi mọi doc/hint, và trỏ phép đọc trần
vào selector đích danh mới lộ ra (`.stats-container` với `.stat-tuvi`/`.stat-tinhthach`) thay
cho quét chữ toàn body — giữ đường quét-chữ làm lối lui vì site đã dời tên miền hai lần trong
hai ngày (`.one` → `.so`).

**Chín rồi mới hành động** (yêu cầu 15/08). Trước đây cụm đoạt chạy mỗi lượt ghé đủ ngưỡng, bất
kể chu kỳ đào tới đâu. Nay mọi lượt mở khoáng mạch đều quét dòng mình TRƯỚC; chưa「Đạt tối đa」
thì không mua, không đoạt, không nhận — chỉ đọc đồng hồ rồi nhường browser. Cờ「chín」(`ripe`)
tách khỏi cờ「đáng nhận」(`max`, do ngưỡng chốt lời quyết) có chủ ý: mua phù và đoạt mỏ chính là
thuốc NÂNG bonus, chúng phải được phép chạy đúng lúc ngưỡng chốt lời đang treo — đoạt xong bonus
100%→120% là cửa chốt tự mở trong cùng lượt, và bộ smoke có một bài đóng đinh đúng cảnh ấy.

**Phù thành lựa chọn riêng, một lá mỗi ngày.** `buyPhu` tách khỏi `hostMode` (phù phục vụ cú
chốt lời, không riêng gì đoạt); suất ngày ghi vào sổ trình duyệt NGAY LÚC QUYẾT chứ không đợi
toast xác nhận — một lượt mua trượt vì hết tiền cũng tiêu suất, đổi lại không bao giờ mua đúp.
Hai giới hạn nói thẳng trong doc: đổi hồ sơ trình duyệt là sổ về trắng (trần cứng còn lại là 3
lượt tấn công/ngày của site), và「ngày」theo đồng hồ máy, có thể lệch múi giờ reset của game.

Fixture lượt này lại bắt được một lỗi thật trước khi nó kịp sống: sổ mỏ mở lại phải về TRANG 1
(bằng chứng: click#239→#242 của bản ghi 14/08 đọc「Trang 1/3」), fixture bản đầu giữ nguyên trang
cũ và cả năm bài đoạt đỏ với `owner=false` — đúng cái chết mà flow thật sẽ chết nếu viết sai
chiều ngược lại. Smoke 355 bài xanh; probes.json của bản ghi 15/08 còn cho một món quà: chính
engine đã chạy trên site thật ở tên miền mới, selector schema-59 sống nguyên.

## 0.88.0 — xoá một mục bản tin là XOÁ THẬT, mà mục của bản sau vẫn tự hiện

Bản 0.87.0 nói thẳng một giới hạn:「xoá một mục vốn có trong tệp mã thì nó mọc lại」— và giải
thích rằng đó là cái giá của việc mục ở những lượt phát hành sau vẫn tự hiện. Tông chủ bác:
xoá phải dính.

**Hai điều ấy kéo ngược nhau, nên chỗ giải không nằm ở luật gộp.** Cho「sổ thắng trọn gói」thì
xoá dính, đổi lại mọi mục của các lượt phát hành SAU bị chôn sống — đúng cái bẫy 0.87.0 dựng ra
để tránh. Chỗ giải là một danh sách thứ hai: **`hidden`, những số bản đã bị gỡ**.

Nó được tính lúc LƯU, từ chính những mục ĐANG CÓ trong danh sách viết sẵn (`hiddenVersionsFor`):
mục nào của tệp mã mà bài vừa gõ không nhắc tới thì coi như đã gỡ. **Số bản ra đời SAU lượt lưu
ấy không nằm trong phép tính**, nên nó vẫn tự hiện. Hai điều cùng đúng, không phải chọn một.

Ba chi tiết quyết định hình dạng, và cả ba đều có ca riêng trong lưới kiểm:

- **Bia mộ KHÔNG chặn phần ghi đè.** Gõ lại số bản đã gỡ vào ô là cách người ta lấy lại một mục;
  nếu lúc gộp cũng lọc theo bia mộ thì cách ấy im lặng không ăn — đúng loại hỏng khiến người
  dùng tưởng ô nhập bị kẹt. Bia mộ cũng tự rụng ở lượt lưu kế, vì phép tính chỉ nhìn thứ đang
  VẮNG MẶT; không có danh sách tích luỹ nào phải đi dọn tay.
- **Ô RỖNG là ngoại lệ có chủ ý**: nó xoá cả phần ghi đè lẫn bia mộ, tức「trả bản tin về đúng
  danh sách đi kèm mã」. Đọc ô rỗng theo luật chung sẽ ra「gỡ sạch mọi mục」— một cú bấm làm trắng
  bản tin, mà không ai gõ Ctrl+A rồi Delete với ý định ấy.
- **Trần của `hidden` rộng gấp đôi `MAX_NOTES`**: nó tích theo lịch sử phát hành chứ không theo
  số mục đang hiện. Vẫn có trần, vì đây là biên tin cậy.

`verify:changelog` lên **175 phép kiểm** (+21). Hai ca đột biến đã thử, cả hai đỏ đúng chỗ: bỏ
phép lọc bia mộ lúc gộp → mục đã gỡ mọc lại; chôn tất kể cả mục còn giữ → sai ngay ca đầu.

## 0.87.0 — Gia chủ sửa được bản tin, mà mục của những lượt phát hành SAU vẫn tự hiện

Bản 0.86.0 chốt「bản tin là một tệp mã, cố ý không sửa được từ giao diện」và nói rõ đó là giá đã
cân nhắc. Tông chủ bác ngay hôm sau: sửa một dòng chữ không đáng phải chờ một lượt phát hành.
Nay có tab **Bản Tin** trong trang Tông Môn.

**Cái bẫy của việc cho sửa, và luật chọn để tránh nó.** Cách hiển nhiên nhất là「có sổ thì dùng
sổ」— và nó hỏng theo kiểu im lặng: một lượt sửa tay hôm nay CHÔN SỐNG mọi mục viết ở những lượt
phát hành sau, bản tin đứng im vĩnh viễn mà không ai hiểu vì sao. Nên luật là **cùng số bản thì
sổ thắng, số bản chỉ có trong tệp mã thì lấy nguyên** (`mergeReleaseNotes`, thuần). Cái giá phải
nói thẳng, và giao diện nói tại chỗ: **xoá một mục vốn có trong tệp mã thì nó mọc lại**. Sửa lời
thì giữ. Hai điều ấy là một — không có cách nào vừa để mục mới tự hiện vừa cho xoá vĩnh viễn mà
không đẻ ra một khái niệm thứ ba.

**MỘT Ô CHỮ, không phải biểu mẫu lặp.** Bốn việc người ta cần — sửa lời, thêm mục, bỏ mục, đổi
thứ tự — trong biểu mẫu lặp là bốn cụm nút và một mớ state; trong một ô chữ thì là gõ. Cú pháp
giữ đúng thứ người ta vốn viết trong ghi chú (`0.87.0 · 2026-08-14`, rồi mỗi ý một dòng `-`), lỗi
mang **số dòng**, và ô rỗng là câu trả lời hợp lệ nghĩa là「thôi đè, trả về danh sách gốc」— nhờ
vậy nút「về bản gốc」không cần tồn tại. Khối **xem trước** ngay dưới ô đọc bằng CHÍNH hàm server
dùng, nên thứ hiện ra là thứ sẽ được lưu, không phải một phép dựng lại gần đúng.

**Không quyền mới, không migration.** `saveChangelogAction` mở đầu bằng `requireAdmin()` y như
sáu form cài đặt anh em của nó, và dữ liệu nằm trong `app_settings` — thứ đã đi theo mọi lượt
chuyển trạm. Tab vì thế KHÔNG gác thêm `hasPermission` nào: dựng một tab chỉ hiện với một quyền
mà action lại không đòi quyền ấy là một lời hứa suông.

**Một chỗ suýt sai, bắt được lúc soi lại diff: NGÀY CÓ DẤU GẠCH BÊN TRONG.** Mẫu tách đầu mục
viết gọn thành `[·\-|]` thì với `0.9.0·2026-08-10` (không khoảng trắng) phép khớp tham lam lùi
tới dấu gạch CUỐI — cắt ngay giữa cái ngày, ra số bản `0.9.0·2026-08` và ngày `10`. Nay `·` và
`|` nhận mọi dạng, còn `-` thì ĐÒI khoảng trắng hai bên. Hai ca hồi quy đóng đinh chuyện đó, và
ca đột biến (gộp lại thành một mẫu) làm lưới kiểm đỏ đúng dòng.

`verify:changelog` lên **154 phép kiểm** (+55): mỗi ngả từ chối của `reviewNotes` một ca, phép
đọc chữ có ca khứ hồi (chữ → danh sách → chữ, không đổi một ký tự), ba dấu phân cách, lỗi kèm số
dòng, và phép gộp hai nguồn. Hai ca đột biến đã thử: cho sổ thắng trọn gói → đỏ; gộp ba dấu vào
một mẫu → đỏ.

Ràng buộc ở Zod (`app_settings.changelog`) CỐ Ý lỏng hơn `reviewNotes`: đó là biên tin cậy, chỉ
chặn thứ làm phình document hay sai kiểu. Luật biên tập gác ở cửa ghi. Siết cả hai nơi bằng cùng
một con số nghĩa là một document hợp lệ hôm qua bị ném sạch hôm nay chỉ vì luật văn phong đổi.

## 0.86.0 — dấu bản thành cửa mở BẢN TIN, và một lưới kiểm ép「bump bản là phải có tin」

Dấu bản ở góc màn hình trước nay là một dòng chữ chết: đúng số, mà số bản thì chẳng nói cho ai
điều gì. Đạo hữu mở trang lên thấy「v0.85.0」và không có đường nào biết hôm nay cái gì vừa đổi —
trong khi mỗi ngày có bốn tới sáu lượt phát hành.

Nay nó bấm được, mở ra danh sách những gì vừa đổi, và có một chấm vàng khi bản mới chưa được xem.

**Bản tin là một tệp MÃ, không phải một bảng trong database** (`src/lib/changelog.ts`). Nó tả đúng
cái commit chở nó, nên đi cùng một lượt phát hành thì không bao giờ lệch: trang đang chạy bản nào
thì bản tin đúng bản ấy. Cất trong database thì nó thành một thứ sống riêng — sửa được lúc nào
cũng được, và có ngày tả một tính năng chưa lên, hoặc lên rồi mà chưa ai chép vào. Đổi lại, nó
KHÔNG sửa được từ giao diện: muốn đổi một dòng tin là phải phát hành lại. Đó là cái giá đã cân
nhắc, không phải chỗ bỏ sót.

**Hai tệp changelog, hai người đọc, và không được chép qua lại.** `CHANGELOG.md` viết cho người
sửa mã: dài, sâu, kể tên hàm và lần hỏng việc. Tệp mới viết cho đạo hữu: 1–3 dòng, kể cái người
ta THẤY. Luật viết đầy đủ — ngắn, tiếng người, không gọi tên thành phần bên dưới, không nghe như
máy viết — là ý tông chủ, chép trong bản ghi nhớ `changelog-cho-nguoi-dung`.

**`npm run verify:changelog` (99 phép kiểm, thuần) và cái nó bắt được ngay lượt chạy đầu tiên:**
mục mới nhất phải trùng `package.json`. Chạy lần đầu nó ĐỎ thật — một phiên khác vừa bump lên
0.85.0 mà chưa có tin. Đó đúng là lý do luật này tồn tại: quên viết tin không để lại dấu vết nào
khác ngoài một dấu bản khai số mới bên cạnh một bản tin đứng im.

Lưới ấy còn giữ: thứ tự giảm dần so bằng SỐ chứ không bằng chuỗi (`0.9.0` > `0.10.0` theo chuỗi,
mà sai), ngày không nằm ở tương lai, và hai danh sách chặn — chữ của máy (`database`, `worker`,
`schema`…) lẫn khuôn sáo máy móc (`chúng tôi rất vui mừng`…). Hai danh sách ấy cố ý NGẮN: chúng
bắt loại rò rỉ thô — chép thẳng một dòng `CHANGELOG.md` sang — chứ không làm trọng tài văn phong.
Ca đột biến đã thử, cả hai đỏ đúng chỗ: nhét chữ `database` vào một dòng, và đảo thứ tự hai mục.

**Chấm báo tin đọc `localStorage`, và ba trạng thái của nó mới là phần đáng đọc.** Chuỗi bản =
đã xem; `null` = chưa từng mở (báo có tin, đúng sự thật); `undefined` = KHÔNG ĐỌC NỔI kho (Safari
riêng tư, cookie bị chặn) → **im lặng**. Một chấm không bao giờ tắt được vì không ghi nổi trạng
thái là thứ người ta học cách phớt lờ, và một khi đã phớt lờ thì nó hết tác dụng cho mọi lần sau.
Mốc「đã xem」ghi NGAY lúc mở chứ không đợi lúc đóng: đọc xong rồi bỏ tab là chuyện thường.

Phần bấm được nằm ở một tệp `"use client"` RIÊNG (`ChangelogTag`), còn `AppVersion` vẫn là server
component: gắn `"use client"` lên chính nó là ném nguyên `package.json` — gồm danh sách phụ thuộc
và mọi npm script — sang trình duyệt.

## 0.85.0 — Khoáng Mạch: ngưỡng % bonus riêng cho việc CHỐT LỜI (schema 59)

Trước bản này chỉ có một ngưỡng bonus, và nó gác việc **tiêu tiền để đoạt mỏ**. Không có cách
nào nói「mỏ đang cho ít quá, đừng nhận vội」— nên mọi chu kỳ đào đều bị chốt ngay khi chín, bất
kể mỏ đang cho 20% hay 120%.

Nay có ô thứ hai:「Ngưỡng % tu vi để đào」. Dưới ngưỡng thì **không mất gì** — phần đã đào treo
nguyên ở「Đạt tối đa」, lượt ghé thoát `onCooldown` hẹn 10 phút, chờ mỏ khá hơn (đổi chủ, ai đó
cắm phù). Mặc định `0` = luôn nhận, nên ngọc giản đã lưu không đổi hành vi.

**Hai ngưỡng fail ngược chiều nhau, và đó là chủ ý** — đây là phần đáng giữ lại của bản này:

| ngưỡng | gác việc | đọc hụt % bonus thì |
|---|---|---|
| `minBonus` (mới) | chốt lời — có nhận thưởng không | **vẫn nhận**, kêu to trong nhật ký |
| `hostMinBonus` (cũ) | tiêu tiền — có mua phù + đoạt không | **không đoạt** |

Cửa tiêu tiền hỏng mà im lặng không tiêu là đúng. Cửa thu hoạch hỏng mà im lặng không thu thì
mỗi ngày mất trọn phần thưởng chỉ vì một cái `id` đổi tên — nên nó nhường đường, và nói rõ rằng
nó vừa nhường. Ngưỡng này là phép tối ưu, không phải hàng rào an toàn.

Cửa mới nằm **trong** chính script đã quyết định「nhận hay chờ」chứ không thành script thứ hai:
hai đoạn cùng mô tả một khoảnh khắc là hai lá cờ đua nhau. Và một tương tác đáng biết — cụm
đoạt chạy **trước** phép nhận, mà đoạt làm bonus tăng (100%→120% theo bản ghi), nên một lượt
đoạt có thể tự mở luôn cửa mà chính lượt ấy vừa đóng. Smoke 347/347, thêm 9 bài đóng đinh cả
năm nhánh (dưới ngưỡng treo · biên `≥` chứ không `>` · ngưỡng 0 · mất ô bonus · đoạt mở cửa).

## 0.84.0 — Khoáng Mạch rời kiếp stub (schema 58): 44 bước thật từ một bản ghi 46 phút, đủ hai hạng tài khoản

Khoáng Mạch nằm trong sổ từ lâu dưới dạng nhãn phỏng đoán bị chặn cứng ba tầng — vì chưa ai
ghi hình trang ấy. Bản ghi `khoang-mach-20260814-133812` (46 phút video, 64 click kèm selector,
6 action AJAX, 17 ghi chú của người ghi) trả đủ chứng cứ, và có ba chuyện đáng giữ lại giá:

**Trang mỏ sống trong iframe, nên bản ghi KHÔNG có body HTML của nó** — `dom/*.html` chỉ chụp
trang hub, còn thân trang trong `network.json` bị cắt ở 32KB đầu (toàn `<head>`). Fixture vì
thế dựng từ hai nguồn còn lại: selector thật của từng cú click (recorder xuyên được iframe) và
83 control từ các lượt quét trạng thái. Bài học: đừng chờ có `dom/` mới viết được fixture —
nhưng cũng đừng bịa; hai kho chứng cứ kia đủ và THẬT.

**Fixture bắt được một lỗi thứ tự ngay lượt smoke đầu**: cụm đoạt mỏ đứng sau phép tìm dòng
mình, mà phép tìm có thể lật sổ sang trang 2 — cụm đoạt tỉnh dậy trước một trang không có nút
Đoạt Mỏ và lặng lẽ trượt (mua không, đoạt không, vẫn nhận thưởng — nghĩa là hỏng KHÔNG một
tiếng động trên đàn thật). Dòng-mình-nằm-trang-2 là chi tiết cố ý của fixture, và nó trả công
ngay: sửa bằng dời cụm host lên trang 1 vừa mở sổ — cũng đúng thứ tự người ghi hình đã làm.

**Chu kỳ 30 phút không giữ browser**: quest thoát `onCooldown` với đồng hồ THẬT (30′ trừ thời
gian đã đào, ghi vào một node ẩn cho `ReadCooldownSeconds` đọc bằng chính bộ parse của engine),
khôi lỗi đi làm việc khác rồi ghé lại — đúng ghi chú của người ghi hình. Trần ngày (hai ô
Tu Vi/Tinh Thạch server render, cạn sau ~2 lần nhận) đi đường `alreadyDone` + sổ trần-ngày.

Đoạt mỏ (mua Linh Quang Phù + Đoạt Mỏ) là opt-in tiêu tiền thật, mặc định tắt, chặn thêm bởi
ngưỡng % người dùng đặt và trần 3 lượt tấn công/ngày của chính site. Hai điều bản ghi không trả
lời được — văn bản popup mua (bị cắt) và hành vi mua-lại-khi-phù-còn-hạn — nằm sau `Optional`
và được nói thẳng trong bình chú, không giả vờ đã biết.

Cấu hình theo khuôn Luyện Đan: hai twin `khoang-mach`/`khoang-mach-thuong`, mỗi tab một bộ
tuỳ chọn riêng (loại khoáng · tên mỏ gõ tay được, rỗng = đào tiếp mỏ đang ở · đoạt mỏ ·
ngưỡng %). Smoke 338/338, trong đó 6 script mới vào chốt so-từng-byte C#↔web.

## 0.83.4 — nhánh GIỮ ĐAN có tiếng nói (schema 57), vì một tính năng câm là một tính năng không kiểm chứng được

Tông chủ báo「phân giải đan n sao trở xuống không hoạt động」. Câu trả lời hoá ra là **engine vẫn
đúng** — và chuyện đáng ghi là phải mất bao nhiêu công mới nói được điều đó.

**Đường đi tới câu trả lời**, vì nó chính là khiếm khuyết:

| Giờ (14/08) | Việc | Snapshot lượt chạy |
|---|---|---|
| 02:48 | thu đan **4 sao** → **phân giải** | `keepStarsFrom = 0` |
| 03:20 | cấu hình được LƯU: VIP = 4 | — |
| 03:26 | thu đan 2 sao → phân giải ✔ đúng | `keepStarsFrom = 4` |

Viên 4 sao mất lúc 02:48 chạy dưới cấu hình `0` =「phân giải tất cả」; engine làm đúng thứ nó được
giao. Nhưng để chứng minh được câu ấy phải: kéo env production của trạm đang phục vụ, nối vào
database, `join` `job_events` với `automation_jobs.config_snapshot`, rồi đối chiếu với
`user_configs`. Không một dòng nhật ký nào tự nói ra.

**Vì sao không nói được:** ba kết cục của tính năng này thì hai cái đã có tiếng —「Thu được đan N
sao」và「Phân giải viên đan」— còn nhánh **GIỮ** thì hoàn toàn câm. Nhìn nhật ký không phân biệt nổi
「cửa giữ đã bật」với「cửa giữ chưa bao giờ chạy」, mà đó đúng là câu hỏi mọi báo cáo lỗi đặt ra.

**Vá:** một bước kể chuyện đứng NGAY TRƯỚC lượt đóng hộp, dùng CHÍNH cửa `textMatches` của lượt ấy:

> `!Giữ lại viên đan 4 sao — mức phân giải đã chọn không đụng tới nó`

Hai điều khiến nó không phải một dòng log tuỳ tiện:

- **Cùng một cửa với hành động.** Lệch cửa là kể một đằng làm một nẻo — nhật ký nói「đã giữ」trong
  khi bước dưới vẫn đi phân giải. `verify:luyen-dan-stars` so `when` của hai bước bằng nhau.
- **Script tự đo bề rộng hộp.** `conditionProbe` lùi về `els[0]` khi không phần tử nào đang hiện,
  nên một hộp cũ còn nằm trong DOM có thể trả lời thay cho viên đan không ai mở — và một dòng
  tường thuật NÓI DỐI còn tệ hơn im lặng. Ca đột biến đã thử: vô hiệu phép đo ấy → script đỏ đúng
  ở ca「hộp đang ẩn」.

`verify:luyen-dan-stars` nay **21 phép thử** (+7), vẫn chạy trên markup chép nguyên văn từ bản ghi
và vẫn lấy script TỪ `profile.json` chứ không chép tay. Một phép đếm cũ phải sửa theo: nó đếm SỐ
CỬA và mong đúng 2, trong khi từ nay mỗi twin có hai bước dùng chung một cửa — nay đếm theo NHIỆM
VỤ, giữ nguyên nghĩa「không twin nào được mất cửa」.

**Schema 56 → 57 ở cả ba chỗ** (`DefaultQuestProfile.cs`, `profile.json`, chốt trong smoke). Bước
mới không đổi hành vi một byte nào, nhưng vẫn phải bump: desktop chỉ thay hồ sơ đã lưu khi schema
tăng, và một máy đứng ở 56 sẽ tiếp tục giữ đan trong im lặng — tức vẫn mang đúng khiếm khuyết vừa vá.

Nguồn sửa ở `jarvis-hh3d-pc/…/DefaultQuestProfile.cs` (một khối, sinh ra cả hai twin), rồi vá TAY
sang `profile.json`: diff 25 dòng thêm + 1 dòng schema, escape đúng kiểu bộ xuất .NET
(`>`, `'`, mọi ký tự ngoài ASCII), CRLF nguyên vẹn — không xuất đè cả tệp.

**Hai điều đáng biết, không nằm trong mã:**

- **Tab「Tài khoản thường」là một bộ cấu hình RIÊNG.** Đặt mức giữ ở tab VIP không đụng tới nó. Đo
  14/08: tài khoản `ironstark` của tông chủ là hạng VIP nên dùng bộ VIP; nhưng ai chạy tài khoản
  hạng `free` mà chỉ chỉnh tab VIP thì vẫn đang phân giải sạch.
- **Khôi lỗi trọ trên GitHub mang bản sao ĐÔNG LẠNH** của engine, nên bước kể chuyện này không tới
  chúng cho tới khi kho được dựng lại. VM tông môn thì cài đè là có.

## 0.83.3 — lượt chuyển trạm chết vì trạm gương thiếu migration, và cái chết ấy không chỉ được ra thủ phạm

Lượt chuyển sang `auto-hh3d-1` dừng ở bước cuối với đúng một câu:「**workers: LỆCH NỘI DUNG — dừng,
bảng điều phối chưa lật**」. Câu ấy đúng, và nó vô dụng: nội dung lệch ở đâu, vì cái gì, chữa thế
nào — không có chữ nào.

**Đo ra thủ phạm trong ba mươi giây, bằng một lượt hỏi `information_schema` trên cả năm trạm:**

```
auto-hh3d-2 (nguồn)   migration=28   workers(7): … last_assigned_at, max_jobs
auto-hh3d / -1/-3/-4  migration=27   workers(5): thiếu đúng hai cột ấy
```

Migration `0027` (bộ cân tải luân phiên, sáng cùng ngày) chỉ được áp lên trạm ĐANG PHỤC VỤ. Đây
đúng là cái bẫy `deploy:all` đã cảnh báo từ 11/08 —「một lượt phát hành có migration là N lần
migrate」— chỉ là chưa ai có công cụ để làm N lần ấy.

**Vì sao nó im tới tận bước cuối.** `copyTablePage` chép qua `json_populate_recordset`, mà hàm ấy
**bỏ qua mọi khoá JSON không có cột tương ứng ở đích**. Nên lượt chép báo xanh, đủ số dòng, không
một lời than — rồi `verifyTable` mới thấy `to_jsonb(t)` hai bên khác hình dạng. Cái sai xảy ra ở
bước 3 và chỉ kêu ở bước 5, sau khi đã đóng cửa phát việc, chờ đàn cạn, xoá sạch đích và chép xong
11 bảng.

### Ba việc, và việc thứ hai mới là việc đáng làm

**1. Hàng rào SCHEMA đứng trước lượt truncate** — `reviewColumnDrift` (thuần) so tên + KIỂU của
từng cột trong 11 bảng được chép, rồi gọi tên đúng thứ còn thiếu:

> `Schema đích lệch schema nguồn — workers: thiếu ở đích last_assigned_at, max_jobs; Chạy migration
> lên database của trạm đích rồi thử lại.`

So như TẬP HỢP chứ không so thứ tự — `to_jsonb` sinh jsonb, mà jsonb tự chuẩn hoá thứ tự khoá, nên
chặn theo thứ tự là chặn oan một lượt chuyển hoàn toàn lành. Lệch KIỂU cũng bị bắt: `to_jsonb` in
`2` cho `integer` và `"2"` cho `text`, tức cùng một kiểu hỏng mà không cột nào thiếu để nhìn ra.

**Hàng rào đứng ở HAI chỗ, và đó không phải thừa.** Ở `beginSwitchAction` (cửa vào) để đừng bế quan
cả tông môn rồi chờ đàn cạn cho một lượt đằng nào cũng chết; và trong `truncateAll` (điểm không
quay lại) vì giữa hai mốc ấy là cả pha chờ, đủ dài để ai đó áp một migration lên một bên.

**2. `npm run db:migrate:all`** — áp migration lên MỌI trạm trong sổ, mỗi trạm một lượt gọi chính
`migrate.mjs` với `DATABASE_URL` riêng. Không chép lại phần migrate vào đây: hai đường migrate là
hai đường sẽ trôi khỏi nhau, mà thứ trôi ở đây là DDL trên dữ liệu thật. Một trạm hỏng không giữ
những trạm còn lại ở lại phía sau, nhưng mã thoát cuối cùng vẫn ĐỎ — vì「bốn trên năm」chính là
trạng thái đã đẻ ra bản vá này. Có `--dry-run`.

**3. Chạy thật, và đo lại:** 5/5 trạm nay ở `migration=28`, `workers` đủ 7 cột. Lượt chuyển trạm
đã hết chỗ vấp.

### Kiểm chứng

`npm run verify:mirror-tables` — 21 khẳng định (+12), vẫn thuần, không database. Ca chính dựng lại
ĐÚNG hai bộ cột đo được hôm nay chứ không phải một cảnh giả định, và đóng đinh rằng lời từ chối
phải gọi tên **cả hai cột**, **tên bảng**, và **việc phải làm**. Ca đột biến đã thử: bỏ nhánh
「thiếu ở đích」→ script đỏ đúng ở ca cảnh-thật. Ba biên còn lại: đích migrate TRƯỚC nguồn cũng bị
chặn (và nói đúng chiều), đảo thứ tự cột thì KHÔNG phải lệch, bảng ngoài sổ chép (`notices`) lệch
bao nhiêu cũng không phải việc của hàng rào này.

## 0.83.2 — lượt cào bỏ hai cột truyền tải, và LUẬT CHỌN cột đổi nghĩa

Tông chủ chốt bỏ `Fast Origin Transfer` và `Fast Data Transfer` khỏi bảng cào. Mười cột còn **tám**.

Thứ đáng ghi ở đây không phải hai dòng bị xoá, mà là **luật chọn đã đổi nghĩa**. Bản 0.82.8 chọn
theo một tiêu chí khách quan — „mọi cột CÓ HẠN MỨC trên gói Hobby, tức mọi chỗ có thể chạm trần" —
và danh sách mười cột là hệ quả của tiêu chí ấy. Hai cột vừa bỏ thì **đều có hạn mức**. Nên từ bản
này danh sách không còn suy ra được từ một luật nào nữa: nó là thứ tông chủ muốn NHÌN. Bình chú ở
`WANTED_TITLES` nói thẳng điều đó, kèm một câu dặn đừng „sửa lại cho đủ" — vì người đọc bản cũ mở
trang Usage ra, thấy hai cột có trần đứng ngoài danh sách, sẽ tưởng mình vừa bắt được một thiếu sót.
Một phép kiểm đóng đinh nốt: không ai được lặng lẽ thêm chúng lại.

Kèm theo là một món hời không cố ý, và nó **khép lại câu hỏi bỏ ngỏ của 0.83.1**. Đúng hai cột này
là cặp đã làm trạm `auto-hh3d-3` đỏ ở lượt 18:04 — và đỏ y hệt ở lượt 17:30 trước đó — tức hai cột
mọc chậm nhất trang. Mục 0.83.1 kết lại bằng „vì sao chúng vắng mặt thì **chưa biết**, lượt cào kế
sẽ in ra tên gần giống". Nay không cần biết nữa: nhịp „đợi thôi mọc" không còn chờ chúng, nên bớt
đúng hai chỗ hay bắt hụt.

Chúng vẫn nằm nguyên trong trang mẫu của phép kiểm, và đó là chủ ý: hai dòng ấy là **hai dòng duy
nhất** trong trang mẫu có nấc kế của gói trả tiền (`1 TB` đứng ngay sau `100 GB`), nên chúng còn
gánh phép kiểm „nấc kế không bị nhận nhầm thành hạn mức". Bị loại ở bước CHỌN, không phải bước cắt
chữ — và phép kiểm mới nói đúng câu đó: đọc được mà không đẩy đi.

Một phép kiểm phải đổi chủ thể vì chuyện này: ca NBSP trước lấy `Fast Data Transfer` làm cột được
chọn, nay chuyển sang `Fluid Provisioned Memory` — cùng phép thử, khác cột. 45 phép kiểm (+3).

Sổ đã cào trước bản này vẫn giữ đủ mười dòng cho tới lượt cào kế; popup render theo bảng nhận được
nên không hề gì, chỉ là hai trạm cạnh nhau có thể lệch số dòng trong vài giờ.

## 0.83.1 — phép gợi ý tên câm ở đúng lần đầu được gọi thật

Lượt cào đầu tiên chạy với bản 0.82.8 (18:04, bấm tay) cho cả hai tin. Tin lành: ba trạm đẩy về
**đúng 10 meter**, gồm cả ba cột `Image Optimization` — tức danh sách tên chép từ ảnh chụp khớp với
trang thật, thứ chỉ một lượt chạy thật mới trả lời được. Tin còn lại: trạm `auto-hh3d-3` đỏ vì
thiếu `Fast Origin Transfer` và `Fast Data Transfer` — **đỏ y hệt ở lượt 17:30, tức TRƯỚC bản vá,
nên đây là chuyện có sẵn** — và dòng chẩn đoán mới toanh của 0.82.8 in ra: *„Không thấy tên nào gần
giống trong 51 meter đọc được".*

Nó nói sai, và nó sai ở đúng ca nó sinh ra để phục vụ. `nearMisses` bản đầu so **từ ĐẦU** của tên,
nên một cái tên rút gọn kiểu `Data Transfer` không được coi là gần giống `Fast Data Transfer`. Một
phép gợi ý chỉ chạy đúng khi cái tên gần như không đổi thì chẳng gợi ý được gì: cú đổi tên càng
mạnh, nó càng câm.

Nay so theo **TỪ CHUNG**, xếp hạng theo số từ chia được, chặn ở 8 dòng. Và nó **chọn nhớ hơn chọn
đúng** một cách có chủ ý: chia đúng một từ cũng được nêu (`Blob Stored Data` lọt vào vì chữ `data`),
nhưng bị xếp sau. Một cái tên thừa ở dòng cuối tốn của người đọc một giây; một cái tên thiếu thì họ
phải đi mở Chromium — đúng việc hàm này sinh ra để khỏi phải làm. Phép kiểm đóng đinh cả ba mặt:
tên rút gọn phải bị nêu, tên chia nhiều từ nhất phải đứng đầu, và cái chia một từ phải nằm SAU chứ
không bị giấu. 42 phép kiểm (+4).

Còn vì sao hai cột ấy vắng mặt trên trang của `auto-hh3d-3` thì **chưa biết** — lượt cào kế sẽ in
ra tên gần giống, và đó là lúc trả lời được. Ba trạm còn lại vẫn đủ mười cột.

## 0.83.0 — việc chia cho khôi lỗi theo LUÂN PHIÊN, và đàn đang nghỉ thôi đeo tên máy

Luật cũ: ai hỏi trước lấy trước. Nó đúng suốt quãng tông môn có một-hai khôi lỗi, và sai hẳn từ
lúc có bảy — đo 13/08/2026: `tong-mon-khoiloi` đang cầm 6 trên 13 đàn, trong khi bốn khôi lỗi trọ
vừa dựng thì rảnh. Không cái nào làm gì sai cả: cái vừa xong việc là cái hỏi sớm nhất, nên nó vơ
liền đàn kế tiếp trong nhịp 5 giây trước khi máy khác kịp gõ cửa. **Việc bị xếp theo NHỊP HỎI chứ
không theo SỨC CHỨA.**

Nay có một tầng phân công thật, `src/lib/services/dispatch.ts`:

- **Luân phiên theo `workers.last_assigned_at`** — ai lâu chưa được giao nhất thì tới lượt. Khôi
  lỗi vừa lên ca mang `null`, và `null` đứng ĐẦU hàng chứ không phải cuối: thêm một máy vào tông
  môn là nó có việc ngay từ vòng kế, không phải đợi hết một lượt của những máy đang chạy.
- **Máy chủ lần đầu biết trần ghế của từng máy.** `workers.max_jobs` do chính tiến trình khai ở
  mỗi lượt gõ cửa (`WORKER_MAX_JOBS`), cộng một phép đếm ghế đang bận — nên bộ cân tải không giữ
  lượt cho một máy đã đầy. Ghế bận chỉ đếm đàn còn NHỊP TIM TƯƠI: một tiến trình vừa khởi động
  lại bỏ rơi các dòng của kiếp trước, và đếm cả chúng thì nó bị coi là đầy ghế suốt ba phút đúng
  vào lúc rảnh nhất.
- **Van chống đói 20 giây.** Luân phiên đặt cược rằng khôi lỗi tới lượt sẽ hỏi việc trong vài giây
  tới. Cược ấy sai ở ca「tiến trình còn thở — nhịp tim của các đàn nó đang chạy vẫn điểm danh đều
  — nhưng vòng hỏi việc kẹt」, thứ sổ điểm danh không phân biệt nổi. Quá 20 giây (bốn nhịp hỏi bị
  lỡ) thì ai đủ tư cách cũng nhận được. Van bỏ qua phép tính LƯỢT, không bỏ qua TƯ CÁCH: một đàn
  「chỉ máy nhà」quá hạn ba ngày vẫn không rơi vào tay khôi lỗi tông môn.
- **`workerPref` rời khỏi SQL.**「Giao đàn cho」từng là mệnh đề `workerPrefFilter` nhét vào câu
  claim; nay nó nằm cạnh luật luân phiên trong cùng một hàm thuần — một bản để đọc, một bản để
  kiểm. Scope (khôi lỗi riêng chỉ thấy đàn của chủ mình) thì Ở LẠI trong SQL, vì nó là hàng rào
  PHÂN QUYỀN: đàn của người khác mang theo cookie game của người khác, thứ không được phép chỉ
  dựa vào một phép lọc ở tầng ứng dụng.

**Đàn đang nghỉ cooldown thôi đeo tên khôi lỗi.** `completeWorkerCycle` nhả `worker_id` về `null`
khi đàn quay lại hàng chờ, và migration `0027` dọn nốt những cái tên cũ. Trước bản này cả 12 dòng
đang nghỉ trên bảng Hàng Đợi đều đeo tên một khôi lỗi — một sự phân công KHÔNG CÓ THẬT, mà người
đọc hiểu thành「đàn tôi đã được đặt chỗ trước」. Việc gán nay xảy ra đúng lúc đàn thức dậy và bắt
đầu chạy, không sớm hơn một giây nào.

**`WORKER_MAX_JOBS = 2` cho MỌI khôi lỗi** — VM, Actions, khôi lỗi trọ. Số ghế từng là núm duy
nhất để dịch tải giữa hai máy (12/08: hạ VM từ 5 xuống 3 để nhường việc cho Actions); nay bộ cân
tải làm việc ấy tử tế hơn hẳn, nên con số ghế trở lại đúng nghĩa của nó: trần RAM của một cái máy.
Trần này còn được gác Ở MÁY CHỦ ngay khi bản web lên, kể cả với khôi lỗi chưa cập nhật — khôi lỗi
đời cũ không biết khai thì nhận trần chuẩn 2.

Nhân đây soát luôn `WORKER_QUEST_TABS`: **không dòng mã nào đọc biến ấy.** Nó là di sản của thời
còn chạy song song trong một đàn (nhánh ấy gỡ 12/08 để Mê Cung luôn chạy cuối), nên đặt nó bằng 3
hay 400 đều không đổi gì. Đã gỡ khỏi tài liệu VM để người sau khỏi vặn một cái núm không nối vào
đâu.

**Lưới kiểm.** `npm run verify:dispatch` — 35 phép kiểm trên hàm thuần, không cần database. Ba
lưới cũ chạm database (`verify:continuous`, `verify:daily-quota`, `verify:worker-pref`) phải sửa
theo, và chỗ sửa ấy lộ ra một khe đã âm thầm tồn tại từ trước: chúng dựng đàn ĐÃ TỚI GIỜ trên
database production, nơi sáu khôi lỗi thật hỏi việc mỗi 5 giây — nên một đàn kiểm mà chủ nó chưa
chọn「Giao đàn cho」là đàn hợp lệ trong mắt chúng. Ngày 14/08 đo được đúng cảnh ấy: một khôi lỗi
thật cầm mất đàn `virgin` giữa hai mục kiểm, và phép thử báo đỏ như thể luật phân công hỏng. Nay
đàn kiểm dựng ra ở trạng thái CHƯA tới giờ, và chủ chúng chọn「chỉ máy nhà」— cách ly bằng chính
luật của hệ thống, không bằng một cái cờ riêng cho phép thử.

## 0.82.8 — lượt cào Usage chỉ còn giữ mười cột có hạn mức, và phép cắt chữ của nó lần đầu được kiểm

Đạo hữu chỉ vào bảng Usage thật và chốt danh sách: mười cột CÓ HẠN MỨC, không hơn. Lượt cào trước
đây đẩy trọn ~54 meter của trang — phần lớn là số 0 của Queue, Sandbox, AI Gateway.

**Danh sách đổi ba chỗ so với `REQUIRED_TITLES` cũ:** bỏ `ISR Reads`, `ISR Writes`,
`Function Duration`; thêm `Image Optimization - Transformations`, `- Cache Writes`, `- Cache Reads`.
Ba cột bỏ đi không mất mát gì — hai cột ISR đứng ở 0 với kiến trúc hiện tại, còn Function Duration
thì Fluid làm nó đứng yên ở 0 (chính cột này đẻ ra vụ báo động「389% hạn」ngày 11/08).

**Cái lợi không nằm ở kích thước, nó nằm ở NHỊP CHỜ.** Vòng「đợi thôi mọc」trước đây đếm TỔNG số
meter, nên phần đuôi render lúc có lúc không cứ mọc thêm một dòng là nhịp đứng-yên bị đặt lại từ
đầu — chờ thêm một vòng vì một con số 0 mà không ai đọc. Nay nó chỉ đếm mười cột ấy, tức hết chỗ
cho cái hên xui từng đo được 56/61/49/40 meter qua bốn lượt liên tiếp.

**Phép cắt chữ rời sang `scripts/usageMeters.mts`, và đó mới là phần đáng kể của bản này.**
`vercelUsageFull.mts` gọi `chromium.launch()` ngay ở THÂN MODULE, nên nhập nó vào để thử một hàm là
mở một trình duyệt thật rồi treo ở đó — `parseUsageText` vì thế **chưa từng được kiểm một lần nào**,
dù nó là chỗ duy nhất quyết định con số nào được ghi vào sổ. Cùng hình dạng bài học đã buộc vòng
canh sổ điểm danh rời khỏi `removeGithubKhoiloi.mts` ở bản 0.82.5. Nay có `npm run
verify:usage-meters`: **38 phép kiểm thuần**, không mạng, không cookie, không Chromium, chạy trên
một trang mẫu dựng theo đúng ảnh chụp bảng thật.

Ba thứ phép kiểm ấy đóng đinh, cả ba đều là ca có thật chứ không phải phòng xa:

- **Nấc kế của gói trả tiền không được nhận nhầm thành hạn mức** (`1 TB` đứng ngay sau `100 GB`).
- **Tên meter xuất hiện HAI chỗ trên trang** — thanh điều hướng bên trái và thẻ số. Nên khi trùng
  tên thì lấy dòng CÓ HẠN MỨC, không lấy dòng đầu: một dòng ma của thanh điều hướng ghi vào sổ
 「Fluid Active CPU = 3」trông y hệt một con số thật. Đã thử cả hai chiều (dòng ma đứng trước, và
  đứng sau).
- **Gạch nối.** Ba cột mới mang một dấu `-` giữa tên, mà glyph ấy thì Vercel đổi lúc nào cũng được:
  so khớp nay chuẩn hoá en dash / em dash / dấu trừ toán học / khoảng trắng đôi / nbsp / hoa thường
  về một dạng. Thiếu một cột vì lệch đúng một ký tự nghĩa là mất số liệu vì một chuyện thuần trình
  bày — mà lượt cào chạy nửa giờ một lần, tức đỏ 48 lần một ngày. Ca ĐỘT BIẾN đi kèm giữ cho phép
  chuẩn hoá không nới thành đoán mò: `Cache Read` (thiếu chữ `s`) vẫn phải trượt.

Sổ ghi **TÊN CHUẨN** chứ không ghi chữ vừa đọc được, để hai trạm cào cùng một ngày không nói hai
thứ tiếng khác nhau.

**Và lượt đỏ nay tự khai chuỗi thật.** Thiếu cột thì ngoài danh sách thiếu, script in luôn những
tên GẦN GIỐNG đã thấy trên trang — ngày Vercel đổi chữ trên một thẻ, đó là dòng biến một lượt đỏ mù
thành một lượt sửa dài đúng một dòng. Không có tên nào gần giống thì nó nói ra điều khác hẳn: trang
chưa render xong, hoặc cookie chỉ mở được một phần trang.

Kèm một chỗ sửa nhỏ mà cũ: lượt tải-lại-thử-lần-nữa trước đây **cắm đầu lấy lượt sau**, nên một lượt
tải lại rơi đúng phút Vercel chậm sẽ báo thiếu nhiều hơn lượt đầu và đẩy người đọc đi tìm một cái
hỏng không tồn tại. Nay giữ lượt tốt hơn, và bảng thô đi kèm luôn thuộc về đúng lượt đang bị phán xử.

Giao diện thôi gọi nó là「bảng đầy đủ」— gọi vậy sau bản này là nói dối, người đọc sẽ đi tìm mấy cột
Queue/Sandbox và tưởng chúng vừa mất. Trần 200 dòng ở `/api/usage-report` thì GIỮ NGUYÊN: đó là hàng
rào của một trust boundary, không phải chỗ khai số cột mong đợi — siết xuống 10 là buộc cửa ấy phải
sửa mỗi lần bên kia thêm một cột, và ngày quên sửa thì lượt cào 400 im lặng.

**Chưa có bằng chứng:** vòng lặp trong `vercelUsageFull.mts` vẫn cần Chromium + cookie thật nên
chưa chạy được ở đây; thứ đã đo là 38 phép kiểm thuần, `typecheck:scripts` (không thêm tệp đỏ nào),
và hai ngả từ chối sớm của chính script vẫn thoát **mã 1**. Bảng đang nằm trong sổ của các trạm vẫn
là bảng ~54 dòng cho tới lượt cào kế — nhịp nửa giờ nên chậm nhất 30 phút là nó tự thay.

## 0.82.7 — kho gốc thôi cày: workflow khôi lỗi rời `.github/workflows/`, thành bản mẫu

`.github/workflows/linh-su.yml` chuyển sang **`deploy/github/linh-su.yml`**. GitHub chỉ chạy thứ
nằm trong `.github/workflows/`, nên một cú dời thư mục là đủ để kho gốc thôi lên ca — mà bản mẫu
thì vẫn còn nguyên cho `newGithubKhoiloi.mjs` rải sang những kho nó dựng.

**Vì sao dời, chứ không phải vì sao không thích.** Kho gốc là kho **công khai giữ mã nguồn**, nên
ba rủi ro đã ghi ở §6 của `deploy/github-actions.md` — `WORKER_TOKEN` (chìa TOÀN CỤC, mở cookie
của MỌI thành viên) nằm trong Secrets; nhật ký Actions vĩnh viễn ai cũng đọc của một tiến trình
chuyên cầm cookie game đã giải mã; và một kho「cày game 24/7」ngoài phạm vi chính sách GitHub —
suốt hai ngày qua đứng trên đúng cái kho giữ toàn bộ mã nguồn tông môn. Ở một kho SINH RA, cái giá
của cả ba là mất một kho dùng rồi bỏ, dựng lại bằng một cú bấm đúp. Ở đây, cái giá là mất kho gốc.

**Thứ ĐÃ có trước lượt này, và vì sao nó không đủ:** workflow đang ở trạng thái `disabled_manually`
trên GitHub — có người đã tắt tay. Nhưng một lượt tắt trong giao diện **không để lại dấu vết nào
trong git**: bản clone nào cũng vẫn mang tệp ấy, một cú fork hay một cú bấm「Enable workflow」là nó
lên ca lại, và không diff nào cho ai thấy điều đó đã xảy ra. Dời tệp thì ngược lại — ý định nằm
ngay trong lịch sử, đọc được, xét được.

**Hàng rào này là một tệp KHÔNG có mặt, nên nó phải được canh.** Loại hàng rào ấy không tự giữ
mình: một cú `git mv` ngược lại, hay một bản chép để「chạy thử một lượt rồi xoá」, dựng lại nó mà
chẳng ai thấy. `verify:github-removal` nay canh rằng **không workflow nào của kho gốc gọi
`scripts/worker.mjs`** — canh theo NỘI DUNG chứ không theo tên tệp, vì đổi tên `linh-su.yml` thành
`khoi-loi.yml` thì kho gốc vẫn cày như thường trong khi một phép kiểm bám vào cái tên vẫn xanh
nguyên. Hai ca đột biến đã thử, cả hai làm script đỏ đúng chỗ: chép lại đúng `linh-su.yml`
(*„kho gốc không có .github/workflows/linh-su.yml"*), và chép lại dưới tên khác
(*„workflow「khoi-loi-doi-ten.yml」của kho gốc không gọi worker.mjs"*). 86 phép kiểm, vẫn thuần.

**Kho SINH RA không đổi một byte.** Chúng vẫn nhận `.github/workflows/linh-su.yml` của riêng
chúng, vẫn thay đúng hai dòng `WORKER_ID` + `WEB_URL`, và `github:remove` vẫn moi id từ đúng
đường dẫn ấy qua API. Chỗ duy nhất đổi là **nguồn đọc** bản mẫu — kèm một phép soát `existsSync`
nói thẳng điều phải nói khi bản mẫu biến mất: *đừng chữa bằng cách chép một bản vào
`.github/workflows/` của kho gốc*. Không có câu ấy thì lượt sửa gấp tự nhiên nhất chính là lượt
dựng lại đúng thứ vừa gỡ.

**Một cái bẫy tự đặt ra rồi tự vấp trong chính lượt này, đáng ghi vì nó sẽ còn tái diễn:** bản
nháp đầu viết hẳn một khối chú thích「tệp này là bản mẫu, nằm ngoài `.github/workflows/` vì kho
gốc công khai…」lên đầu tệp mẫu. Mà tệp mẫu thì được chép NGUYÊN XI sang một kho công khai — nên
khối ấy vừa **sai chỗ đến** (ở kho sinh ra, nó đang nằm ĐÚNG trong `.github/workflows/`), vừa khai
ra tên kho gốc, tên script phát hành và tên lệnh kiểm chứng, đúng loại rò rỉ mà README sinh ra đã
phải né từ 13/08. Chữa bằng cách viết lại thành một LUẬT đúng ở cả hai nơi —「kho nào giữ mã nguồn
thì không chạy tệp này」— và đẩy phần chỉ người sửa kho gốc cần đọc sang §4 của tài liệu. Chỗ nối
giữa bản mẫu và kho công khai nay có một dòng chú thích nói thẳng điều đó, ngay tại điểm chép.

**Hai dấu chân còn lại, cố ý không tự dọn** (cả hai đều là việc trên tài khoản GitHub của đạo
hữu, và cả hai đều nằm ngoài thứ một commit làm được): secret `WORKER_TOKEN` vẫn nằm trong
Settings của kho gốc — nên xoá, vì nay không workflow nào ở đó cần tới nó; và dòng `github-khoiloi`
trong sổ điểm danh sẽ thành một dòng ma trong tab Khôi Lỗi, vì sổ ấy là sổ ĐĂNG KÝ và không ai
quét dọn dòng của khôi lỗi tông môn (cùng hình dạng với sự cố 13/08, xem 0.82.3).

## 0.82.6 —「không thấy」không phải「không còn」, và một thư mục công cụ chưa từng được trình biên dịch đọc

Hôm nay xoá ba trạm gương. Với `auto-hh3d-4` — token nằm trong `.env.local` — lượt chạy xoá sạch cả
project lẫn kho. Với `auto-hh3d-1` và `auto-hh3d-3` thì máy này KHÔNG có token nào của chúng, nên
danh mục project rỗng, `target` vắng mặt, và mọi phần chạm Vercel (liệt kê kho, `DELETE /v9/projects`)
đều nằm trong `if (target)` nên bị bỏ qua trọn vẹn. Lượt gỡ dòng sổ thì KHÔNG nằm trong `if` nào.
Kết cục, cả hai lượt chạy đều in:

```
✔ Trạm「auto-hh3d-1」đã xoá sạch: sổ, project, và 0 kho.
```

Đo lại lúc 17:20 cùng ngày: hai domain vẫn trả **307**. Hai project còn sống, hai database còn
nguyên dữ liệu người dùng, và không dòng nào ở đâu còn biết chúng tồn tại — vì dòng sổ, thứ duy
nhất nhận ra chúng, vừa bị chính công cụ dọn dẹp gỡ mất.

**LUẬT 5 — KHÔNG NHÌN THẤY PROJECT THÌ KHÔNG GỠ DÒNG SỔ.** Đây đúng là hình dạng LUẬT 4 của chính
tệp ấy, nâng lên một tầng: ở đó project là sợi dây duy nhất nhận ra kho, nên cấm xoá project khi kho
chưa dọn. Ở đây DÒNG SỔ là sợi dây duy nhất nhận ra project — nó giữ địa chỉ (suy ra tên project) và
từ 13/08 giữ cả token. Thiếu chìa thì「không thấy」KHÔNG có nghĩa là「không còn」, và một công cụ xoá
không được phép lẫn hai câu ấy. Luật nằm ở `reviewMirrorRemoval`, thuần, `verify:deploy-targets` bao
đủ sáu ô của bảng (có sổ × thấy project × `--book-only`).

`--book-only` là lối ra cho ca thật duy nhất mà luật trên chặn oan: project đã xoá tay trên
dashboard, chỉ còn dòng sổ mồ côi. Nó là một LỜI KHAI, nên nó bị bác ngay khi có bằng chứng ngược
lại — khai `--book-only` mà project đang sờ sờ ra đó thì lượt chạy dừng, chứ không nghe theo rồi tự
tay dựng nên đúng cái project mồ côi mà cả hàng rào sinh ra để chặn.

**Chìa gom từ HAI nguồn: `.env.local` trước, rồi token cất trong SỔ.** Bản 13/08 đã cho `mirror:new`
cất token vào sổ, và lý do ghi trong bình chú hôm ấy đọc lại thành một lời tiên tri: *"bốn trong năm
trạm không có token ở đâu cả"*. Chỉ là bên ĐỌC chưa bao giờ được viết. Nay `tokensFromBook` lấp chỗ
ấy, cho cả `mirror:remove` lẫn `deploy:all` — nghĩa là một trạm mà máy đang chạy không có dòng
`VERCEL_TOKEN_<TÊN>` thôi rơi khỏi mọi lượt phát hành. Đo trên dữ liệu thật: `mirror:remove --site
auto-hh3d --dry-run` nay báo `project: auto-hh3d trên team jarvis8796 (qua sổ「auto-hh3d」)` kèm đủ
hai kho, thay vì「không tồn tại」.

Phong bì hỏng chỉ làm MỘT trạm mất chìa, không giết cả lượt chạy: một dòng sổ mục nát không được
phép chặn lượt phát hành cho những trạm còn lành. Và trường `envName` của `TokenSource` đổi tên
thành `label`, vì cái tên cũ nói dối ngay ngày sổ bắt đầu giữ token — một nhãn `sổ「auto-hh3d-1」`
nằm trong một trường tên `envName` là cách người sau đi tìm nó trong `.env.local` mà không bao giờ
thấy. Cùng lượt ấy, phép chọn project trong `mirror:remove` thôi đếm SỐ LƯỢT NHÌN THẤY mà đếm số
`projectId` KHÁC NHAU — y bài học của `resolveTarget`, và từ nay nó nặng gấp đôi vì một trạm bình
thường có token ở cả hai nguồn.

**Câu tổng kết kể đúng những gì đã làm**, không đọc thuộc. Chính dòng「đã xoá sạch: sổ, project, và
0 kho」là thứ làm người vận hành tin hai trạm kia đã xong. Một dòng tổng kết sai còn tệ hơn không có
dòng nào: nó là thứ người ta đọc THAY cho việc đi kiểm.

**`npm run typecheck:scripts` — và thứ nó tìm thấy ngay lượt đầu.** `tsconfig.json` LOẠI thư mục
`scripts`, nên `tsc --noEmit` chưa bao giờ đọc một dòng nào trong đó, còn `tsx` thì chỉ LỘT kiểu chứ
không kiểm. Cả một thư mục công cụ vận hành — gồm những công cụ XOÁ — chưa từng được trình biên dịch
nhìn qua. Lượt chạy đầu tiên bắt được một lỗi chí mạng: chuỗi `*/` trong một biểu thức cron chép vào
khối chú thích của `removeGithubKhoiloi.mts` đã **đóng sớm khối chú thích và cắt đôi tệp** — tức
`npm run github:remove` không phân tích cú pháp nổi kể từ commit `336517b` (bản 0.82.3). Không phép
kiểm nào bắt được, vì phép kiểm của nó là thuần và nhập tệp KHÁC, còn bản thân công cụ thì cần một
PAT mới chạy được nên chưa ai gọi.

Lượt soi ấy còn phơi ra 6 lỗi kiểu CÓ SẴN ở bốn tệp khác, hai trong đó có vẻ là khiếm khuyết thật
(`verifyMaintenanceMode` khai vai `admin` đã bị xoá và thiếu vai `pham-nhan`; `sweepBrowsers` đếm
vào một trường không có trong `SweepResult`). Chúng nằm ngoài bản vá này và được tách ra một việc
riêng — nên `typecheck:scripts` hôm nay còn ĐỎ ở bốn tệp ấy, và con số ấy là phát hiện chứ không
phải khuyết điểm của phép soi.

## 0.82.5 — vòng canh sổ điểm danh được CHẠY THẬT, không chỉ được lý luận

Bản 0.82.3 dựng vòng canh và đóng đinh LUẬT của nó bằng đồng hồ giả. Nhưng nó đóng đinh đúng cái
phần vốn đã đúng: `judgeRosterPurge` là một hàm thuần, và hàm thuần hiếm khi là chỗ hỏng. Chỗ chưa
ai chạy thử là ĐOẠN DÂY nối luật ấy với database — câu SQL, phép ghi sổ `lastBeat`, phép cộng một
quãng do Postgres đo với một quãng đo bằng `Date.now()`. Một cái luật đúng nối bằng một sợi dây
sai thì vẫn đẻ ra đúng cái dòng ma của ngày 13/08.

Nay có `npm run verify:roster-purge`: bốn ca, chạy trên database THẬT, với một **runner giả gõ cửa
bằng chính câu `insert … on conflict do update` của `recordWorkerSeen`**. Không mock cái gì cả —
chính sự tranh chấp giữa hai lượt ghi mới là thứ phải kiểm. Ca quan trọng nhất dựng lại nguyên cảnh
13/08, và đo được: **6 lượt xoá, 5 lượt hồi sinh, rồi dòng biến mất thật.** Trước bản 0.82.3, cùng
kịch bản ấy để lại một dòng ma vĩnh viễn.

Ba ca còn lại khoá ba biên: xác nguội xong ngay ở lượt soi đầu (1,3 giây — không ngồi đợi hết cửa
sổ); sổ chưa có dòng nào thì VẪN canh trọn cửa sổ (một runner vừa khởi động có thể điểm danh muộn);
và một máy gõ cửa không bao giờ ngừng thì dừng đúng hạn ngân sách chứ không treo.

**Để có phép kiểm ấy, vòng canh phải rời `removeGithubKhoiloi.mts` sang `rosterPurge.mts`.** Tệp
kia gọi `main()` ngay khi được nhập, nên mọi thứ sống trong nó là thứ KHÔNG phép kiểm nào với tới
được: nhập vào để thử một hàm là khởi động luôn một công cụ xoá kho. Đây không phải chia tệp cho
gọn — đây là cái giá để một đoạn mã trở nên kiểm được, và nó đáng trả ở đúng đoạn mã mà lần trước
ta chỉ có thể lý luận về nó.

**Đồng hồ rút gọn, và nói thẳng nó KHÔNG kiểm cái gì.** 30 giây yên cộng 3 phút ngân sách, nhân bốn
ca, là hơn năm phút — một phép kiểm không ai chạy lần thứ hai. `PurgeTiming` truyền vào được để bốn
ca gói trong mươi giây; còn bốn con số thật thì vẫn do `verify:github-removal` giữ, gồm cả quan hệ
giữa chúng. Cái cửa ấy mở cho đúng một người dùng, và bình chú ở `PRODUCTION_TIMING` nói rõ thế —
một tham số「để chỉnh cho vừa ý」là cách một hằng số đã cân nhắc bị mài mòn dần.

Dòng tạm mang tiền tố `__purge_` và bị dọn trong `finally`, kể cả khi một ca ngã giữa chừng — cùng
lối với `__quota_` của `verify:daily-quota`.

## 0.82.4 — một dòng keyring đã chết phủ quyết được một PAT còn tốt, và chặn cả lượt dựng kho

`npm run github:new` chết ở bước dựng kho (mã 1) với câu「`gh` chưa cài hoặc chưa đăng nhập」kèm lời
khuyên đi `gh auth login`. Cả ba mệnh đề đều sai: `gh` đã cài (2.97.0), PAT hoàn toàn tốt, và
`gh auth login` đúng là cái lối mà thiết kế này **cố ý không dùng** — PAT đi qua biến `GH_TOKEN` của
riêng lượt chạy. Tài liệu (`deploy/github-actions.md`, `new-github-khoiloi.bat`) đã nói đúng điều ấy
từ đầu; chỉ có mã là bất đồng với chính tài liệu của nó.

Bằng chứng PAT còn tốt nằm ngay trong lượt hỏng ấy, ở dòng người ta lướt qua không đọc: kế hoạch in
ra kho `tranlehanam2017/linh-su-20260813-153131-8da0`. Tên tài khoản ấy **không ai gõ vào** —
`newGithubStation.mts` suy nó TỪ CHÍNH PAT bằng `GET /user`. In được dòng đó nghĩa là GitHub vừa trả
200 cho đúng token ấy, vài giây trước khi cổng đóng sập.

Thủ phạm: **`gh auth status` chấm điểm MỌI tài khoản `gh` từng cất, không riêng cái sắp dùng**, rồi
trả mã 1 nếu bất cứ dòng nào hỏng. Máy ấy còn một dòng keyring cũ của `tranlehanam2017` mang token
đã bị thu hồi. Đo tại chỗ ngày 13/08/2026: đặt `GH_TOKEN` rồi hỏi `gh auth status` thì nó liệt kê CẢ
HAI — dòng `GH_TOKEN` (`Active account: true`) lẫn dòng keyring (`Active account: false`) — và chỉ
riêng dòng thứ hai hỏng đã đủ kéo mã thoát lên 1. Một cái chìa không ai định dùng phủ quyết được một
cái chìa tốt.

**Nay cổng hỏi `gh api user`.** Nó hỏi đúng một câu, và là câu duy nhất đáng hỏi: cái chìa `gh` sắp
cầm — `GH_TOKEN`, `GITHUB_TOKEN`, hay dòng keyring đang hoạt động, theo đúng thứ tự ưu tiên của `gh`
— có mở được cửa không. Keyring cũ mục nát tới đâu cũng không còn tiếng nói. Cùng một cổng phủ được
cả hai cửa vào: qua `newGithubStation.mts` (có PAT) lẫn gọi tay tệp ấy (dùng keyring).

Chọn đúng endpoint `user` là có chủ ý: đó **cùng** endpoint mà `newGithubStation.mts` đã gọi để suy
ra tên tài khoản, nên hai phép kiểm không thể bất đồng — lối đi qua trạm mà qua được `whoami()` thì
chắc chắn qua được cổng này, và cổng không đẻ thêm một kiểu hỏng mới nào. Không kèm cờ nào cả, vì
mỗi cờ là một thứ có thể vắng mặt trong bản `gh` dưới máy — đúng loại hỏng mà
`assertGhSupportsPlannedCalls` sinh ra để bắt.

Câu từ chối cũng đổi: nhả NGUYÊN VĂN lời của `gh` (`Bad credentials (HTTP 401)`, hết hạn, thiếu
quyền…) rồi mới kể lối sửa theo từng cửa vào, và nói thẳng rằng một dòng keyring chết không còn chặn
được ai — kèm câu `gh auth logout` để dọn nó, ghi rõ là KHÔNG bắt buộc. Câu cũ trỏ người ta đi
`gh auth login`, tức đẩy họ đi sửa đúng thứ không hỏng.

## 0.82.3 — xoá xong một khôi lỗi GitHub thì sổ điểm danh phải SẠCH, không phải「đã gọi DELETE」

`npm run github:remove` ra đời ở bản 0.82.1 để dọn cả ba dấu chân của một kho khôi lỗi. Nó dọn đủ
ba — rồi dấu chân thứ ba mọc lại sau lưng nó.

**Xoá kho GitHub KHÔNG giết runner tức khắc.** Đo ngày 13/08/2026 trên
`github-khoiloi-20260813-105506`: kho đã trả 404, mà tiến trình trên runner còn gõ cửa
`/api/worker` thêm 52 giây nữa. `recordWorkerSeen` là một câu `insert … on conflict do update` —
nó không hỏi「tôi còn được phép tồn tại không」, nó chỉ ghi tên. Nên chưa đầy một nhịp gõ cửa
(5 giây) sau câu `delete from workers`, dòng ấy tự mọc lại, trong khi lượt chạy đã in「đã xoá
sạch」và thoát 0.

Bằng chứng nằm ở `first_seen` của dòng ấy: **14:39:35**, trong khi chính cái tên khai
**10:55:06**. Thứ người ta nhìn thấy trong tab Khôi Lỗi không phải dòng cũ sót lại — nó là một
dòng MỚI, sinh sau lượt xoá. Và nó nằm đó vĩnh viễn: sổ điểm danh là sổ ĐĂNG KÝ, không ai quét
dọn dòng của khôi lỗi tông môn (`forgetWorker` chỉ gỡ được khôi lỗi RIÊNG, nó lọc theo `userId`).

**Nay bước cuối là một VÒNG CANH, không phải một câu DELETE**: xoá, rồi soi lại cho tới khi không
dòng nào mọc lên suốt trọn 30 giây. Con số ấy không chọn cho đẹp — điều kiện đúng đắn là「dài hơn
nhịp gõ cửa」, mà một runner còn sống thì cứ mỗi 5 giây là chèn lại dòng của nó, nên 30 giây im
lặng loại trừ được mọi nhịp dưới 30 giây. Quãng im do CHÍNH database đo (`now() - last_seen`),
không đem mốc của nó trừ vào đồng hồ máy đang gõ lệnh: hai đồng hồ lệch bao nhiêu thì kết luận
sai bấy nhiêu. Đổi lại, một dòng đã chết từ hôm qua vẫn xong ngay ở lượt soi đầu — không ai phải
ngồi đợi 30 giây cho một cái xác nguội ngắt.

**Và huỷ mọi lượt chạy Actions TRƯỚC khi xoá kho**, để runner chết theo một lệnh dừng chứ không
chết vì đất dưới chân biến mất. Bước này best-effort, cố ý: thứ BẢO ĐẢM sổ sạch là vòng canh, nên
hụt quyền hay hụt mạng ở đây chỉ cảnh báo rồi đi tiếp — dừng cả lượt dọn vì không tắt nổi đèn là
sai vai. Phép lọc「lượt chạy nào còn sống」hỏi `status !== "completed"` chứ không dò một danh sách
trắng: GitHub đặt thêm trạng thái theo thời gian, và một danh sách thiếu tên sẽ bỏ sót đúng cái
lượt phải huỷ. Nó KHÔNG mâu thuẫn với `cancel-in-progress: false` trong tệp workflow — luật bên đó
cấm một lượt chạy mới cắt ngang đàn đang cày, còn lượt huỷ này đứng sau `reviewRemoval` và sau câu
xác nhận gõ tay.

**Hết 3 phút mà dòng vẫn mọc lại thì DỪNG, và gọi tên thủ phạm thật.** Runner vừa mất kho chỉ sống
thêm cỡ một phút; thứ còn gõ cửa sau ba phút là một máy KHÁC đang cài trùng `WORKER_ID`, mà với nó
thì xoá bao nhiêu lần cũng vô nghĩa. Câu cảnh báo cố ý KHÔNG mời chạy lại lệnh này: kho đã xoá và
dòng sổ đã gỡ, nên lượt sau sẽ bị `reviewRemoval` từ chối vì「không có bằng chứng nào」— hứa một
lối thoát cụt còn tệ hơn im lặng.

Luật của vòng nằm trong một hàm THUẦN (`judgeRosterPurge`), nên `verify:github-removal` lái được
nó bằng đồng hồ giả — 82 phép kiểm, mà ca gốc là「vắng NGAY SAU lượt xoá không phải bằng chứng đã
chết」. Dòng ma do lượt 13/08 để lại đã được gỡ tay.

## 0.82.2 — PAT trong sổ đọc lại được, vì GitHub thì không cho đọc lại

Tab Kho GitHub cất PAT trong phong bì `secretBox` và **chưa từng có đường mở nó ra**: ô PAT ở form
Sửa để trống nghĩa là「giữ cái cũ」, còn cái cũ là chuỗi gì thì không ai xem lại được. Luật ấy đúng
cho tới lần thứ hai cần chính con số đó — dán tay vào Actions secret của kho, chạy `github:remove`,
hay dựng thêm một kho nữa cho cùng tài khoản. Mà **GitHub không cho xem lại token đã phát**, nên khi
sổ cũng không cho xem thì đường duy nhất còn lại là phát PAT mới rồi đi cập nhật lại MỌI chỗ đang
cầm cái cũ. Đó mới là cái giá thật, và nó đắt hơn hẳn thứ đổi lại.

**Cửa mở là `revealGithubStationPatAction`, và nó hẹp có chủ ý:** gác đúng `github_station.manage`
như mọi action khác của tab, mở đúng **một** slug mỗi lượt, chỉ chạy khi có người BẤM.

**Thứ KHÔNG đổi mới là chỗ giữ được hàng rào:** `viewOf` vẫn không chép phong bì sang `StationView`.
Nghĩa là luật thật xưa nay không phải「PAT không bao giờ đi xuống」mà là「vẽ trang admin không kéo
theo PAT nào」— và luật ấy còn nguyên. Một tab admin để mở cả buổi vẫn không giữ bí mật nào trong
bộ nhớ trình duyệt; muốn có thì phải có một cú bấm, và cú bấm ấy để lại một lượt gọi ở server.

**Bản rõ hiện ra NGOÀI ô nhập, không đổ vào ô ấy.** Hai lẽ, lẽ thứ hai nặng hơn: ô để trống mới
đúng nghĩa「giữ PAT cũ」, và một ô đã có chữ nghĩa là cú bấm「Cập nhật kho」kế tiếp sẽ đẩy ngược
chính cái bí mật vừa xem lên máy chủ để mã hoá lại — một lượt đi thừa của một PAT, chỉ vì admin đã
ngó nó. Đã đo trên form thật: sau khi hiện, `FormData` của form vẫn mang `pat` rỗng.

**Nút chép nói ra khi nó không chép được.** `navigator.clipboard` không tồn tại ngoài secure
context, và lượt ghi còn bị từ chối nếu trình duyệt không thấy một cử chỉ người dùng. Bản đầu đi
theo khuôn `CopyBlock` cũ — `.then()` trần, không có nhánh hỏng — tức một cái nút bấm xong đứng im.
Ca ấy đã bật ra ngay trong lượt kiểm (`NotAllowedError`), nên nhánh hỏng nói thẳng:「bôi đen dòng
trên rồi Ctrl+C」.

Hai lời chẩn đoán khi mở phong bì hỏng — sai định dạng và sai `ENCRYPTION_KEY` — chép đúng câu chữ
của `pingStation`, vì việc phải làm ở cả hai ca đều là「dán lại PAT」chứ không phải một câu về mã hoá.

## 0.82.1 — sổ gương trạm lật trang, và con số 4 là để nó lật được ngay hôm nay

Sổ trạm dài thêm theo mỗi trạm ghi vào, mà ngay BÊN DƯỚI nó là form「Ghi trạm mới」— tức thứ người
vận hành xuống tab này để dùng thì nằm sau một danh sách không có trần. Đó là toàn bộ ràng buộc
thật; sổ lật trang để cái form ấy không bị chôn.

**Mỗi trang 4 trạm, không phải 5.** Sổ hôm nay có ĐÚNG 5 trạm, nên đặt 5 là dựng một thanh lật
trang không bao giờ hiện ra trên chính dữ liệu thật — một tính năng chỉ đúng trong lý thuyết, và
không ai phát hiện nó hỏng cho tới lúc trạm thứ sáu ra đời. 4 làm nó lật được ngay lượt mở tab kế.

**Lật trang là chuyện của trình duyệt, KHÔNG đẩy lên URL** như ô tìm kiếm bên bảng Môn Đồ. Cả mảng
trạm vốn đã nằm sẵn trong tay client (`MirrorSwitchPanel` cần trọn mảng để dựng ô chọn), nên một
`router.replace` mỗi lượt lật chỉ đổi lấy một vòng dựng lại trang server mà không đọc thêm được gì.

**Trang bị KẸP ngay lúc vẽ, không bằng `useEffect`.** Xoá trạm cuối cùng của trang cuối thì mảng
`mirrors` co lại ngay ở lượt render kế, mà effect chỉ chạy SAU khi đã vẽ — đường ấy cho người vận
hành thấy một cái sổ trống rỗng rồi mới kéo về. Kẹp tại chỗ thì không có khung hình nào sai. Giá
trị đã kẹp còn được ghi ngược lại state: thiếu bước đó thì xoá-rồi-ghi-trạm-mới làm sổ tự nhảy về
đúng cái trang người ta vừa bị đá ra khỏi.

**Đánh số thẳng, không có「trước/sau」.** Ở cỡ này (vài trạm) một cú bấm là tới bất kỳ trang nào, và
không nút nào bị tắt lúc đang mang focus — bấm「sau」để tới trang cuối rồi thấy chính nút vừa bấm
hoá xám là cách chắc chắn nhất để người đi bằng phím mất dấu mình đang đứng đâu.

**Trang không đứng vẫn phải mang viền vàng nhạt.** Bản vẽ đầu để viền trong suốt; trên ảnh chụp
thật nó đọc ra là một con số chết nằm cạnh「Kiểm mạch / Sửa / Xoá」. Mọi thứ bấm được trên tab này
đều có viền — đó là quy ước của tab, và một nút phá quy ước ấy thì không ai nhận ra là nút. Chỉ
lộ ra khi NHÌN, không lộ ra khi đọc mã.

## 0.82.0 — nhật ký được dọn bằng một cái đồng hồ, không còn bằng may mắn

Câu hỏi đặt ra sau bản 0.81.3: *tại sao lại chỉ quét một ngày một lần?* Trả lời thẳng — **Vercel
gói Hobby cho đúng MỘT cron mỗi ngày.** Đó là trần của nền tảng, không phải một lựa chọn thiết kế,
và nó là toàn bộ nguồn gốc của chuyện hạn lưu đếm bằng giờ mà không giờ nào được thi hành.

Bản 0.81.3 gỡ được phần lớn bằng cách cho lượt quét đi nhờ `/api/worker`. Nhưng nó vẫn là một lời
hứa **có điều kiện**: phải có khôi lỗi đang trực. Điều kiện ấy gần như luôn đúng (VM trực 24/7,
`github-khoiloi` chạy nối ca 4 giờ một lượt) — mà「gần như luôn đúng」thì vẫn không phải「đúng」, và
một cái núm hạn lưu không nên đứng trên một chữ「gần như」.

**`/api/cron/sweep` — cửa quét dày nhịp, gõ bởi một đồng hồ ngoài.** Đồng hồ ấy là GitHub Actions
(`.github/workflows/quet-nhat-ky.yml`), nhịp **10 phút**, không cần ai trực và không cần ai mở web.
Chỗ này không phải hạ tầng mới: dự án đã dùng Actions làm lịch cho hai việc khác, repo CÔNG KHAI
nên phút chạy không giới hạn, và `CRON_SECRET` đã nằm sẵn trong Secrets — nên workflow này không
cần cài đặt gì thêm. Một lượt là đúng một lệnh `curl`, không checkout, không `npm ci`: vài giây,
~7 phút runner mỗi ngày.

**Cửa mới phải đứng riêng khỏi `/api/cron`, và đây là lý do cứng:** `/api/cron` còn nuôi kho GitHub
(`runKeepalive`), việc ấy ĐẨY COMMIT lên bốn kho thật và được thiết kế cho nhịp ngày. Gọi
`/api/cron` mỗi 10 phút là rải ~144 commit mỗi ngày lên kho của người ta. Route mới ghi thẳng điều
cấm ấy vào chú thích, vì nó là loại sai lầm chỉ lộ ra sau khi đã rải xong.

**Hai cửa cron đi hai đường NGƯỢC NHAU khi trạm nghỉ, và đó là cố ý.** `/api/cron` trả 204 — cron
riêng của từng trạm không được đua nhau dọn trên hai database khác nhau. `/api/cron/sweep` trả 307
— nó do một đồng hồ gọi vào đúng một địa chỉ, im lặng ở đây nghĩa là suốt lượt chuyển trạm không ai
quét nhật ký. Trước bản này sự khác biệt ấy đúng một cách TÌNH CỜ (`decideRequest` so bằng, không
so tiền tố). Nay `verify:control` khoá cả hai chiều: một lượt「dọn cho gọn」đổi phép so thành
`startsWith("/api/cron")` sẽ đỏ ngay, thay vì lặng lẽ tắt lượt quét vào đúng ngày chuyển trạm.

**Không dùng `curl -L`.** Trạm nghỉ 307 sang trạm sống, mà `curl -L` VỨT header `Authorization`
khi đổi host, còn `--location-trusted` thì gắn lại chìa cho bất kỳ đích nào `Location` trỏ tới —
cả hai đều sai. Workflow tự đi từng chặng và tự kiểm, theo đúng bốn luật của `looksLikeStationHop`
(chỉ 307/308; không tụt https→http; giữ nguyên đường; tối đa một chặng). Đoạn shell ấy được thử
THẬT: trích thẳng từ YAML rồi chạy với hai trạm giả, sáu ca — gồm ca quan trọng nhất là *chuyển
hướng đổi đường thì chìa KHÔNG rời tay*.

Phép gác `Authorization: Bearer CRON_SECRET` gom về `lib/auth/cronSecret.ts`. Tới bản này nó đã bị
chép tay ở ba nơi giống hệt nhau, mà đây là loại mã không ai soi bằng mắt được: một phép so sai vẫn
cho đúng kết quả với chìa đúng.

`verify:job-event-sweep` thêm hai phép kiểm ràng YAML với TypeScript: dòng `cron:` phải khớp
`JOB_EVENT_SWEEP_CLOCK_MINUTES` (con số trang admin HỨA với trưởng môn), và đường workflow gõ phải
có route thật đứng sau. Đổi nhịp một bên mà quên bên kia thì phép kiểm đỏ, chứ không phải giao diện
lặng lẽ nói dối — đúng loại lỗi mà cả hai bản vá này sinh ra để chấm dứt.

Giao diện nay hứa nhịp VÔ ĐIỀU KIỆN (10 phút) thay cho nhịp-trong-điều-kiện-thuận-lợi của 0.81.3.
Hứa cái tốt nhất là cách nhanh nhất để lại nói dối.

## 0.81.3 — cái núm hạn lưu đếm bằng giờ, còn lượt quét chạy mỗi ngày

「Hạn Lưu Nhật Ký Đàn」đặt **1 giờ**, rồi trang admin ngồi báo **5.010 dòng đã quá hạn** trên tổng
5.208 — và không tự xoá dòng nào. Không lỗi, không dòng log đỏ, không gì hỏng. Cái núm chỉ đơn
giản là chưa bao giờ được thi hành.

Gốc rễ nằm ở khoảng cách giữa hai con số mà không ai đặt cạnh nhau: từ bản 0.72.0 hạn lưu đếm
bằng **GIỜ**, tối thiểu 1 — trong khi lượt quét TỰ ĐỘNG duy nhất là `/api/cron`, mà gói Hobby cho
đúng **một lần mỗi ngày**. Nghĩa là 23 trong 24 nấc đầu của cái thang ấy là lời hứa suông. Bằng
chứng rõ nhất cho việc chỗ này đã được biết mà chưa được sửa: giao diện phải viết hẳn hai đoạn
xin lỗi (*„nhịp quét tự động vẫn chỉ chạy MỘT LẦN MỖI NGÀY"*) và dựng một nút「Quét ngay」để người
ta tự tay làm phần máy đáng phải làm. Một cái núm cần chú thích giải thích vì sao nó không chạy
thì đó không phải chú thích, đó là báo lỗi.

**Lượt quét thứ hai đi nhờ `/api/worker`**, không phải một đường đọc của trang nào. Chỗ này là cả
lý lẽ của bản vá: `job_events` chỉ phình khi có khôi lỗi chạy, mà khôi lỗi hỏi việc mỗi 5 giây
suốt ngày đêm dù không một ai mở web. Nên cửa ấy dày nhịp đúng lúc bảng đang lớn, im lặng đúng lúc
bảng đứng yên, và vì là endpoint của MÁY nên một lượt xoá hàng loạt chạy nhờ ở đó không làm chậm
trang của ai — đúng nỗi lo đã ghi trong `purgeExpiredJobEvents` từ đầu (*„không đáng đặt trên
đường đi nóng của một trang"*). Đường đi của khôi lỗi không phải một trang. Chạy trong `after()`
nên hồi đáp bay đi trước, và trần lô hạ xuống 2 (cron vẫn giữ 10, vì chỉ cron mới khai
`maxDuration = 60`).

**Nhịp quét bám theo chính hạn lưu**: một phần sáu, kẹp trong [5 phút, 6 giờ]. Chọn TỈ LỆ chứ
không một con số cố định vì thứ cần ràng buộc là phần vượt hạn tương đối — dòng sống lâu nhất là
hạn lưu cộng một nhịp, tức không quá ~17% quá mốc, ở mọi nấc từ 1 giờ tới 365 ngày. Trước bản này
con số ấy là **2.400%** cho hạn lưu 1 giờ. Sàn 5 phút không nấc hợp lệ nào chạm tới (hạn lưu nhỏ
nhất cho nhịp 10 phút) — nó là hàng rào cho một con số hỏng, vì một `NaN` lọt vào phép so mốc sẽ
biến cửa nhịp thành vòng quét mỗi 5 giây.

Phép suy nhịp nằm ở `validation/retention.ts`, cùng chỗ với các biên và **không import gì** — bắt
buộc, vì ba nơi cần chung một nhịp và hai trong số đó KỂ nó ra bằng chữ: form (client) hứa với
trưởng môn, câu báo sau khi Lưu (server) nhắc lại, và `sweepExpiredJobEventsIfDue` (server) là nơi
giữ lời. Gõ lại phép chia ở ba chỗ là ba cơ hội để giao diện hứa một nhịp mà máy không chạy. Nay
form đọc thẳng ra con số thật —「bị quét mỗi **10 phút**」— thay cho đoạn xin lỗi cũ.

Cửa nhịp **đóng TRƯỚC khi chạy chứ không sau khi xong**: lượt quét có thể ném (database chớp), và
một cửa chỉ đặt lại mốc ở nhánh thành công là cửa mở toang ngay sau lần hỏng đầu tiên — mỗi nhịp
hỏi việc 5 giây lại một lượt xoá, đúng vào lúc database đang ốm.

Kiểm bởi `verify:job-event-sweep` — thuần số học, không chạm database. Nó không thử vài điểm nhặt
tay mà quét **cả thang 1–8760 giờ** để đóng đinh đúng tính chất bản cũ vi phạm: *nhịp quét phải
mịn hơn cái mốc nó thi hành*. Cộng thêm hàng rào con số hỏng (NaN, vô cực, 0, âm — đều phải kẹp về
phía THƯA nhất) và phép kể bằng chữ (tròn trước rồi mới tách, để không ra「0 giờ 60 phút」).

Cron giữ nguyên, nay đúng vai lưới an toàn: những ngày không khôi lỗi nào lên ca thì `job_events`
vẫn có người dọn. Nút「Quét ngay」cũng ở lại, cho hai ca nó vốn phục vụ — muốn thấy kết quả NGAY,
và không có ai đang trực để chở nhịp quét.

## 0.81.2 — bảng Hàng Đợi đếm một cuộc đua mà đàn ấy không tham gia

Hai dòng của một đạo hữu nằm im 70 phút với chữ「Chờ tới lượt · thứ 1」và「thứ 2」. Con số ấy sai,
và nó sai theo kiểu tệ nhất: nó trấn an. Chủ đàn đã chọn「Giao đàn cho: máy nhà」, tức
`workerPrefFilter` CẤM hai khôi lỗi tông môn chạm vào — nên hai đàn ấy không đứng trong hàng nào
cả, chúng chỉ đang đợi một cái máy đã tắt từ đầu. Bảng thì vẫn đếm chúng như đang nhích dần tới
lượt, và còn đẩy những đàn THẬT SỰ trong hàng chung xuống thứ 3, thứ 4.

Gốc rễ: `getQueueSnapshot` chạy MỘT bộ đếm cho mọi dòng đang chờ, dù chú thích của chính trường
ấy đã khai nó là「thứ tự trong hàng chờ của khôi lỗi tông môn」. Trớ trêu hơn: đoạn chữ ngay trên
bảng đã nói đúng luật từ lâu — *„Ai đã cài khôi lỗi riêng thì không phải chờ hàng chung"* — chỉ
có con số là chưa nghe theo.

Nay số thứ tự đi kèm HÀNG của nó (`queuePool`): `sect` cho đàn tông môn được phép nhận, `own`
đếm riêng trong hàng của từng chủ. Và thêm `poolHasWorker` — có khôi lỗi ĐỦ TƯ CÁCH đang trực
không — nên chỗ ấy nói ra sự thật thay vì đếm suông:「Chờ máy nhà — chưa máy nào trực」.

Ca `any` là chỗ dễ sai nhất và được canh riêng: nó đứng ở hàng chung nhưng máy nhà của chủ cũng
nhặt được, nên câu「có ai trực không」phải hỏi CẢ HAI phía — bằng không một đàn `any` bị báo là
vô vọng vào đúng lúc máy nhà của chủ nó đang chạy ngon lành.

Phép xếp chỗ tách thành hàm thuần `assignQueueSlots`, kiểm bởi `verify:queue-pools` (16 khẳng
định, không cần database) — vì đây là loại lỗi không bao giờ lộ ra bằng mắt: con số vẫn tăng đều,
vẫn đẹp, chỉ là nó đếm nhầm cuộc đua. Nghiệm thu trên dữ liệu thật: hai dòng ấy nay đọc「Chờ máy
nhà — chưa máy nào trực」, và hàng tông môn được đánh số lại từ 1 cho đúng người đang đứng trong nó.

## 0.81.1 — VM nhường 2 ghế cho khôi lỗi GitHub, và lần đầu restart không chém đàn ai

`WORKER_MAX_JOBS` của VM: **5 → 3**. Hai ghế còn lại thuộc về `github-khoiloi` (đang đặt 2 trong
workflow), nên tổng mức song song của tông môn nay là **3 + 2 = 5**. Không sửa một dòng mã phân
công nào, vì không có dòng nào để sửa: ghế CHÍNH LÀ núm chia việc — VM đầy ghế thì câu claim kế
tiếp rơi vào tay máy còn chỗ. Số nằm ở drop-in systemd trên VM (`override.conf`), không nằm trong
repo lẫn `setup.sh`; ba chỗ tài liệu ghi con số cũ đã sửa theo, kể cả một dòng bình chú trong
`setup.sh` vốn còn ghi nhầm `10G` cho một máy đang chạy `18G`.

**Và phần đáng kể hơn con số: từ nay restart KHÔNG cắt ngang đàn đang cày.** `worker.mjs` vốn đã
nghe `SIGTERM` rồi vào pha rút lui (thôi nhận việc, chờ đàn đi nốt vòng, thoát sạch) — nhưng
systemd mặc định chỉ chờ **90 giây** rồi `SIGKILL`, mà một ván Mê Cung dài ~35 phút. Nên pha rút
lui ấy chưa bao giờ dùng được trên VM: mọi lượt `systemctl restart` (và mọi lượt `setup.sh`, vì
bước đầu của nó là `systemctl stop`) đều chém đứt đàn đang chạy, rồi `reapStaleJobs` kết liễu
chúng thành `failed` sau 3 phút — người dùng mất trọn một vòng và phải bấm Khai Đàn lại.

Phải sửa BA thứ, không phải hai — và mảnh thứ ba chỉ lộ ra vì lượt sửa đầu **vẫn giết đàn**:

```
KillMode=mixed                   SIGTERM chỉ tới tiến trình CHÍNH
WORKER_DRAIN_TIMEOUT_MS=2100000  worker tự bỏ cuộc ở phút 35
  <  TimeoutStopSec=2400         systemd SIGKILL ở phút 40
```

**Lượt nới hạn chờ đầu tiên trông y như đã thành công, và nó chỉ đúng một nửa.** Nhật ký in đúng
câu thiết kế hứa — `Thu đàn: nhận SIGTERM. Thôi nhận việc mới, chờ 3 đàn đang chạy đi nốt vòng.`
— rồi đứng ở `deactivating` hai phút và thoát sạch. Nhưng đúng GIÂY gửi tín hiệu, database nhận
**12 dòng** `page.goto/page.reload: Target page, context or browser has been closed` trải khắp
hai đàn VM đang giữ. Lý do: `KillMode` mặc định là `control-group`, tức `SIGTERM` tới MỌI tiến
trình trong cgroup — worker ngồi chờ đàn đi nốt vòng trong khi Chromium của chính những đàn ấy
đã bị giết ngay dưới chân nó.

Thiệt hại thật thì NHẸ HƠN vẻ ngoài, và chỗ này đáng nói vì suýt nữa đã ghi sai vào đây: **không
đàn nào chết**. Worker vẫn sống nên nó kết thúc hai vòng ấy tử tế và xếp lại hàng
(`Đi hết một vòng — 4 nhiệm vụ thuận lợi` lúc 01:09), tức mất phần nhiệm vụ còn lại của vòng
đang chạy chứ không mất cả đàn — `reapStaleJobs` chỉ kết liễu khi nhịp tim TẮT HẲN. Đo lại đúng
cửa sổ 01:05–01:16: **0 đàn chuyển sang `failed`**. (Bốn đàn chết lúc 00:19 và 00:47 là chuyện
khác, trước lượt restart 19–47 phút, không phải do nó.)

Bẫy đọc-nhầm-nhân-quả gặp ngay trong lượt truy này, ghi lại vì nó sẽ gặp lại: `job_events` không
lưu ai LÀM ra dòng ấy, nên join sang `automation_jobs.worker_id` là đọc được chủ HIỆN TẠI của
đàn, không phải chủ lúc sự việc xảy ra. Cùng một chùm lỗi vì thế trông như thể do hai máy khác
nhau gây ra cùng một giây — một sự trùng hợp không thể có, và chính nó tố cáo phép suy sai.

Hai mốc thời gian giữ thứ tự app-trước-nền-tảng, cùng lối với bộ 290+50 < 350 < 360 bên Actions:
hết 35 phút mà còn đàn dở thì worker tự thoát kèm dòng nói rõ「còn N đàn chưa xong」, thay vì bị
`SIGKILL` câm lặng ở phút 40.

Cái giá phải biết trước: `setup.sh` từ nay có thể đứng im tới 35 phút thay vì xong trong một
phút, vì bước đầu của nó là `systemctl stop`.

**Bản vá `KillMode` đã đo, và kết quả không tròn — ghi ra thay vì làm tròn.** Lượt restart thứ
hai rơi trúng lúc VM giữ một đàn đang chạy: **1** dòng „browser has been closed" thay vì 12, đàn
vẫn kết thúc vòng và không đàn nào chết. Nhưng 1 chưa phải 0, và dòng ấy rơi đúng giây vòng chạy
kết thúc — có thể là cuộc đua lúc dọn trình duyệt cuối vòng, cũng có thể là một đường còn sót;
phân biệt được cần thêm vài lượt restart trúng lúc có đàn, chưa làm. Mốc so sánh cho ai soi tiếp:
3 giờ vận hành bình thường trước đó không có một dòng „has been closed" nào.

Thứ đã đo chắc chắn: `WORKER_MAX_JOBS=3` nằm trong `/proc/<pid>/environ` của tiến trình đang
chạy, và chính worker in `tối đa 3 đàn cùng lúc` lúc lên ca.

## 0.81.0 — Tế Lễ bấm vào một hộp thoại đã không còn tồn tại (schema 56)

Tế Lễ Tông Môn (tài khoản thường) hỏng ở bước cuối: script mở hộp xác nhận rồi bấm
`.swal2-confirm`. **Trang đã gỡ SweetAlert2.** Bản ghi 13/08
(`te-le-tong-mon-20260813-001731`) chụp `/danh-sach-thanh-vien-tong-mon` với **0 lần** xuất
hiện chữ `swal2` trong toàn bộ HTML — kể cả phần CSS. Nên bước ấy chỉ có thể chờ hết 10 giây
rồi hỏng, mọi lượt, kể từ ngày trang đổi. Đây là quest TỐN 10 Tinh Thạch, nên cái hỏng ấy ít
nhất đã hỏng đúng chiều: nó không nhận vơ là xong.

Hộp bây giờ là component của chính site: `#hh3d-confirm-layer`, nút thuận
`.hh3d-confirm__btn--confirm`, nút từ chối `.hh3d-confirm__btn--cancel`.

- **Cửa chờ hỏi CHỮ trong hộp, không hỏi「có hộp nào hiện không」.** Lớp ấy là hộp DÙNG CHUNG —
  một cái layer trang tái sử dụng cho mọi câu hỏi có/không, dựng ra lúc bấm và gỡ khỏi DOM lúc
  đóng. Cùng trang ấy có `#leaveGroupBtn`「Thoát Khỏi Tông」. Chờ「có hộp」rồi bấm nút thuận là
  một ngày nào đó tự nguyện rời tông môn, và không có bước nào sau đó bắt được.
- **Nút thuận được khoanh trong lớp** (`#hh3d-confirm-layer .hh3d-confirm__btn--confirm`) chứ
  không dùng class trần: trong DOM, **「Hủy」đứng TRƯỚC「Tế Lễ」**, nên một selector rút gọn về
  `.hh3d-confirm__btn` bấm đúng vào Hủy.
- **KHÔNG gác bằng `data-done`.** Nút mang thuộc tính ấy và CSS của trang làm xám nút ở
  `[data-done="1"]`, nên nó trông hệt một cờ trạng thái. Không phải: bản chụp sau một lượt tế
  lễ THÀNH CÔNG (`dom/04-click.html`) vẫn là `data-done="0"` trên một cái nút đã `disabled` và
  đã đổi chữ thành「Đã Tế Lễ」. Trang viết chữ và cờ disabled, rồi quên thuộc tính. Chỉ CHỮ là
  nói thật ở cả hai trạng thái — cửa dừng và cửa nghiệm thu đều đọc chữ, như cũ.

**SCHEMA 55 → 56**, phần bắt buộc chứ không phải lịch sự: web đọc lại `profile.json` mỗi lượt
nên được vá ngay, còn bản desktop CHỈ thay hồ sơ đã lưu khi schema tăng — không bump thì máy
nào đang ở 55 giữ nguyên selector ma. Nguồn thật là `DefaultQuestProfile.cs` bên desktop
(1.57.0); khối quest trong `profile.json` được đối chiếu byte-với-byte với bản xuất từ đó.

**FIXTURE CŨ LÀ ĐỒNG PHẠM.** `smokeQuestEngine.mjs` tự dựng một hộp `.swal2-confirm` không còn
tồn tại ngoài đời, nên bộ chạy thử xanh mướt suốt thời gian production câm — đúng họ lỗi mà
Luyện Đan 12/08 vừa dạy. Fixture nay chép markup từ bản ghi: hộp đúng tên, dựng-rồi-gỡ khỏi
DOM thay vì ẩn đi, và nút sau lượt thành công vẫn mang `data-done="0"` như trang thật.

**KIỂM CHỨNG.** `npm run verify:te-le-confirm` (mới): 23 phép thử trên Chromium thật, dựng
markup chép nguyên văn từ `dom/01-load.html`, `dom/02-click.html`, `dom/04-click.html`, chạy
CHÍNH `conditionProbe` mà engine gửi xuống trang, selector và chữ đọc TỪ `profile.json` chứ
không chép tay. Có cả ca hộp「Thoát Khỏi Tông」dựng trên cùng component: cửa chờ phải ĐÓNG.
Lật ngược hồ sơ về `.swal2-confirm` thì nó đỏ 8/23 (đã thử, rồi khôi phục nguyên byte).
`npm run smoke`: 311 thuận, 0 nghịch. `npm run verify:profile` thuận. `npx tsc --noEmit` sạch,
và script mới được soi tường minh vì `tsconfig` chỉ include `**/*.ts`.

**Chưa đụng tới, nói thẳng:** `hoang-vuc` và `hoang-vuc-thuong` vẫn bấm `.swal2-confirm`.
Trang của chúng là `/hoang-vuc`, một trang khác, và **không ai có bản ghi mới của nó**. Có thể
nó cũng đã đổi, có thể chưa. Quét cả loạt theo suy đoán từ một trang khác là đúng cái kiểu
sửa mù mà bản ghi sinh ra để thay thế — cần một bản ghi `/hoang-vuc` rồi mới động.

---

## 0.80.0 — một PAT, một cú bấm đúp: kho mới dựng xong là đã nằm trong sổ

`new-github-khoiloi.bat` + `npm run github:new`. Người dùng dán đúng MỘT thứ — PAT của tài khoản
GitHub sẽ giữ kho — rồi script tự lo phần còn lại: suy tên tài khoản từ chính token, đặt tên kho
ngẫu nhiên, đặt `WORKER_ID` theo khuôn `github-khoiloi-<mốc>`, dựng kho, dán secret, bấm chạy, và
**ghi thẳng kho ấy vào sổ Kho GitHub của trạm đang hoạt động** rồi ngó một lượt để chứng minh PAT
push được. Trước bản này, hai việc cuối là hai thao tác tay trên trang admin, và ai quên thì kho
mới cứ thế đếm ngược tới mốc 60 ngày mà không ai nuôi.

**Gọi lại `newGithubKhoiloi.mjs` chứ không chép nó.** Phần dễ sai nhất — danh sách tệp phải chép
— vừa mới trả giá một lần ở 0.79.2 và nay đã có `assertImportsResolve` canh; một bản sao thứ hai
là hẹn ngày hai bản trôi khỏi nhau. Tệp mới chỉ thêm ba thứ mà bản `.mjs` không làm được vì nó là
Node thuần, không chạm database: hỏi danh tính PAT, đặt tên, và ghi sổ.

**Ba phép kiểm đứng TRƯỚC mọi phép tạo**, vì tạo kho xong mới phát hiện hỏng là bỏ lại một kho
công khai mồ côi phải vào GitHub xoá tay: PAT còn sống và đủ scope (`repo` + `workflow`, đọc từ
header `x-oauth-scopes`; token fine-grained không khai scope nên nói thẳng là không kiểm hộ
được), sổ chưa đầy, và `WORKER_ID` chưa ai mang — hỏi thẳng bảng `workers` chứ không chỉ tin vào
cái mốc giây.

**Hai lỗi tự bắt được khi đọc lại diff, cả hai đều là loại hỏng-mà-không-ai-thấy:**

- **`process.exit()` làm hỏng chính mã thoát.** Đo được: dưới `tsx` trên Windows, `process.exit(0)`
  sau một lượt `fetch` khiến libuv ném `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` và
  tiến trình trả về **127 thay vì 0** — tức một lượt chạy hoàn hảo vẫn khiến tệp .bat in „Ket thuc
  voi loi". Nay mọi ngả kết thúc đi qua `process.exitCode` rồi để tiến trình tự tắt; đo lại: nhánh
  thành công 0, nhánh hỏng 1, không còn dòng assertion nào. (Cùng bệnh còn ở `mirrorControl.mts`,
  chưa đụng tới.)
- **Bản chụp cấu hình cũ ghi đè việc người khác vừa làm.** `saveAppSettings` ghi TRỌN document,
  mà giữa lượt đọc và lượt ghi là cả phần dựng kho — vài chục giây có `gh` chạy ở giữa. Ghi bằng
  bản đọc lúc đầu là lặng lẽ lộn ngược mọi thứ trưởng môn vừa sửa trong quãng ấy. Nay đọc lại sổ
  ngay trước khi ghi, và kiểm lại cả trần lẫn trùng tên trên bản mới.

**Chưa có bằng chứng, nói thẳng:** máy phát triển không có `gh` nên bốn lời gọi `gh` (tạo kho, dán
secret, bấm chạy) và cả lượt ghi sổ + ngó kho vẫn chưa lượt nào chạy thật. Thứ ĐÃ đo: typecheck
tường minh (tsconfig của repo loại cả thư mục `scripts`), lượt chạy khô đi trọn đường thật —
bảng điều phối, tra ra trạm đang phục vụ qua sổ của trạm vừa nghỉ, đọc sổ, ba phép kiểm, dựng thử
19 tệp — và tệp `.bat` chạy qua `cmd.exe` với cả nhánh lỗi lẫn mã thoát.

## 0.79.2 — lệnh dựng khôi lỗi GitHub phát ra một kho chết ngay giây đầu

`newGithubKhoiloi.mjs` chép **`worker.mjs` + `quest-engine`**, và chỉ ngần ấy — đúng như bình chú
của chính nó khai: „Worker chỉ cần scripts/worker.mjs, toàn bộ src/lib/quest-engine/, và
playwright-core". Câu ấy **đã hết đúng** từ commit「khôi lỗi đi theo trạm」, thứ thêm vào
`worker.mjs` một import thứ ba: `../src/lib/worker/controlFollow.mjs`.

Kho phát ra sẽ chết bằng `ERR_MODULE_NOT_FOUND` ở giây đầu tiên — **trên một máy khác, trong nhật
ký Actions của một tài khoản khác**, sau khi mọi bước ở máy phát hành đều báo xanh. Chưa ai vấp
chỉ vì script này chưa từng chạy thật (máy phát triển không có `gh`).

Vá hai lớp, và lớp thứ hai mới là lớp đáng kể:

**`--dry-run` giờ dựng thật rồi mới dừng.** Bản trước thoát ngay sau khi in kế hoạch, nên nó soi
được đúng mấy con số mà người ta vốn đã tự gõ ra — còn phần duy nhất thật sự có thể sai, danh
sách tệp phải chép, thì không lượt chạy khô nào chạm tới. Giờ nó chép, thay `WORKER_ID` trong
workflow, soi đường import, in cây 19 tệp, rồi dọn sạch. Tức **mọi việc không cần `gh` đều đã có
bằng chứng**; chỉ bốn lời gọi `gh` ở cuối là còn chưa.

**`assertImportsResolve` không đi kèm một cái tên tệp nào.** Nó duyệt cây vừa dựng, rút mọi đường
`import` tương đối (cả `from "…"` lẫn `import("…")`) và ném nếu có cái nào trỏ vào hư không. Vá
bằng cách thêm đúng một dòng chép thì lần sau — khi ai đó thêm import thứ tư — sẽ hỏng y hệt; câu
hỏi phải là câu hỏi tổng quát. Đã thử đột biến: gỡ lượt chép ấy đi thì lượt chạy khô đỏ ngay, kèm
tên tệp thiếu và chỗ phải sửa.

Không đụng mã ứng dụng, nên không cần deploy.

## 0.79.1 — cỗ máy chuyển trạm đã hỏng suốt một tuần mà không ai biết

`assertTablesCovered` ném với BẤT KỲ bảng nào ở đích mà nó không biết tên, và nó được gọi ở dòng
đầu tiên của `truncateAll`, tức bước đầu tiên của một lượt đồng bộ. `notices` và `notice_reads`
ra đời 11/08/2026 và **cố ý** không nằm trong `SYNC_TABLE_ORDER` — nhưng không ai nối hai điều ấy
lại. Đo trên một database đã áp đủ 26 migration ngày 12/08: **13 bảng thật, 11 tên trong sổ.**

Nghĩa là lượt chuyển trạm kế tiếp sẽ chết ngay ở dòng đầu với `đích có thêm: notice_reads,
notices`. Không ai vấp vì lần diễn tập gần nhất là **10/08 — trước khi hai bảng ấy tồn tại**. Nó
chỉ lộ ra hôm nay vì có người đi đếm bảng trên database thật cho một việc khác.

Bài học nằm ở **hình dạng**, không ở hai cái tên: một quyết định「cố ý bỏ qua」sống trong bình chú
thì **cái hàng rào không đọc được nó**. Nay nó là dữ liệu — `UNSYNCED_TABLES` — và hàng rào hỏi
đúng chỗ. Bảng lạ thật vẫn bị chặn y như cũ; nới hàng rào không được biến nó thành cổng mở toang,
và có một ca kiểm chứng đứng canh đúng điều đó.

**Vì sao luật này sai được lâu thế: phép kiểm duy nhất canh nó đòi một database thật.**
`verify:mirror-sync` bắt đầu bằng `if (!process.env.DATABASE_URL) throw`, nên phần lớn thời gian
nó không chạy. Phần QUYẾT ĐỊNH nay tách ra thành hàm thuần `reviewTableCoverage`, và
`npm run verify:mirror-tables` đóng đinh nó mà không cần dựng gì — cùng lẽ với `permissions.ts`.
Ca đầu tiên của script ấy là **đúng cảnh đã hỏng**, viết bằng đúng 13 cái tên đếm được trên
database thật, không phải một cảnh giả định.

Và nói cho hết một hành vi trước nay chỉ ngầm: `truncateAll` chạy `cascade`, nên hai bảng ấy vẫn
bị **xoá sạch** ở đích mỗi lượt chuyển (cả hai đều trỏ về `users`) — chúng chỉ không được chép
lại. Đúng ý muốn của `schema.ts`, nhưng là một hành vi chứ không phải một sự bỏ qua, nên nó phải
có một dòng. Ngày nào có bảng mới trỏ về `users` mà đích CẦN giữ, `cascade` sẽ lặng lẽ nuốt nó.

## 0.79.0 — nuôi kho khôi lỗi GitHub, và câu trả lời cho câu hỏi gác cổng

Tab **Kho GitHub** trong trang Tông Môn, cộng một vòng nuôi chạy mỗi ngày trong `/api/cron`: ngó
trạng thái lịch của từng kho khôi lỗi, và ghi một dòng mốc vào `.github/heartbeat.txt` mỗi ~20
ngày. GitHub tắt lịch `schedule` của kho công khai sau **60 ngày không có commit**, và khi tắt thì
khôi lỗi im lặng ngừng lên ca — không dòng đỏ nào, không ai được báo.

**Câu hỏi mà 0.78.1 dặn phải hỏi TRƯỚC KHI XÂY đã có câu trả lời, và câu trả lời là KHÔNG XÂY
ĐƯỢC lối rẻ.** Nếu commit bằng `GITHUB_TOKEN` của chính workflow được tính là hoạt động kho thì
mỗi kho tự nuôi mình bằng ba dòng YAML và cả tính năng này biến mất. Đi tìm ngày 12/08/2026:

- Tài liệu GitHub nói **đúng một câu** về luật ấy — *"scheduled workflows are automatically
  disabled when no repository activity has occurred in 60 days"* — không định nghĩa「repository
  activity」, không nhắc `GITHUB_TOKEN` chữ nào.
- `gautamkrishnar/keepalive-workflow`, bản cài đặt phổ biến nhất của đúng lối ấy, nay là một
  trang **"disabled by GitHub Staff due to a terms of service violation"**. Chính tác giả từng
  thừa nhận commit tự động có thể vi phạm điều khoản.
- Công cụ còn sống (`gh-workflow-immortality`) thì không commit gì cả — nó gọi API bật lại
  workflow, và ghi rõ `GITHUB_TOKEN` **không đủ quyền**, phải dùng PAT.

Nên hệ thống PAT vẫn được xây, nhưng xây để **để lại ít dấu chân nhất có thể**: **ngó mỗi ngày,
ghi mỗi ~20 ngày**. Hai nhịp ấy tách nhau là toàn bộ giá trị của con số — biết kho hỏng ngay
trong ngày, mà chỉ ~18 commit rác một năm thay vì 365, và vẫn còn 40 ngày dự phòng trước mốc 60.

**Nhánh tự chữa mới là phần đáng tiền.** Lịch đã bị tắt vì im lặng thì một commit mới KHÔNG tự bật
nó lại — GitHub đòi một lượt bật tường minh. Thiếu điều này thì hệ thống nuôi được kho khoẻ nhưng
bó tay trước đúng cái kho đã ngã, tức vô dụng ở ca duy nhất nó thật sự cần thiết.

**Và một điều cố ý KHÔNG làm:** kho bị tắt **tay** thì để nguyên, kể cả khi Gia chủ bấm「Nuôi
ngay」. Đó là quyết định của một con người; bật lại giùm là cãi lại, mà cãi lặng lẽ. Hai ca kiểm
chứng canh luật này **đếm số lượt PUT** chứ không chỉ đọc kết quả — "không ghi gì cả" là một hành
vi, và một hàm trả về đúng chữ trong lúc lén ghi một commit thì vẫn là hỏng.

Sổ nằm trong `app_settings` chứ không phải một bảng riêng như bản phác ghi, và lý do nặng nhất
không phải「đỡ một migration」: `assertTablesCovered` NÉM khi database đích có bảng ngoài
`SYNC_TABLE_ORDER`. Một bảng mới mà quên khai ở đó không hỏng lúc migrate, không hỏng lúc chạy —
nó hỏng **giữa một lượt chuyển trạm**, đúng lúc đang có sự cố. Đổi lại, sổ tự đi theo mọi lượt
chuyển trạm.

Quyền là mã RIÊNG `github_station.manage`, chỉ Gia chủ — không dùng lại `admin.panel`, cũng không
dùng lại `site.switch`. PAT push được mã vào kho đang chạy khôi lỗi; hai sổ cùng bậc nguy hiểm
nhưng cầm hai loại chìa khác nhau, và ngày muốn giao cái này mà không giao cái kia thì phải có sẵn
hai cái tên.

**Vá kèm: `npm run verify:permissions` đã ĐỎ từ 11/08/2026 mà không ai biết.** Bảng oracle trong
script thiếu `notice.broadcast` rồi `site.switch`, nên nó chết bằng một `TypeError` giữa vòng lặp.
Đáng lẽ `Record<Permission, …>` đã chặn ở khâu biên dịch — nhưng `tsconfig.json` **loại cả thư mục
`scripts`**, nên không lượt `tsc` nào ngó tới tệp ấy. Nay có một vòng kiểm tường minh nói ra mã
nào đang thiếu, thay vì một stack trace.

## 0.78.1 — chép lại thiết kế「nuôi kho khôi lỗi」trước khi nó trôi mất

GitHub tắt lịch `schedule` của một kho sau **60 ngày không có hoạt động commit**. Kho khôi lỗi thì
gần như không ai đụng vào — nó chỉ chạy — nên mốc ấy sẽ tới, và khi tới thì khôi lỗi im lặng ngừng
lên ca mà không báo ai.

Tính năng chưa làm. Nhưng bốn điều đã bàn ra được thì chép vào
[deploy/github-actions.md](deploy/github-actions.md) mục 7 ngay, vì hai trong số đó **đổi hẳn hình
dạng thiết kế** và người bắt tay sau sẽ mất công tìm lại:

- **Hỏi TRƯỚC KHI XÂY: commit bằng `GITHUB_TOKEN` có tính là repository activity không?** Nếu có
  thì mỗi kho tự nuôi mình bằng một bước YAML, và cả hệ thống bảng + PAT + tab admin + job biến
  mất. GitHub nói rõ commit ấy không kích hoạt workflow mới, nhưng KHÔNG nói nó có tính là hoạt
  động kho hay không — hai chuyện khác nhau, đừng suy cái này ra cái kia.
- **Không cần `git push`.** `PUT /repos/{owner}/{repo}/contents/{path}` tạo ra một commit thật,
  nên job chạy gọn trong một Vercel function — không binary `git`, không clone. Đây là chỗ dễ đi
  vòng nhất nếu không biết.
- **Không cần lịch mới**: `vercel.json` đã có cron ngày, và Hobby cho đúng một lần mỗi ngày.
- **PAT nguy hiểm hơn cookie game** vì nó push được mã: lưu bằng `secretBox`, và quyền quản phải
  là mã RIÊNG chỉ Gia chủ — được xem môn đồ không đồng nghĩa được cầm chìa push mã vào bốn tài khoản.

Ghi ra vì một thiết kế sống trong khung chat là một thiết kế sắp mất; sống trong repo thì người
sau đọc được.

## 0.78.0 — một lệnh dựng thêm một khôi lỗi GitHub ở tài khoản bất kỳ

`node scripts/newGithubKhoiloi.mjs --owner <tài-khoản>` — từ kho trắng tới lượt chạy đầu tiên.
Mỗi tài khoản GitHub là một quỹ phút Actions riêng, nên thêm một tài khoản là thêm một khôi lỗi
tông môn nữa mà không tốn đồng nào; việc dựng thì lặp đi lặp lại, và「lặp đi lặp lại」là chỗ để
quên — quên `--public` thì mất quỹ phút miễn phí, quên đổi `WORKER_ID` thì hai tiến trình ghi đè
nhau trong bảng `workers`.

**Kho sinh ra KHÔNG phải bản sao của web repo** — chỉ `scripts/worker.mjs`, `src/lib/quest-engine/`,
một `package.json` ghim đúng `playwright-core` đang dùng, và workflow. Giữ NGUYÊN bố cục thư mục
là cố ý: `worker.mjs` import `../src/lib/quest-engine/…`, nên chép nguyên hình dạng thì không
phải viết lại một đường dẫn nào — đúng cái bẫy mà `buildWorkerBundle.mjs` phải chống bằng phép
rewrite.

**Workflow lấy NGUYÊN bản của web repo rồi chỉ thay hai dòng** (id khôi lỗi, địa chỉ web), và
phép thay tự kiểm lại kết quả rồi NÉM nếu không khớp. Chép tay một bản thứ hai là hẹn ngày hai
bản trôi khỏi nhau — mà bộ số 290/50/350/360 thì không được phép lệch.

Dựa vào `gh` thay vì tự gọi API: đặt secret đòi mã hoá sealed-box (X25519 + XSalsa20), thứ Node
không có sẵn, nên làm tay là kéo `libsodium` vào một app web chỉ để phục vụ một script phát hành.
Token đi qua STDIN chứ không qua đối số — đối số nằm trong command line mà ai mở Task Manager
cũng đọc được.

**Hai lỗi do chính lượt chạy khô bắt được**, và cả hai đều thuộc loại hỏng-lặng-lẽ:

- `WEB_URL` đọc từ `.env` ra đúng chuỗi `"[SENSITIVE]"` — biến ấy nằm trong nhóm bị Vercel che.
  Nướng nó vào workflow là phát ra một khôi lỗi gọi về địa chỉ không tồn tại, hỏng ở một kho
  KHÁC, sau khi mọi bước ở đây đều báo xanh. Nay kiểm「có phải URL http(s) thật không」rồi mới
  dùng, kèm `--web-url` cho ca cần địa chỉ khác.
- Phép kiểm `gh` chặn cả `--dry-run`. Lượt chạy khô sinh ra để soi kế hoạch trên một máy chưa
  cài `gh`, trong lúc còn đang cân nhắc — chặn nó là lấy mất đúng công dụng của nó. Nay nó đứng
  sau, lượt chạy thật vẫn hỏng sớm trước khi tạo bất cứ thứ gì.

**Chưa chạy thật lần nào:** máy phát triển không có `gh`, nên mọi bước từ `gh repo create` trở đi
mới chỉ đúng trên giấy. Lượt dựng đầu tiên nên chạy `--dry-run` trước, rồi soi kỹ ba mốc: kho ra
đúng CÔNG KHAI, secret hiện trong Settings, và `WORKER_ID` trong workflow của kho mới KHÁC mọi
khôi lỗi đang chạy.

## 0.77.0 — Hàng Đợi có tab Khôi Lỗi, và id khôi lỗi tông môn chỉ bậc trị sự thấy

Từ hôm có khôi lỗi tông môn **thứ hai** (0.76.0), trang Hàng Đợi thiếu hẳn một câu trả lời: mọi
dòng đều ghi「khôi lỗi tông môn」như nhau, nên không ai biết đàn đang nằm trong tay cái nào —
`tong-mon-khoiloi` trên VM hay `github-khoiloi` trên GitHub Actions. Mà đó đúng là câu đầu tiên
phải hỏi khi một đàn đứng im.

**Nay mỗi dòng khai đích danh — nhưng chỉ với bậc trị sự** (`admin.panel`). Môn đồ thường vẫn
đọc「khôi lỗi tông môn」, **kể cả trên đàn của chính họ**, và chỗ ấy là một siết lại chứ không
phải giữ nguyên: trước bản này dòng của mình luôn kèm id, nên tên tiến trình tông môn vẫn ra tới
màn hình mọi người qua chính đàn của họ. Đó là chi tiết vận hành — máy nào, trạm nào — mà môn đồ
không dùng được vào việc gì, còn tông môn thì hở ra hình dạng hạ tầng của mình. Id khôi lỗi
**RIÊNG** vẫn chỉ chủ nó thấy, bậc trị sự cũng không: máy ở nhà người ta không phải hạ tầng của
tông môn. Hai vế ấy nay nằm gọn trong một hàm thuần (`visibleWorkerId`) thay vì rải trong một
biểu thức giữa vòng `map`.

**Tab KHÔI LỖI** trả lời câu còn lại: còn ai đang trực để nhặt việc. Một hàng dài mười đàn mang
nghĩa hoàn toàn khác nhau tuỳ khôi lỗi đang trực hay đã tắt, mà trước bản này trang chỉ nói được
vế đầu — ai đọc「11 đang nghỉ」lúc cả tông môn đứng im thì không có cách nào biết đó là cooldown
hay là không còn ai làm việc. Môn đồ thường thấy MỘT dòng gộp cho khôi lỗi tông môn cộng khôi lỗi
riêng của chính mình; bậc trị sự thấy TỪNG tiến trình một, kèm số bản. Huy hiệu trên tab hiện kể
cả khi bằng **0**, ngược với hai tab kia: ở đây số 0 chính là tin đáng báo.

**Sổ khôi lỗi đi CHUNG ảnh chụp hàng đợi**, không có endpoint riêng — hai câu hỏi ấy chỉ có nghĩa
khi trả lời cùng một khoảnh khắc, và một danh sách khôi lỗi cũ hơn hàng đợi sẽ vẽ ra cảnh「không
ai trực」ngay cạnh một đàn đang chạy. Mốc điểm danh chỉ đi xuống dây khi khôi lỗi ĐANG VẮNG: khôi
lỗi trực thì gõ cửa mỗi 5 giây, mà ảnh chụp lại đi qua SSE với một phép so nguyên văn để quyết
định có đẩy khung mới hay không — nhét một con số nhấp nháy vào đó là phép so ấy thôi lọc được gì.

**`verify:continuous` đã ĐỎ SẴN từ 08/08/2026** và không ai thấy: nó còn ghim luật cũ「tên nhiệm
vụ của người khác phải bị cắt」trong khi `queue.ts` đã cố ý đổi phía đúng hôm ấy theo yêu cầu của
tông chủ. Chốt được sửa cho nói đúng luật hôm nay — chứ không gỡ đi — rồi thêm 14 chốt cho phép
cắt id: cùng một dữ liệu, hai con mắt, môn đồ không thấy id tông môn (kể cả trên đàn của mình),
bậc trị sự không thấy id khôi lỗi riêng của người khác, và sổ khôi lỗi không bao giờ mang máy nhà
của người thứ ba.

**Mục 0.72.0 dời xuống đúng chỗ** trong tệp này: nó nằm trên 0.76.x suốt từ hôm hai phiên cùng
sửa CHANGELOG một lúc, mà luật của tệp là mới nhất ở trên.

## 0.76.2 — tài liệu cho khôi lỗi thứ hai, viết cho người đọc sau

[deploy/github-actions.md](deploy/github-actions.md) — tệp mới, đứng cạnh `deploy/oracle/README.md`
như hai tài liệu ngang hàng cho hai khôi lỗi ngang hàng. Kèm một dòng trong sơ đồ kiến trúc ở
[README.md](README.md), vì trước lượt này nó vẫn kể rằng chỉ có MỘT khôi lỗi tông môn.

Ba điều tệp ấy tồn tại để nói, và cả ba đều là thứ người đọc sau dễ làm ngược:

- **Đừng dựng tầng phân công.** Nó đã có sẵn ở chỗ không ai nghĩ tới: câu UPDATE nguyên tử của
  `claimNextJob` cộng index `jobs_one_active_per_account`. Viết thêm một bảng chia việc là dựng
  một luật thứ hai sống lệch luật thật.
- **Đừng thêm lựa chọn theo tên máy.** `workerPrefFilter` lọc theo `scope.kind`, không theo
  `worker_id` — nên thêm khôi lỗi thứ ba không phải sửa dòng luật nào. Hàng rào viết theo TÊN
  thì mỗi lần thêm máy là một dịp để quên.
- **Đừng vặn lẻ một con số.** 290 + 50 < 350 < 360, và lịch phải DÀY hơn tuổi thọ. Hạ hạn chờ
  thu xuống dưới ~40 phút là tự tay cắt ngang ván Mê Cung 35 phút — đúng cái việc mà cơ chế rút
  lui sinh ra để tránh.

Mục 5 ghi thẳng hai đoạn mã **chưa từng chạy trên Linux**: đường SIGTERM (không kiểm được dưới
Windows vì Node ở đó không hỗ trợ tín hiệu ấy) và nhánh "còn đàn dở khi hết hạn thu". Mục 6 ghi
ba rủi ro đã được cân nhắc và chấp nhận, để người sau biết đó là quyết định chứ không phải sơ suất.

## 0.76.1 — người dùng vẫn chỉ chọn HẠNG khôi lỗi, không chọn máy

Đổi tên khôi lỗi GitHub thành `github-khoiloi` cho khớp lệ đặt tên của VM (`tong-mon-khoiloi`).

Và ghi lại một điều đáng ghi vì nó ĐÃ đúng sẵn chứ không phải vừa được làm: người dùng **không
bao giờ chọn một cái máy**. Ô「Giao đàn cho」chỉ có ba lựa chọn theo HẠNG — tông môn / máy nhà /
ai rảnh cũng được — và `workerPrefFilter` lọc theo `scope.kind` (`operator` hay `user`), không
theo `worker_id`. Bất kỳ tiến trình nào xác thực bằng `WORKER_TOKEN` toàn cục đều là `operator`,
nên `tong-mon-khoiloi` và `github-khoiloi` đứng ngang nhau dưới mắt câu claim.

Nhờ vậy việc「phân phối」không cần một tầng nào cả: chọn tông môn thì cả hai cùng đủ tư cách, và
Postgres quyết ai cầm bằng chính câu UPDATE nguyên tử — máy nào rảnh trước thì nhặt trước. Thêm
một khôi lỗi tông môn thứ ba ngày mai cũng không phải sửa dòng nào.

Đây là lý do một hàng rào viết theo HẠNG thắng một hàng rào viết theo TÊN: cái sau sẽ bắt ta sửa
luật mỗi lần thêm máy, và mỗi lần sửa là một dịp để quên.

## 0.76.0 — khôi lỗi tông môn thứ hai, chạy trên GitHub Actions

Một khôi lỗi tông môn nữa, trên runner của GitHub, chạy song song với khôi lỗi trên VM.

**Không có cơ chế điều phối nào giữa hai bên, và đó là chủ ý.** Postgres đã phân xử sẵn:
`claimNextJob` là MỘT câu UPDATE nguyên tử nên hai khôi lỗi giành nhau thì nhận hai dòng khác
nhau hoặc một dòng và một null; cộng index `jobs_one_active_per_account` thì hai đàn cùng một
tài khoản là bất khả thi về cấu trúc. Dựng thêm một tầng chia việc ở đây chỉ là đẻ ra một luật
thứ hai sống lệch luật thật.

**Thứ THẬT SỰ đẻ ra lỗi nằm chỗ khác:** `worker.mjs` chạy `for(;;)` vô tận, không có đường
thoát êm — mà runner bị giết cứng ở mốc 6 giờ. Bị giết giữa một ván Mê Cung 35 phút thì nhịp
tim tắt và `reapStaleJobs` kết liễu đàn ấy thành `failed` sau 3 phút: mất trọn một vòng của một
đạo hữu, đều đặn mỗi 6 tiếng. Nên toàn bộ tính năng quy về một pha rút lui.

`WORKER_MAX_LIFETIME_MS` — quá hạn thì THÔI NHẬN VIỆC MỚI, không chết ngay. `WORKER_DRAIN_TIMEOUT_MS`
— chờ tối đa bấy nhiêu cho đàn đang dở đi nốt vòng. Cả hai **mặc định 0 = vô hạn**, nên khôi lỗi
trên VM và trên máy nhà giữ nguyên hành vi cũ từng byte; chỉ nơi có đồng hồ treo trên đầu mới đặt.

Ba con số của workflow, mỗi con số một lý do:

| | |
|---|---|
| thôi nhận việc ở phút **290**, chờ thu tối đa **50** | 340 < 350 (timeout job) < 360 (trần nền tảng) — hai lớp đệm, mỗi lớp 10 phút |
| lịch **4 giờ/lần** trong khi một lượt sống ~4,8 giờ | lượt kế đã nằm chờ sẵn lúc lượt cũ thu đàn, nên khoảng hở gần bằng 0; `concurrency` giữ đúng một chạy + một chờ |
| **2 ghế** trên runner 4 nhân | đo 10/08 trên VM 4 vCPU: 8 ghế → load 14 và đàn hỏng vì timeout; runner còn ít RAM hơn và chia sẻ I/O |

`WORKER_ID=github-khoiloi`, khác VM (`tong-mon-khoiloi`) — trùng tên thì hai tiến trình ghi đè
nhau trong bảng `workers` và mục Khôi Lỗi nói dối về việc ai đang trực.

Hết hạn chờ mà còn đàn dở thì thoát với mã **khác 0**: chuyện ấy nghĩa là có người sắp mất một
vòng, và nó đáng hiện đỏ chứ không đáng lặng lẽ trôi qua.

**Đã biết và chấp nhận:** secret nằm trong Secrets của một repo CÔNG KHAI, và nhật ký Actions
của repo công khai thì ai cũng đọc được, vĩnh viễn — trong khi việc của khôi lỗi là nhận cookie
game đã giải mã. Tông chủ đã cân nhắc và chốt.

## 0.75.0 — bỏ chạy song song: một vòng đi đúng thứ tự hồ sơ, Mê Cung luôn cuối cùng

**Mê Cung luôn là nhiệm vụ CUỐI CÙNG, Luyện Đan Đường áp chót.** Đó là yêu cầu, và bỏ chế độ song
song chính là thứ thực hiện nó: chạy từng nhiệm vụ một thì thứ tự đúng bằng `order` trong hồ sơ —
`… 95 Hỷ Sự Đường → 100 Khoáng Mạch → 105 Luyện Đan Đường → 110 Mê Cung`. Không thêm cơ chế nào,
không thêm "pha đuôi" phải giữ đồng bộ: thứ tự ấy là hệ quả trực tiếp của dữ liệu vốn đã đúng.

**Vì sao phải BỎ chứ không phải xếp lại thứ tự khởi chạy.** Khi mọi nhiệm vụ được phóng cùng lúc,
thứ tự hành sự thật là thứ tự **giành được cổng điều phối**, không phải thứ tự trong hồ sơ. Mê Cung
có thể giữ cổng ấy tới 35 phút trong lúc chờ đủ phòng 5 người — đó chính là cách những nhiệm vụ một
phút bị bỏ đói. Xếp lại thứ tự phóng không cứu được, vì cổng là toàn cục và các đàn khác cũng xếp
hàng trong đó.

Gỡ: nhánh song song trong `runCycle.mjs`, hai trợ thủ đã thành mã chết (`questTabLimit` với biến
môi trường `WORKER_QUEST_TABS`, và `mapWithLimit` cùng 4 phép kiểm của nó), ô tick「Chạy song song
các nhiệm vụ」trên Ngọc Giản, và dòng đọc form. Trường `parallelQuests` **giữ lại trong schema**
theo đúng lệ của `runner` — Zod strip là mất round-trip của document cũ — nhưng không còn ai đọc.

**Cổng điều phối toàn cục VẪN còn và vẫn cần**: tuần tự trong một đàn không có nghĩa là một mình
trên máy — VM chạy nhiều đàn cùng lúc, nên hai nhiệm vụ trang riêng của HAI đàn khác nhau vẫn có
thể dẫm chân nhau trên cùng hai nhân. Đó đúng là sự cố mà cổng ấy sinh ra để chặn.

Sáu chốt smoke mới ghim thứ tự cho **cả hai hạng đàn** (VIP và thường) — và chúng đã bắt được một
cái sai thật ngay lần chạy đầu: bật hết mọi nhiệm vụ rồi xếp chung sẽ ra danh sách nhân đôi, vì mỗi
nhiệm vụ có cặp sinh đôi VIP/thường; phải lọc theo hạng như đời thật mới đúng. Bản desktop nhận cùng
thay đổi ở 1.56.0. Tổng 310 thuận.

## 0.74.0 — Hỷ Sự Đường cho chọn vào tiệc cưới nào, và nói ra nó thấy gì

**Tuỳ chọn mới「Vào tiệc cưới nào」**: *Chưa chúc* (mặc định, đúng hành vi cũ) / *Đã chúc* / *Tất
cả* — ghi chú 6 của bản ghi 11/08/2026 (`custom-20260811-233113`).

**Điều kiện dừng phải đổi theo, và đây mới là chỗ suýt hỏng.** Vòng lặp cũ dừng khi
`Hidden .not-blessed` — đúng khi chỉ vào phòng chưa chúc, vì chính lời chúc rút cạn điều kiện.
Nhưng chọn *Đã chúc* thì chúc xong lại **làm TĂNG** số `.blessed`, nên `until` không bao giờ đạt
và vòng lặp quay lại đúng những phòng cũ suốt 15 vòng / 30 phút. Nay quest giữ **sổ phòng đã ghé
của một lượt** (trong `sessionStorage` — thứ sống qua cú điều hướng mà flow này làm liên tục) và
dừng khi không còn phòng nào khớp bộ lọc mà chưa ghé. Phòng được ghi vào sổ **trước** khi điều
hướng, nên một phòng hỏng giữa chừng cũng không bị chọn lại — vòng lặp luôn tiến.

**Phòng đã chúc không phải "phòng chưa chúc thiếu mất cái nút".** Đo trên bản ghi: site bỏ HẲN
form — không `#blessing-default-options`, không `.blessing-form` — và thay bằng `.blessing-message`
("Đạo hữu đã gửi lời chúc phúc cho cặp đôi này!"). Flow cũ chờ form 25 giây rồi hỏng, tức *Đã chúc*
sẽ hỏng ở **mọi** phòng. Nay bước vào phòng chờ **một trong hai** hình dạng, và chỉ cắm cờ
`body.jvz-can-bless` khi form có thật; bốn bước gửi lời chúc gác theo cờ ấy. Bước「nút gửi đã biến
mất」cố ý **không** gác — nó vẫn phải canh cú gửi trượt ở phòng chưa chúc, nơi một lần trượt là mất
30 Tiên Ngọc.

**Và nó nói ra nó thấy gì.** Mỗi lần mở modal đều kể: tổng số tiệc, bao nhiêu đã chúc, bao nhiêu
khớp bộ lọc, còn bao nhiêu chưa ghé — thay cho một câu「đã chúc phúc hết」không kèm con số nào.

**KHÔNG lọc theo lì xì.** Ghi chú 6 của bản ghi đòi bỏ qua tiệc đã phát lì xì; chỉ đạo ngày 12/08
thì ngược lại — cứ vào. Ghi ra đây để người đọc sau không tưởng là sót.

**Fixture của chính bộ smoke này đã SAI và được sửa**: phòng đã chúc của nó vẫn dựng cả form, nên
nó không bao giờ bắt được cái hỏng ở trên — đúng bài học「phép kiểm phải mang hình dạng nhà cung
cấp thực sự phát ra」đã trả giá ở Mê Cung. Bốn chốt mới lái trọn nhánh *Đã chúc* qua engine thật:
vào đủ ba phòng, không gửi thêm lời chúc nào, và vòng lặp DỪNG chứ không quay lại phòng cũ.

Hồ sơ lên **schema 54** ở cả hai bên; bốn đoạn script khớp từng byte giữa hai bản sinh đôi và chốt
chống-trôi nay canh cả chúng (7 cặp). Bản desktop nhận cùng thay đổi ở 1.55.0. Tổng 310 thuận.

## 0.72.0 — hạn lưu nhật ký đàn đặt được theo GIỜ, không chỉ theo ngày

Núm ở tab Bảo Trì trước nay chỉ nhận NGÀY (1–365), mà đơn vị nhỏ nhất là một ngày thì không đặt
được những mốc ngắn — 12 giờ, 6 giờ — đúng lúc `job_events` phình nhanh. Nay ô số đứng cạnh một
ô chọn đơn vị: **giờ** hay **ngày**.

**Lưu xuống database bằng GIỜ** (`jobEvents.retentionHours`, 1–8760 — đúng 365 ngày cũ kể lại
bằng giờ), không lưu kèm một trường đơn vị. Lưu kèm đơn vị nghĩa là mọi chỗ đọc hạn lưu (lượt
quét, hai con số thống kê, câu thông báo sau khi Lưu) phải tự nhớ nhân lại — và chỗ nào quên là
xoá sớm gấp 24 lần, thứ không ai thấy cho tới lúc đi tìm một dòng nhật ký không còn ở đó nữa.
Đơn vị chỉ sống trong cái form.

**Document cũ vẫn đọc được.** Mọi document đã ghi trước bản này mang `retentionDays`, và schema
đổi nó thành giờ (×24) thay vì rơi về mặc định — đo trên database thật: `{"retentionDays":7}`
đọc ra đúng 168 giờ. Bỏ nhánh ấy đi thì hạn lưu trưởng môn đã đặt biến mất lặng lẽ ngay nhịp
deploy. Lần Lưu đầu tiên ghi ra `retentionHours` và khoá cũ tự rụng.

**Ô số KHÔNG tự đổi giá trị khi đổi đơn vị** — đổi hộ là quyết định hộ, mà「7」có thể là 7 ngày
đang gõ dở lẫn 7 giờ vừa định. Thay vào đó là một dòng「Sẽ giữ: …」chạy theo bàn phím, gọi ĐÚNG
hàm mà server sẽ kiểm, nên nó không bao giờ hứa một thứ mà cú bấm Lưu lại từ chối.

**Đơn vị vắng mặt thì TỪ CHỐI, không đoán.** Ca thật: một tab admin mở từ bản cũ, form chưa có ô
đơn vị. Đoán「giờ」cho một con số người ta định là「ngày」là cắt hạn lưu xuống 1/24 và lượt quét
kế tiếp xoá thật — một cái nút Lưu không được phép có nhánh im lặng nào dẫn tới đó.

**Đặt dưới một ngày thì form nói thẳng cái giới hạn của nó:** cron gói Hobby chạy `0 3 * * *` —
**một lần mỗi ngày**. Hạn lưu 6 giờ không có nghĩa là quét mỗi 6 giờ; muốn dọn đúng mốc thì bấm
「Quét ngay」. Không có dòng ấy thì núm mới trông như hỏng, đúng cái bẫy mà nút「Quét ngay」đã
sinh ra để gỡ ở bản trước.

**Đo trên database thật trước khi phát hành**: đặt 25 giờ (cố ý không tròn ngày, và cắt đôi đống
dữ liệu) → app đếm 10.183/12.889 dòng quá hạn, một câu SQL độc lập `now() - interval '25 hours'`
đếm đúng 10.183, lệch 0. Cùng con số ấy nếu bị hiểu thành 25 NGÀY thì ra 0 dòng — nên phép đo này
đỏ được, không phải một dấu tích cho vui. `verify:maintenance` nay giữ thêm: hai biên theo từng
đơn vị, đơn vị lạ/vắng, document cũ theo ngày, ca có cả hai khoá, và vòng đời「lưu → chẻ ra rót
vào form → bấm Lưu mà không sửa gì」phải về đúng con số cũ (mở trang admin rồi bấm Lưu không được
tự đổi hạn lưu của chính mình).

## 0.71.0 — bản desktop nhận cùng thiết kế, và có chốt giữ hai bản không trôi khỏi nhau

Bản 0.70.0 đổi cách Mê Cung hỏi trần ngày ở phía web. Bản này chở nguyên thiết kế ấy sang desktop
(`1.54.0`) — bên đó trước nay vẫn so chuỗi `"385/385"` ở **hai** chỗ, sai với mọi tài khoản có
trần khác, và chưa từng nhận cả bản vá 0.69.0.

**Hồ sơ lên schema 53** ở cả hai bên. Bên desktop, bump schema là thay hồ sơ đã lưu ngay lần mở
đầu tiên — phải bật lại nhiệm vụ và chọn lại tuỳ chọn. Bên này schema chỉ là con số, nhưng hai bản
sinh đôi phải mang cùng một số, và nay có chốt bắt đúng điều đó.

**Chín chốt smoke mới đọc THẲNG `DefaultQuestProfile.cs` của repo desktop** (qua đường dẫn anh em)
và so **từng byte** ba đoạn script Mê Cung, cộng số schema, cộng selector cờ đầy trần, cộng việc
bên ấy không còn `Text = "{{capCheck}}"` nào. Ba đoạn script ấy sống ở hai nơi và là JavaScript
nằm trong chuỗi: **không trình biên dịch nào bắt được lúc chúng lệch nhau** — chỉ có một đàn chạy
sai vào một ngày nào đó. Chốt bỏ qua (không đỏ) khi không thấy repo desktop nằm cạnh, vì bộ smoke
này còn chạy ở nơi chỉ có repo web.

Cả chín chốt đã được chạy ngược lên `DefaultQuestProfile.cs` ở `HEAD` để chắc chúng **đỏ được**:
9 bắt, 0 chốt vô dụng.

## 0.70.0 — Mê Cung hỏi MÁY CHỦ còn bao nhiêu huyền tinh, thay vì nạo chữ khỏi trang

Bản ghi 11/08/2026 (`me-cung-20260811-171336`) bắt trọn một lượt đánh, và cái rương cuối lượt
nói ra tất cả. `POST /wp-json/me-cung/v1/claim-boss5-chest` trả về:

```json
"huyen_tinh": 0, "huyen_tinh_daily_total": 385,
"huyen_tinh_daily_cap": 385, "already_got_items": true
```

Sáu ô vật phẩm — tu vi, tinh thạch, tiên ngọc, xu khoá, huyền tinh, chủ dược — **rơi số 0 cả
sáu**. Hai phút đánh không được gì, vì trần ngày đã đầy từ trước. Đó chính là cái mà người dùng
nhìn thấy dưới dạng「đánh xong một lượt là kẹt」: đàn cứ mở hiệp mới để lĩnh những cái rương rỗng
cho tới khi hết trần 6 hiệp / 35 phút.

**Nay trần ngày đọc từ phản hồi ấy.** Một bước mới ở đầu thân vòng gắn tai nghe vào `fetch` cho
đúng một địa chỉ (`claim-boss5-chest`), clone thân phản hồi rồi cất `total`/`cap`/`gain`/
`already_got_items` vào `sessionStorage`. Bước cuối thân vòng đọc lại, kể ra bằng số của máy
chủ —「Xong lượt đánh — huyền tinh hôm nay 385/385 (rương rỗng — hôm nay đã lấy hết vật phẩm) —
ĐÃ ĐẦY TRẦN, dừng ở đây」— rồi cắm cờ cho `until`.

**Vì sao `sessionStorage` chứ không phải `window`:** xong một lượt thì **trang tự nạp lại**. Bản
ghi có đúng hai `pageview`, cái thứ hai lúc `10:23:50`, ngay sau khi rương được lĩnh. Cú nạp ấy
xoá sạch `window` — và đó là lý do hai lỗi cũ tồn tại mà không ai thấy: bản tin cuối lượt (đọc
`window.__jvz`) **chưa chạy lần nào** trong 5 hiệp của một đàn thật, còn cờ `__jvzChatFightSent`
lẽ ra chặn câu chat sau hiệp đầu thì **gửi lại đủ 5 lần**. `sessionStorage` cùng gốc sống qua
nạp lại; cả hai lỗi tắt theo.

**Vì sao dám vá `fetch` ở đây** trong khi recorder vừa bỏ hẳn lối ấy: recorder có đường tốt hơn
(bắt ở tầng driver), một bước quest thì chỉ nói được tiếng DOM. Phạm vi cũng hẹp hơn hẳn — đúng
một địa chỉ, chỉ đọc, thân được `clone()` nên không ai bị mất body, và mọi nhánh đều trả lại
đúng promise gốc. Site dùng `fetch` cho toàn bộ API (đã kiểm: 9 chỗ `fetch(`, 0 chỗ
`XMLHttpRequest`).

**Ở sảnh vẫn kiểm như cũ** — và đó là chỗ quyết định có mở phòng hay không, nên nó phải đứng
riêng: trang vừa nạp thì con số trên ô chữ là của máy chủ. Bước ấy nay còn xoá số rương của lượt
ghé trước, vì `sessionStorage` sống lâu hơn một lượt ghé và một con số cũ sẽ làm hiệp đầu dừng
oan.

**Đường lui còn nguyên:** hiệp nào không lĩnh được rương (đội thua ải, tắt tự động mở rương) thì
mất bản tin nhưng KHÔNG mất cổng chặn — bước ấy lui về đọc ô chữ trên trang như trước.

19 chốt smoke mới, và chúng **chạy thật ba đoạn script ấy** bằng `new Function` trên một DOM giả
— kể cả tai nghe, với một `fetch` giả, để chắc nó bắt đúng số, không nuốt lời gọi khác, và gắn
hai lần là no-op. Đây là loại mã không trình biên dịch nào nhìn thấy: nó nằm trong JSON.

## 0.69.0 — Mê Cung phải RA KHỎI phòng cũ trước, không chỉ bấm giải tán rồi đi tiếp

Bước「chờ sảnh mê cung render」của Mê Cung là `waitForSelector #lobby-overview`, và nó **chưa
bao giờ chặn được gì**. Bản ghi 11/08/2026 (`me-cung-bonus-20260811-153934`) chụp DOM ở hai
thời điểm — lúc đang trong phòng và lúc đã về sảnh — và cả hai đều có đủ `#lobby-overview`,
`#btn-disband-room`, `#btn-start`, `#btn-leave-room`. Trang **không đổi DOM khi vào phòng**, nó
bật/tắt class `hidden` (`.hidden{display:none!important}`, lấy từ chính CSS trong bản ghi).

Nên `waitForSelector` qua ngay lập tức trong mọi hoàn cảnh, kể cả khi lượt chạy còn kẹt trong
phòng của lượt trước; và lời chú thích của chính bước ấy —「tới đây chắc chắn đang ở sảnh, không
ở trong phòng」— là một lời hứa suông. Lượt chạy đi thẳng xuống bấm「Lập Đội」trên một cái nút
đang bị khung phòng che.

Nay cổng ấy hỏi **hiển thị** (`waitForCondition` / `visible`), và **không optional**: không ra
nổi khỏi phòng thì lượt ấy hỏng ồn ào, thay vì lặng lẽ đi tạo phòng chồng lên phòng cũ.

**Site có HAI lối ra khỏi phòng, không phải một.**「Giải Tán」(`#btn-disband-room`) cho chủ
phòng và「Rời Phòng」(`#btn-leave-room`) cho thành viên — bản ghi có đủ cả hai trong DOM, cái
không dùng tới thì mang `hidden`. Trước bản này chỉ có lối giải tán, nên một tài khoản lỡ vào
phòng người khác sẽ kẹt lại **vĩnh viễn**: lượt nào cũng dò không thấy nút giải tán, rồi vẫn đi
tiếp và hỏng ở chỗ khác. Nay lượt dò soi cả hai, và mỗi cú bấm gác theo hiển thị của đúng nút
mình nên bấm nên hai lối không dẫm nhau.

**Còn một khe hẹp chưa bịt được, nói thẳng ra đây:** trang vẽ SẢNH TRƯỚC rồi mới hỏi
`/wp-json/me-cung/v1/user-status` và lật sang khung phòng. Trong khoảnh khắc đầu tiên,「đang ở
sảnh」là một câu trả lời sai. Lượt dò 8 giây ở đầu chính là cửa sổ chờ site trả lời; site chậm
hơn ngần ấy thì cổng vẫn qua nhầm. Bịt hẳn thì cần một dấu hiệu「user-status đã về」trên DOM, mà
bản ghi không cho thấy cái nào.

**Hồ sơ lên schema 52** (bản desktop sẽ thay hồ sơ đã lưu ngay lần mở đầu tiên — phải bật lại
nhiệm vụ và chọn lại tuỳ chọn). 14 chốt smoke mới, 7 cho mỗi bản sinh đôi VIP/thường; cả 15 chốt
(kèm chốt schema) đã được chạy ngược lên hồ sơ ở `HEAD` để chắc chúng **đỏ được** — không có
phép kiểm chết. Bản desktop nhận cùng thay đổi ở 1.52.0.

## 0.68.0 — nhiệm vụ ngày đã đủ lượt thì thôi mở lại

Chín nhiệm vụ ngày (Điểm Danh, Phúc Lợi Đường, Hoang Vực, Thí Luyện, Tế Lễ, Phúc Lợi VIP, Vòng
Quay, Vấn Đáp, Bí Cảnh) trước bản này được mở lại **mỗi vòng, cả ngày**, kể cả khi lượt đã hết
từ sáng. Mỗi lượt mở là một trang nặng dựng trên một VM hai nhân, và bảy vòng sau đó chỉ để đọc
lại đúng một câu trả lời đã biết.

Nay mỗi đàn giữ một **sổ đủ lượt hôm nay**. Vòng nào thấy một nhiệm vụ tự báo hết lượt thì ghi
tên nó vào sổ; các vòng sau không mở trang ấy nữa. Cả kế hoạch đã đủ lượt thì vòng ấy **không
mở trình duyệt** và ngủ tới sau mốc sang ngày — thay vì ghé lại mỗi năm phút để đẻ thêm 288
dòng nhật ký mỗi ngày cho một tài khoản đã xong việc.

Bốn quyết định đáng ghi, mỗi cái vá một cách hỏng khác nhau:

- **Sổ nằm trên JOB, không trên tài khoản.** Nhờ vậy luật「Khai Đàn lại thì kiểm lại từ vòng 1」
  được thoả mà không cần một dòng mã nào: một lần Khai Đàn là một dòng job mới với sổ trắng. Nó
  cũng chính là đường thoát hiểm — ghi nhầm thì Thu Đàn rồi Khai Đàn lại là xoá sạch, không cần
  ai vào database.
- **NGUỒN của lượt dừng mới là thứ được nhớ, không phải kết cục.** `alreadyDone` là một kết cục
  hai nghĩa: Hoang Vực dừng vì hết 5 lượt, còn Vấn Đáp cũng dừng y hệt khi *khôi lỗi chưa biết
  đáp án*. Cái thứ hai là giới hạn của ta chứ không phải của tài khoản, và nhớ nó thành「đã đủ
  lượt」là khoá cứng nhiệm vụ cả ngày đúng vào lúc kho đáp án có thể vừa học thêm được câu ấy.
  Nên engine đánh dấu ngay tại bước `stopIf` — chỗ duy nhất TRANG GAME tự phán — thay vì để nơi
  trên dò chữ trong thông điệp mà đoán.
- **Phạm vi khai rõ, không suy đoán.** `dailyQuota.mjs` liệt kê từng ID. Mê Cung và Luyện Đan
  Đường đứng ngoài dù chúng cũng ra `alreadyDone`: ở đó kết cục ấy có thể chỉ là một trạng thái
  thoáng qua của cái lò, và nhớ nhầm là tắt mất nhiệm vụ đáng giá nhất trong ngày, trong im
  lặng. `npm run smoke` đối chiếu danh sách với hồ sơ thật cả hai chiều, nên một cú đổi ID bên
  hồ sơ là một phép thử đỏ chứ không phải một tính năng tự tắt.
- **Ngày là ngày theo GIỜ VIỆT NAM, và lời khai mang theo ngày của nó.** Server phát ngày lúc
  claim, khôi lỗi trả lại nguyên văn lúc complete. Một vòng bắt đầu 23h50 và kết thúc 00h30 đã
  quan sát trạng thái của hôm qua; nhận nó vào sổ hôm nay là bỏ trắng chín nhiệm vụ suốt một
  ngày. Lời khai quá hạn bị từ chối — thà kiểm thừa một vòng còn hơn nghỉ nhầm một ngày.

Nhánh tắt-máy-sớm chỉ chạy khi **hạng tài khoản đã được chứng minh**: hạng quyết định kế hoạch
(VIP và thường là hai bộ flow loại trừ nhau), nên đoán hạng ở đó là có ngày bỏ trắng cả một
ngày chạy vì một phỏng đoán. Chưa dò được hạng thì cứ mở trình duyệt như thường, và phép lọc
thật nằm sau cổng hub — chỗ hạng đã chắc.

Tương thích hai chiều với khôi lỗi đã cài ngoài kia: bản cũ không gửi lời khai nên sổ đứng yên
và mọi thứ chạy y như trước; bản mới gặp một trạm chưa deploy thì không nhận được sổ nên cũng
chạy y như trước. Không ai phải cài lại cái gì.

18 phép mới trong `npm run smoke` canh nửa engine; `npm run verify:daily-quota` canh nửa còn
lại trên database thật — câu SQL hợp nhất là SQL thô, nên `tsc` không soát hộ được một tên cột
hay một phép ép kiểu nào trong đó.

## 0.67.0 — một cú bấm, mọi trạm cùng một commit

`deploy-all-stations.bat` ở gốc repo: bấm đúp là mọi trạm trong sổ gương nhận cùng một commit.
Trước bản này việc ấy làm bằng tay, hai lượt gần giống nhau, và「gần giống」là chỗ để quên.

**Hai trạm lệch mã là cái bẫy nằm im.** Trạm gương chỉ chuyển hướng nên không ai thấy nó cũ —
cho tới đúng ngày nó lên ngôi và trở thành nơi phát lệnh cho lượt sau. Mã cũ ở đó, ngày ấy, là
mã cũ của cả tông môn.

Chỗ khó không nằm ở việc gọi `vercel` hai lần mà ở **một lỗ hổng dữ liệu**: sổ gương không lưu
gì về Vercel — mỗi trạm chỉ có `id`, `name`, `url` và hai chuỗi kết nối đã mã hoá. Không
`projectId`, không `orgId`, không token. Nên phần thiếu được SUY RA thay vì thêm vào sổ: `url`
của trạm là `https://<project>.vercel.app` theo đúng lệ đặt tên §9, nên nhãn đầu của hostname
chính là tên project; còn tài khoản nào cầm nó thì hỏi Vercel — token nào nhìn thấy, token ấy là
chủ. Thêm hai trường vào sổ nghĩa là thêm một migration, một ô nhập, và hai thứ nữa phải giữ cho
khớp thực tế; cái tên thì đã là một sự thật duy nhất rồi.

Thêm một tài khoản = thêm một biến `VERCEL_TOKEN_<TÊN>` trong `.env.local`. Không sửa mã.

Ba chỗ từ chối thay vì đoán, vì đoán sai ở đây nghĩa là mã của tông môn hạ cánh xuống project của
người khác: URL không phải `*.vercel.app` (custom domain — §11, chưa tới), project trùng tên ở hai
tài khoản, và cùng một token khai ở hai biến (nếu không khử trùng thì MỌI project hiện hai lần và
MỌI trạm bị kết luận là nhập nhằng). `verify:deploy-targets` giữ cả ba, 23 phép.

Bốn quyết định vận hành đáng ghi:

- **Một tệp tar cho mọi trạm** — đóng gói một lần rồi giải nén cho từng trạm, nên「đồng bộ」đúng
  theo cấu trúc chứ không nhờ hai lượt `git archive` tình cờ giống nhau.
- **Hỏng một trạm KHÔNG chặn các trạm còn lại**, nhưng bảng tổng kết gọi tên trạm đang lệch mã và
  mã thoát khác 0. Một gương trạm cấu hình sai không được giữ bản vá lại khỏi trạm đang phục vụ.
- **Cây làm việc bẩn thì cảnh báo, không chặn** — cây này có nhiều phiên dùng chung nên tệp bẩn
  của người khác không được quyền giữ một bản vá lại. Đổi lại phải kêu to: thứ lên trạm là HEAD.
- **Token đi bằng biến môi trường, không phải `--token`** — nó không nằm trong command line để ai
  mở Task Manager cũng đọc được, và không phải đi qua phép nối chuỗi của `shell: true`.

`shell: true` chỉ bật cho đúng lệnh cần nó (`vercel` là tệp `.cmd` trên Windows): Node nối chuỗi
đối số thay vì escape, nên một đường dẫn có khoảng trắng sẽ vỡ làm đôi.

## 0.66.0 — hạn lưu nhật ký đàn lên trang Tông Môn

Van xả `job_events` (0.65.0) chỉ sửa được bằng cách sửa mã và deploy. Nay nó là một núm trong
tab **Bảo Trì** — cùng chỗ với những thứ trưởng môn chạm vào khi hệ thống cần dọn dẹp, và hiện
cho mọi admin chứ không riêng Gia chủ như tab Gương Trạm.

**Núm này KỂ SỐ, không để người ta gõ mù.** Nó hiện nhật ký đang có bao nhiêu dòng và bao nhiêu
dòng đã quá hạn theo mốc đang lưu. Lý do: `job_events` là bảng lớn nhất trong một lượt chuyển
trạm, nên con số gõ ở đây quyết định một lượt bế quan dài bao lâu — gõ vào chỗ trống thì không
ai biết mình vừa quyết định điều gì.

**Nút「Quét ngay」** đứng cạnh vì thiếu nó cái núm trông như hỏng: hạ 30 ngày xuống 7 rồi mà bảng
vẫn y nguyên tới nhịp cron kế — gói Hobby chỉ chạy MỘT LẦN MỘT NGÀY. Nút dùng mốc ĐANG LƯU chứ
không phải con số đang gõ dở, và dòng chữ dưới nút nói đúng như vậy.

Hai điều học được khi làm, đáng ghi hơn cả cái núm:

- **Hằng số biên phải ra khỏi `services/settings.ts`.** Form là `"use client"`, mà settings.ts
  import `db`/drizzle và dựng schema Zod ở cấp module — nhập một hằng số từ đó là gánh cả client
  database sang bundle trình duyệt. `tsc` không hé một lời. Nay biên hạn lưu sống ở
  `validation/retention.ts`, tệp KHÔNG import gì cả, đúng khuôn `validation/tags.ts` đã dựng sẵn
  cho bài học này.
- **Hai nút, MỘT action, phân nhánh bằng `intent`.** Bản đầu cho nút quét một action riêng và
  một `useState` riêng, thế là một khung chữ có hai nguồn và phải đoán cái nào mới hơn — mà phép
  đoán ấy lại dựa vào thứ tự `onSubmit` chạy trước form action, một chi tiết nội bộ của React
  không đáng để một dòng thông báo phụ thuộc vào.

Biên của parser và biên của schema Zod nay cùng đọc một hằng số, và `verify:maintenance` có phép
kiểm giữ đúng điều đó — lệch nhau nghĩa là có giá trị qua được action rồi chết ở `saveAppSettings`,
nơi dùng `parse()` chứ không `safeParse()`.

## 0.65.0 — vá đường thoát hiểm, và van xả cho nhật ký đàn

**Đường lật bằng dòng lệnh không dọn trạm đích — bẫy đặt đúng vào lúc tệ nhất.** Có hai đường
lật bảng điều phối: nút trên trang admin, và `mirror:control set`. Đường thứ hai tồn tại cho
đúng cái ngày trạm chính chết hẳn và không còn trang admin nào để bấm — mà nó chỉ ghi bảng,
không tắt bế quan, không đặt lại `mirrorSwitch`. Trạm được cất nhắc bằng dòng lệnh vì thế lên
ngôi mang nguyên trạng thái bế quan của lượt chuyển trước: không phục vụ ai, giữa lúc trạm
chính vừa chết. Đo được ngay sau diễn tập — trạm gương vẫn mang `maintenance.active = true`
từ 17:10 và sẽ mang mãi tới lượt promote kế.

Nay cả hai đường gọi chung `resetPromotedStation` (`src/lib/mirror/promote.ts`). Bước dọn ấy
**không được phép chặn lượt lật**: nếu đọc sổ hỏng (đúng kịch bản trạm chính chết, vì
`DATABASE_URL` dưới máy trỏ vào chính cái xác ấy) thì kêu to kèm câu SQL chữa tay, rồi vẫn
lật. Một trạm lên ngôi mang bảng bế quan vẫn hơn một tông môn không có trạm nào.

Phép kiểm cho phần này đi QUA schema Zod thật rồi so lại từng giá trị, không chỉ nhìn hình
thù: `appSettingsSchema` bọc mọi nhánh bằng `.catch()`, nên một trường lệch tên KHÔNG ném —
nó âm thầm hoá thành mặc định, và trạm mới lên ngôi với một bản ghi không phải cái ta viết.

**Van xả `job_events`.** §11 của thiết kế ghi trước là sẽ cần; số đo hôm nay nói rõ vì sao:
12.038 dòng cho 9 ngày, mà đỉnh tới **9.674 dòng một ngày**. Giữ mãi thì sau một tháng là
~290 nghìn dòng, và bước chép trong lượt chuyển trạm phình từ 26 giây thành hàng chục phút —
tức mỗi lượt bế quan dài ra theo tuổi của tông môn.

Hạn lưu mặc định **7 ngày**, trùng hạn lưu sảnh đàm đạo có chủ ý: một khái niệm「hạn lưu」duy
nhất cho cả hệ. Xoá theo lô 5.000, trần 50 nghìn dòng mỗi lượt cron (gấp năm lần nhịp sinh cao
nhất đo được); hết trần thì để dành lượt sau, và vì hạn lưu là mốc thời gian tuyệt đối nên
lượt sau dọn tiếp đúng chỗ vừa dừng. Cron trả luôn con số ra ngoài để một lượt curl là biết
nó có dọn được gì không.

Khác hai việc quét cũ, việc này **chỉ chạy trong cron** — xoá hàng loạt không đáng đặt trên
đường đi nóng của một trang. Đổi lại, với nó cron LÀ mạch sống chứ không còn là lưới an toàn:
cron không chạy thì bảng phình vô hạn.

## 0.64.0 — khôi lỗi đi theo trạm, và ba vết diễn tập để lại

Diễn tập chuyển trạm đi-và-về đã chạy trọn (số đo ở `deploy/mirror/README.md` §14). Bản này vá
những gì nó lôi ra.

**Khôi lỗi không đi theo bảng điều phối — lỗ hổng nặng nhất, và nó chưa từng được viết.** §8 của
thiết kế ghi「VM: thêm vòng đọc bảng điều phối」nhưng phần 4 chỉ làm việc đồng bộ, không làm việc
đi theo. Hậu quả đo được: web đã sang trạm gương, người dùng vào được, mà `tong-mon-khoiloi` nằm
im 20 phút — `WEB_URL` là hằng số trong env của nó, gặp 409 thì ném rồi ngủ 5 giây rồi gõ lại
đúng cửa cũ. Ai có khôi lỗi riêng thì vẫn chạy; ai không có thì không được phục vụ.

Bản thiết kế đầu còn SAI ở cách chữa: đọc bảng thì phải xác minh chữ ký, mà khoá ký là
`WORKER_TOKEN` của deployment — khôi lỗi máy nhà cầm linh phù cá nhân không có nó. Nên khôi lỗi
**đi theo 409** thay vì tự đọc bảng: trạm đã nghỉ phát 409 kèm `activeUrl` cho MỌI khôi lỗi, lấy
từ bảng nó vừa xác minh. Một đường, dùng chung cho cả hai vai, không thêm cấu hình nào.

Chỗ dễ vào sai nhất nằm ở chính con số 409: `/api/worker` cũng trả 409 cho「job is no longer
active」. Dấu hiệu để đi theo vì thế KHÔNG phải mã trạng thái mà là có một `activeUrl` https hợp
lệ và khác chỗ đang đứng — đi theo nhầm loại kia là biến một lỗi nghiệp vụ thành một cú đổi trạm.
Chỉ nhận https vì khôi lỗi gửi token theo mọi request, nên địa chỉ nền quyết định token đi về đâu.
Thử lại đúng MỘT lần, không ghi nhớ xuống đĩa (khởi động lại là đọc `WEB_URL` rồi lại đi theo).
`verify:worker-follow`: 23 phép bằng `fetch` giả — không cần mạng, không cần trạm nào phải nghỉ.

**Trạm vừa lên ngôi nay thức dậy ở `phase: idle`.** Bản trước để nó thừa hưởng phase dở dang, nên
trạm được cất nhắc lại không mở nổi lượt chuyển kế (`beginSwitchAction` chỉ nhận `idle`/`failed`)
cho tới khi có người bấm「Huỷ」— trái hẳn tinh thần promote. Lịch sử không mất, nó nằm trong `note`;
dấu vết có thẩm quyền vẫn là bảng điều phối.

**Chặn lượt lật sang chính mình.** Bản ghi `done` trỏ vào chính trạm đang đứng làm nút「Lật」hiện
ra, và mỗi cú bấm đẻ một revision mới chẳng đổi gì — sổ bảng điều phối hôm ấy nhảy 2→3→4→5 vì thế.
Chặn ở server (nơi có thẩm quyền), ẩn ở UI (cho khỏi bấm hụt).

Kèm một bẫy im lặng vừa lộ khi soát: hướng dẫn cài đè engine trên VM dò thay đổi bằng một danh
sách đường dẫn KHÔNG có `src/lib/worker`, nên từ nay ai chỉ sửa tệp ấy sẽ thấy diff trống rồi bỏ
qua bước cài, và VM chạy mã cũ mà không ai biết. Đã thêm vào danh sách.

## 0.63.1 — lượt diễn tập đầu tiên gãy: một luật tên database bị chép làm hai bản

Bấm chuyển trạm thật lần đầu. Chép xong **11.458 dòng** Postgres rồi gục ở bước Mongo:
「MONGODB_URI thiếu tên database ở cuối đường dẫn」. Chuỗi từ nút Connect của Atlas không mang
tên database bao giờ — path rỗng ở **cả hai** trạm — nên bước ấy chưa từng có cơ hội chạy đúng.

Ứng dụng thật vẫn sống suốt thời gian ấy, và đó chính là chỗ đáng học: `services/chat.ts` giải
tên database bằng **ba nấc** (`MONGODB_DB` → path → mặc định `jarvis`), còn `mirror/mongoSync.ts`
tự chép lại luật ấy thành một bản **chỉ có một nấc**. Bản sao không sai lúc viết; nó sai vào
đúng ngày được dùng lần đầu, sau khi đã tiêu 12 phút bế quan. Nay chỉ còn MỘT luật ở
`src/lib/mongo/dbName.ts`, cả hai nơi gọi chung.

Hai lớp gác đều đã xanh ở đúng chỗ sắp gãy — đó mới là phần đáng ghi:

- **`verify:mirror-sync` xanh 12/12 mà đời thật đỏ**, vì fixture nào cũng có path. Phép kiểm
  phải mang hình dạng chuỗi mà **nhà cung cấp thực sự phát ra**, không phải hình dạng tiện cho
  người viết test. Nay có phép kiểm mang đúng chuỗi Atlas ấy (19/19).
- **「Kiểm mạch」báo `Mongo ✔` mà chỉ `ping` cụm** — chưa hề chạm tới tên database. Nay nó in
  tên đã giải và có/chưa có `chat_messages`, nên cái bẫy này lộ ra trước khi bấm chứ không phải
  giữa lúc bế quan.

Chặn thêm một kiểu hỏng **chưa từng nổ nhưng lặng lẽ hơn nhiều**: trỏ đúng cụm mà sai tên
database thì nguồn đọc 0, đích nhận 0, `srcCount === destCount` — đối chiếu xanh mướt và trạm
gương lên ngôi với sảnh đàm đạo trống trơn. `assertSourceDb` dừng ngay khi `chat_messages` đang
nằm ở một database KHÁC trên cùng cụm; vắng ở mọi nơi thì không sao (tông môn chưa ai nhắn).
`MONGODB_DB` cũng vào bảng「env phải giống nhau ở mọi trạm」của thiết kế — nó vốn không nằm ở
đâu cả, nên việc dùng chung một biến cho cả hai bên là may chứ chưa phải chắc.

## 0.63.0 — chuyển trạm là PROMOTE, và hai lỗ hổng của bản trước

Đạo hữu chỉ ra đúng chỗ: hệ phải như promote standby thành master — trạm nào đang cầm bút
cũng chọn được trạm khác làm trạm chính mới, và trạm được chọn thành nơi phát lệnh của lượt
sau. Bản 0.62.0 không làm được, vì hai lỗ hổng chỉ lộ ra khi nghĩ theo mô hình ấy.

**Cụt đường về.** Sổ chỉ liệt kê những trạm KHÁC, mà sổ lại nằm trong app_settings nên nó đi
theo dữ liệu sang trạm mới mỗi lượt chuyển. Chuyển sang B xong, B nhận một cuốn sổ không có
tên A — không còn ai để pick mà quay về. Nay sổ là danh mục MỌI trạm kể cả trạm đang cầm bút,
và có nút「Ghi trạm này vào sổ」tự khai từ env + host của chính request, kèm cảnh báo khi sổ
còn thiếu entry ấy.

**Nguồn có thể sai — đây mới là cái nguy hiểm.** `/admin` được middleware miễn trừ chuyển
hướng (admin phải còn cửa quay lui), nên trang ấy mở được trên một trạm ĐÃ NGHỈ. Mà lượt đồng
bộ lấy nguồn từ `DATABASE_URL` của chính trạm đang chạy — phát lệnh từ trạm nghỉ nghĩa là chép
một database đứng yên từ lần lật trước đè lên trạm đích. Nay chặn ở cả ba cửa (mở lượt, mỗi
nhịp, lúc lật), vì mỗi nhịp là một request riêng và bảng có thể bị lật giữa chừng bởi lượt khác.

Luật ấy tách thành `canSwitch()` thuần để kiểm chứng được: verify:control lên 28 phép, trong
đó có phép「trạm gương sau khi promote chuyển ngược về main」— thứ bản cũ trả về "không có gì
để chuyển".

## 0.62.0 — máy chuyển trạm: chép, đối chiếu, rồi mới lật bảng

Phần 4 của hệ gương trạm. Nút「Chuyển trạm」trên tab Gương Trạm chạy một máy trạng thái sống
trong `app_settings.mirrorSwitch`: đóng cửa phát việc → chờ đàn cạn → chép Postgres theo
trang + Mongo → đối chiếu từng bảng → và CHỈ khi đối chiếu xanh mới hiện nút lật bảng điều
phối. Hỏng ở bước nào thì trạm hiện tại vẫn đang phục vụ, vì bảng chưa hề đổi.

Đổi một quyết định của bản thiết kế: đồng bộ KHÔNG chạy trên VM qua giao thức khôi lỗi nữa
mà chạy ngay trong server action, chia lô. Thứ mà "chạy trên VM" định giải quyết — trần thời
gian của function — giải được rẻ hơn nhiều bằng chia trang, mà lại không phải thêm op vào
giao thức, không phải cài lại VM, và credential không phải đi thêm một chặng mạng nào. Mỗi
nhịp là một request ngắn nên thanh tiến độ là tiến độ thật, và trạng thái nằm trong database
nên đóng tab rồi mở lại vẫn đi tiếp được.

Engine (`src/lib/mirror/`) là bản sản phẩm hoá của quy trình đã chạy tay hôm nay lúc dời
database: chép bằng `json_populate_recordset` để chính Postgres ép kiểu (jsonb, ba enum,
`text[]`), JSON đi dưới dạng CHUỖI để `bigint`/`numeric` không qua tay `Number` của JS, chép
theo thứ tự khoá ngoại, đặt lại sequence, rồi so MD5 nội dung — có bỏ qua hai cột nhịp tim vì
khôi lỗi vẫn đập nhịp trong lúc chép.

`verify:mirror-sync` dựng hai schema tạm trên database thật rồi xoá, nên không chạm một dòng
nào của tông môn: 12 phép kiểm phủ jsonb/mảng có dấu phẩy/enum/khoá ngoại/numeric 18 chữ số/
sequence/nhịp tim — và một phép kiểm "không mù": sửa một giá trị jsonb thì đối chiếu PHẢI đỏ.

## 0.61.1 — `framework: nextjs` trong vercel.json, và trạm gương đầu tiên

Một dòng trong `vercel.json`, và nó là điều kiện sống của mọi trạm gương sau này: project
tạo bằng `vercel project add` KHÔNG tự nhận diện framework — preset về `Other`, output trỏ
`public/`, site trả 404 ở mọi đường trong khi build log xanh và liệt kê đủ mọi route. Mất
một lượt dựng trạm mới lần ra. Trạm chính không dính vì project của nó sinh ra từ lượt deploy
đầu tiên, nơi Vercel tự dò.

Trạm gương `auto-hh3d-1` đã dựng thật trên một tài khoản Vercel khác hẳn: DB riêng (Neon
`jarvis-hh3d`, Atlas `atlas-jarvis-chat`), 10 biến bí mật chung khớp trạm chính, schema khớp
tới từng trigger. Tầng chuyển hướng đo bằng curl trên hai trạm sống — bảng đối chiếu đầy đủ
ở deploy/mirror/README.md §13.

## 0.61.0 — sổ gương trạm trên trang Tông Môn, và món nợ migration được trả

Phần 3 của lộ trình gương trạm: tab「Gương Trạm」(chỉ mọc cho người mang `site.switch` —
Gia chủ) ghi sổ trạm dự phòng: mã trạm (SITE_ID bên kia), URL, hai chuỗi kết nối. Chuỗi
kết nối mã hoá secretBox ngay trong server action — bản rõ không chạm document, không đi
xuống client (MirrorView chỉ mang host trần); ô sửa để trống nghĩa là giữ phong bì cũ.
Lượt lưu tự kiểm mạch: PG đếm sổ migration (nối được nhưng chưa migrate cũng là một câu
trả lời), Mongo ping 8s; kết quả ghi vào sổ cho ai nhìn cũng thấy.

Migration 0021 seed `site.switch` VÀ trả món nợ 10/08: `job.force_start` đã vào code từ
đợt Hàng Đợi nhưng thiếu migration — verify:roles đỏ trên production từ đó (code 7 quyền,
bảng 6). Nay cả hai vào sổ, verify:roles xanh lại.

## 0.60.0 — bảng điều phối gương trạm và tầng chuyển hướng

Hai phần đầu của lộ trình gương trạm (deploy/mirror/README.md §12). Chưa có gì đổi với người
dùng hôm nay: trạm chưa đặt `SITE_ID` hay chưa init bảng thì middleware cho qua toàn bộ —
fail-open là luật nền của cả tầng này, vì một biến env thiếu hay một lượt GET bucket hỏng
không có quyền quỳ cả trạm.

Lõi (`src/lib/control/doc.ts`) thuần và không SDK: schema bảng, chữ ký HMAC-SHA256 khoá
`WORKER_TOKEN` (bucket đọc công khai — quyền ghi OCI là rào thứ nhất, chữ ký là rào thứ hai,
và thứ nó gác chính là token mà VM sẽ gửi tới `activeUrl` của bảng), và phép quyết định
chuyển hướng. Chuỗi ký viết tay từng trường theo thứ tự cố định — `JSON.stringify` cả object
thì thứ tự khoá đi theo thứ tự chèn, hai phía parse lại là chữ ký thành xổ số.

Đường đọc (`read.ts`) cache 30 giây, trần fetch 3 giây, revision đơn điệu — bản cũ quay lại
(cache CDN, PUT đua nhau) không kéo được cả hệ về trạng thái trước. Middleware miễn trừ
`/admin` `/login` `/api/admin` (admin phải vào được trạm cũ mà quay lui), trả 409 kèm địa chỉ
cho `/api/worker` (khôi lỗi không đi theo redirect mù kèm Authorization), 204 cho `/api/cron`
trạm phụ (hai trạm không đua nhau dọn dẹp). `verify:control` bao 19 phép: ký/giả mạo/khoá
sai, từng nhánh quyết định (kể cả `/administrator` không được ăn theo miễn trừ `/admin`),
và đường đọc với fetch tráo — bucket chết, 404, bảng giả, bản cũ.

`mirror:control` là đường tay của bước `flipping`: ghi bảng có chữ ký rồi ĐỌC LẠI qua đúng
con đường middleware dùng, khớp revision mới tin là xong.

## 0.59.1 — đàn đã khai lại rồi vẫn đeo nút Bắt Đầu

Bậc trị sự bấm Bắt Đầu, đàn mới vào hàng chờ — nhưng dòng cũ vẫn nằm đó với nguyên cái nút,
và bấm lần nữa chỉ nhận về「đàn này đang chạy rồi」. Một cái nút chỉ để bị từ chối, đúng thứ mà
chú thích của `canStop` ngay bên cạnh đã dặn là đừng vẽ.

Cái nút chỉ là triệu chứng. Bệnh là **một tài khoản hiện HAI lần**: một dòng đang chạy và một
dòng đã tắt của cùng tài khoản ấy. `restartable` chỉ hỏi hai câu — đàn đã tắt chưa, tài khoản
còn bật không — mà quên câu thứ ba, câu duy nhất đổi sau lượt khai hộ: *tài khoản này giờ đã
có đàn sống chưa*. Đo trên production lúc phát hiện: 2 dòng còn nán lại, cả hai đều đã có đàn
sống, tức cả hai cái nút đều là nút chết.

Sửa ở chỗ sinh ra chúng — câu truy vấn — chứ không ở chỗ vẽ: dòng đã tắt nào có tài khoản
đang mang đàn sống thì không lọt vào ảnh chụp nữa. Vá ở tầng vẽ thì cái nút biến mất nhưng
tài khoản vẫn hiện hai lần, tức chỉ giấu đi một nửa cái sai.

**Một ca thứ hai cùng gốc, chưa ai gặp nhưng tới được:** dừng → khai lại → dừng tiếp trong
vòng 30 phút để lại HAI dòng đã tắt cho cùng một tài khoản, mỗi dòng một nút làm đúng một
việc giống nhau. Nay chỉ giữ lần tắt gần nhất của mỗi tài khoản. Nhánh `account_id is null`
(tài khoản đã bị xoá) phải tách riêng, vì phép so với NULL không bao giờ đúng và sẽ lặng lẽ
vứt mất dòng ấy khỏi bảng.

**Bẫy đã trả giá khi sửa:** chú thích SQL nằm trong template literal của `sql`, nên một dấu
backtick gõ vào giữa câu tiếng Việt sẽ KẾT THÚC chuỗi ngay tại đó. TypeScript báo
`TS1005: ',' expected` ở một cột vô nghĩa giữa câu tiếng Việt và không hề nhắc tới chuỗi —
mất một lượt build mới thấy. Trong khối SQL, đừng quote tên cột bằng backtick.

## 0.59.0 — Hàng Đợi: nút Bắt Đầu, và tab Đang Kẹt

Hai việc bậc trị sự phải làm bằng tay khi một đàn không thông, nay làm được trọn trên một
trang: **gỡ nó xuống, rồi dựng nó dậy**. Trước lượt này chỉ có nửa đầu — dừng xong thì dòng
biến mất khỏi bảng, và người vừa dừng phải đi nhờ chính chủ khai lại.

**Nút Bắt Đầu, chỉ sáng sau khi đã dừng hẳn.** Hàng Đợi giữ lại dòng đã tắt thêm 30 phút để có
chỗ mà bấm; hết 30 phút nó rụng, vì đây là hàng đợi chứ không phải sổ lịch sử. Đàn `stopping`
KHÔNG có nút — lệnh dừng còn trên đường, khai lại lúc ấy chỉ nhận về một lời từ chối. Bấm vào
là lập một đàn MỚI chứ không hồi sinh đàn cũ: một job đã kết thúc là một dòng lịch sử, và số
vòng, mốc giờ, nhật ký của nó phải còn nguyên để sau này còn soi lại vì sao nó kẹt.

Đường khai hộ đi qua **đủ mọi cánh cửa** của Khai Đàn thường — bảo trì, tài khoản còn sống và
đang bật, có ít nhất một nhiệm vụ được tick. Rút gọn một cửa là đẻ ra một lối khai đàn luật
lỏng hơn lối chính, và luật lỏng hơn thì sớm muộn cũng thành luật thật. Riêng ca **chủ nhân
đang TẮT tài khoản** thì từ chối thẳng và nói rõ: đè lên ý muốn của chủ là quyết định của tông
môn, không phải của một cái nút.

**Tab Đang Kẹt** liệt kê đàn mà khôi lỗi *vẫn còn sống* — nhịp tim đều — nhưng tiến độ không
nhích suốt hơn 45 phút. Hai chỗ đáng nói:

*Vì sao phải thêm một cột.* `last_heartbeat` nhảy mỗi 5 giây kể cả khi khôi lỗi đứng chôn chân,
nên nó chứng minh được "máy còn sống" mà KHÔNG chứng minh được "việc còn tiến" — nhìn nhịp tim
thì một đàn kẹt trông y hệt một đàn khoẻ. Cột mới `cycle_progress_at` chỉ nhích khi
`cycle_progress` thật sự đổi, so bằng `is distinct from` ngay trong câu UPDATE nên không có
vòng đọc-rồi-ghi nào để mà đua. Mọi chỗ xoá `cycle_progress` đều phải xoá nó theo, bằng không
một đàn vừa nhận vòng mới sẽ bị réo tên ngay từ giây đầu.

*Vì sao 45 phút.* Ngưỡng phải dài hơn nhiệm vụ dài nhất chạy đúng luật chứ không phải một số
tròn cho đẹp: Mê Cung chờ đủ 5 người rồi đánh có thể ngốn ~35 phút mà tiến độ không nhích nấc
nào — hoàn toàn khoẻ mạnh. Lấy 30 phút là mỗi ván Mê Cung tử tế đều bị réo, và một danh sách
toàn báo động giả thì người ta thôi đọc nó, tức là mất luôn cái tab. Khôi lỗi MẤT nhịp tim
cũng không hiện ở đây — ca ấy đã có `reapStaleJobs` dọn tự động trong 3 phút; thứ tab này săn
là ca ngược lại, nguy hiểm hơn vì không ai dọn hộ.

`job.force_start` là mã quyền RIÊNG chứ không núp dưới `job.force_stop`, dù cùng trao cho Gia
chủ và Thái thượng trưởng lão: hai việc khác nhau thật, và gộp lại thì cái nhãn「Dừng đàn của
người khác」trên bảng phân quyền nói dối về thứ nó mở ra.

## 0.58.10 — deploy được: bỏ `.git` ra khỏi thư mục deploy

Mục 0.58.9 chẩn đúng bệnh nhưng **kê sai thuốc**. Nó bảo đặt email commit thành địa chỉ gắn với
tài khoản GitHub; thực tế đã thử hai địa chỉ — kể cả `60702632+liquid8796@users.noreply.github.com`,
thứ GitHub cấp riêng cho chính chủ repo nên về lý không thể "không khớp" — và Vercel vẫn chặn y
nguyên cả hai lần.

Thứ gỡ được là bỏ hẳn danh tính đi: `vercel --prod` chạy từ một bản xuất **không có `.git`**.
Không có `.git` thì CLI không đính metadata commit, không có gì cho Vercel đối chiếu, nên không
còn gì để chặn. Công thức ba dòng nằm ở [README.md](README.md), mục「Bước 3 — Deploy」.

**Dấu hiệu phân biệt, đắt hơn cả công thức:** deploy chạy thật thì log hiện `Uploading (…KB)`
rồi `Building…`. Lúc bị chặn thì **không có dòng `Uploading` nào cả** — deployment vẫn sinh ra,
vẫn được gắn alias, `vercel ls` hiện `UNKNOWN`, `vercel inspect` hiện `Builds . [0ms]`, và
`--logs` trả về rỗng. Tôi đã đọc nhầm bộ triệu chứng ấy hai lần: lần đầu tưởng tải lên dở dang,
lần sau tưởng sai email. Cả hai lần đều đi sửa thứ không hỏng. Nhìn dòng `Uploading` trước đã.

## 0.58.9 — push `master` KHÔNG deploy, và vì sao `vercel --prod` cũng kẹt

[README.md](README.md) viết rằng import repo vào Vercel là "mỗi lần push lên `master` là tự
deploy". Ở dự án này câu ấy **sai**, và cái giá của nó là một quãng ngồi dò một bản deploy không
bao giờ tới: push xong, đợi, danh sách production vẫn đứng nguyên ở bản hai giờ trước.

Vercel chặn thẳng mọi bản dựng có commit email không khớp một tài khoản GitHub:

```
The deployment was blocked because the commit email <…> could not be matched to a GitHub account.
```

Máy làm việc mang email công ty ở `--global`, nên mọi commit đều đóng dấu địa chỉ ấy.

**Chỗ đắt nhất không phải chuyện git bị chặn — mà là `vercel --prod` cũng chặn theo.** CLI đính
kèm metadata git của commit đang đứng, nên nó dính đúng luật ấy. Triệu chứng thì lại chẳng giống
một cú chặn tí nào: deployment **tạo được**, `vercel ls` hiện `UNKNOWN`, thời lượng `?`, và
`vercel inspect --logs` trả về **không một dòng build nào** — vì bản dựng chưa từng khởi động.
Nhìn từ ngoài y hệt "build hỏng" hoặc "tải lên dở dang", và tôi đã đoán nhầm cả hai hướng ấy
trước khi nhìn đúng chỗ. Dấu hiệu để nhận ra lần sau: **UNKNOWN + nhật ký rỗng = lỗi danh tính,
không phải lỗi mã.**

Thuốc: `git config user.email hanam.tranle.5@gmail.com` cho **riêng** repo này — toàn cục giữ
email công ty vì máy còn repo khác. Cấu hình chỉ áp cho commit về sau, nên commit đã lỡ tạo bằng
email cũ phải `--amend` hoặc chồng một commit mới lên.

## 0.58.8 — chép lại lối vào OCI, và cách cứu khi mất khoá SSH

Ngày 10/08/2026 một phiên làm việc mở ra thì **không vào được gì cả**: `~/.ssh/jarvis_oci_ed25519`
biến mất khỏi máy, `~/.oci/jarvis_api_key.pem` cũng không còn, và profile `[jarvis]` — thứ
[deploy/oracle/README.md](deploy/oracle/README.md) dựng ra đúng để chuyện này không bao giờ chặn
ai — thì không có trong `~/.oci/config`. Chỉ còn một session token chết từ bốn hôm trước. Tài
liệu tả một cái máy không phải cái máy đang có. Lượt này chép lại cho khớp.

**Fingerprint của `[jarvis]` nay là `e9:4b:11:…`.** Khoá `64:74:2f:…` mà tệp cũ ghi vẫn ACTIVE
trên user nhưng phần riêng đã thất lạc — giữ lại phòng khi nó nằm ở máy khác, và ghi rõ là đừng
lấy ra dùng. Mục「Dựng lại profile khi mất」hoá ra chỉ đúng **khi còn cặp khoá**; mất `.pem` thì
khoá riêng không tái tạo được từ khoá công khai, nên phải đi lối trình duyệt một lần rồi tự đúc
khoá mới. Công thức đầy đủ nằm trong tệp ấy, kèm bẫy đặt tên: session phải là `jarvis-session`
chứ trùng tên `jarvis` là mục khoá-API bị đè.

**Khoá API mới cần ~45 giây mới hiệu lực, và lan không đều giữa các endpoint** — object-storage
nhận trước, `instance-agent` sau. Trong khoảng ấy OCI trả 401 `NotAuthenticated`, đọc hệt như
"khoá chưa nằm trên user", và đủ sức lừa người ta đi sửa cấu hình đang đúng. Đúng cái bẫy đã
chép cho khoá S3; hoá ra khoá API cũng thế.

**Lối cứu khi mất khoá SSH, viết ra vì đã phải mò:** Run Command là ngõ cụt — plugin ấy mang
`desired-state: ENABLED` nhưng agent chưa bao giờ báo nó về, nên lệnh nằm `ACCEPTED` vĩnh viễn.
`agent-config` là ý muốn, `instance-agent plugin list` mới là hiện thực. Bastion thì được, vì
agent CÓ liệt kê nó. Mấu chốt đắt nhất: **agent chỉ nạp plugin mới lúc khởi động** — bật rồi
ngồi đợi là đợi mãi (đo 8 phút cho mỗi plugin, bất động), reboot xong thì `RUNNING` sau ~100
giây. Và một cái bẫy nữa suýt nuốt trọn: Bastion tự nạp chính khoá của mình vào `authorized_keys`
trong một khối gắn nhãn session, khối ấy **bị gỡ khi session hết hạn**, nên phép `grep` khoá để
"khỏi thêm trùng" sẽ khớp vào dòng tạm rồi báo "đã có sẵn" mà không thêm gì — ba tiếng sau khoá
cửa lại như cũ. So theo **chú thích**, đừng so theo phần khoá.

**Kích cỡ VM: 4 OCPU / 24GB**, không phải 2/12 như bảng cũ. `shape-config` của OCI và
`nproc`/`free` trên máy nói cùng một điều. Con số này là căn cứ của trần hub ở 0.58.7, nên chép
sai chỗ này là tính sai chỗ kia.

## 0.58.7 — nới trần theo VM 4 vCPU/24GB: hub 3→5, 8 đàn, 4 tab

VM đã lên **4 vCPU / 24 GB** (kịch trần Always Free A1), nên bộ số cũ — vốn đặt cho 2 vCPU —
đã quá dè dặt. Nới:

| | Cũ | Mới | Ở đâu |
|---|---|---|---|
| `MAX_HUB` | 3 | **5** | `questGate.mjs` |
| `MAX_DEDICATED` | 2 | **giữ 2** | `questGate.mjs` |
| `WORKER_MAX_JOBS` | 5 | **8** (kịch trần mã) | drop-in systemd |
| `WORKER_QUEST_TABS` | (mặc định 3) | **4** | drop-in systemd |
| `MemoryMax` | 10G | **18G** | drop-in systemd |

Tổng nhiệm vụ chạy cùng lúc: 2 + 5 = **7**.

**`MAX_DEDICATED` giữ nguyên 2, và đó là con số duy nhất cố ý không đụng.** Sự cố 07/08 là HAI
nhiệm vụ nặng trên HAI vCPU — tỉ lệ hỏng là 1 vCPU mỗi nhiệm vụ nặng. Giữ 2 trên 4 vCPU cho mỗi
cái 2 vCPU, gấp đôi ngưỡng đã gãy; nâng lên 3 là tụt về 1,33 và bò lại đúng vạch ấy. RAM dư thì
nới được, CPU mới là thứ đã từng làm hỏng dữ liệu. Hub thì ngược lại — thao tác ngắn, gần như
không ngốn CPU — nên nới thoải mái.

`MemoryMax` 18G chừa ~6 GB cho OS. **Không có swap**, nên chạm trần là bị giết ngay, không có
bước đệm — đó là lý do không lấy sát hơn.

## 0.58.6 — huy hiệu ở tab Môn Đồ xuống dòng khi nhiều quá

Một người mang bốn huy hiệu (vai + tag) làm cả hàng kéo dài thành MỘT dòng, đẩy ba cột Trạng
thái / Nhập môn / Thao tác tràn khỏi khung.

**Chỗ dễ sửa sai:** thêm mỗi `flex-wrap` là vô tác dụng. Bảng này auto-layout
(`w-full min-w-[46rem]`) nằm trong `overflow-x-auto`, nên cột danh xưng cứ nới ra ôm trọn hàng
huy hiệu rồi để cả bảng trượt ngang — `flex-wrap` không có cớ gì để gãy dòng. Thứ thật sự làm
nó xuống dòng là cái TRẦN bề rộng đặt lên ô: `w-[38%]`.

Dùng phần trăm chứ không phải một con số rem: nó co theo bảng, và 38% của 46rem ≈ 17,5rem vẫn
rộng hơn huy hiệu dài nhất (「Thái thượng trưởng lão」≈ 11rem) nên auto-layout không có lý do ép
ngược lại. Kèm `items-start` thay `items-center` (đã gãy hai dòng thì căn giữa làm danh xưng
trôi lửng lơ giữa khối huy hiệu) và `break-words` cho danh xưng dài không có chỗ ngắt.

Đã chụp ở 1200px: huy hiệu gãy ba dòng, ba cột bên phải về đúng chỗ.

**Thấy trong lúc kiểm, KHÔNG sửa:**「Thái thượng trưởng lão」hiện HAI lần trên cùng một hàng —
một là huy hiệu VAI, một là huy hiệu TAG trùng tên. Lỗi có sẵn, không do lượt này; sửa nó là
một quyết định thiết kế (giấu tag trùng nhãn vai?) nên để tông chủ chốt.

## 0.58.5 — mang hai danh xưng thì đeo cả hai bài vị

Đạo hữu mang tag「Thánh nữ」và「Thái thượng trưởng lão」— CẢ HAI đều có khung trong tàng khố —
nhưng chỉ「Thánh Nữ」hiện ra bài vị, còn cái kia nằm cạnh như một viên chữ trơn.

Không phải lỗi ngẫu nhiên: `frameForTags` duyệt tag theo thứ tự mảng và lấy CÁI ĐẦU TIÊN có
khung, đúng luật cũ「mỗi người một bài vị」. Luật ấy hợp lý cho tới khi gặp người mang hai danh
xưng đều xứng có bài vị. Tông chủ chốt: có khung thì vẽ khung, đủ cả.

`framesForTags` thay `frameForTags` (không giữ lại bản cũ — nó thành hàm chết). Trả MỌI khung
khớp, theo đúng thứ tự tag đã sắp, dedup theo nhãn đã chuẩn hoá — hai tag「Thánh nữ」/「Thánh Nữ」
trỏ cùng một khung thì vẽ một lần, vẽ hai lần trông như lỗi chứ không như vinh danh. Không tag
nào có khung thì vẫn rơi về bài vị mặc định như cũ.

Hai chỗ đi kèm, thiếu là hỏng: viên chữ nay lọc theo TẬP khung đã chọn chứ không chỉ một cái
(không thì tag thứ hai vừa thành bài vị lại hiện thêm một viên chữ trùng tên ngay cạnh), và
vương miện ✦ của tông chủ chỉ hiện khi KHÔNG có bài vị nào.

Kiểm chứng: `verify:tag-frames` xanh với các ca mới (hai khung hiện đủ, thứ tự theo tag, tag
trùng gộp một, đã có bài vị thật thì không kèm mặc định). Cộng một lượt dựng sảnh thật dưới máy
với đúng bộ tag ấy — đo trong trang: 2 bài vị, 0 viên chữ, 0 vương miện.

**Còn một chỗ chưa đẹp:** hai bài vị (~209px mỗi cái) cộng danh xưng vượt `max-width` 560px của
cột bong bóng, nên bài vị thứ hai XUỐNG DÒNG — kể cả trên màn rộng, vì trần ấy là con số cứng.
Chưa sửa: nới nó là đụng vào bố cục chung của mọi tin, cần tông chủ chốt.

## 0.58.4 — cổng nhiệm vụ tách thành hai làn: 2 trang riêng + 3 hub

Luật cũ cho ĐÚNG một nhiệm vụ trang riêng cộng ĐÚNG một hub đồng hành — tổng ≤ 2 cho cả khôi
lỗi, kể cả của đạo hữu khác. Nó ra đời từ sự cố 07/08 (Mê Cung và Hoang Vực giành nhau hai
nhân CPU, một đòn đánh trúng bị báo thành thất bại) và đã làm đúng việc của nó, nhưng cái giá
là: hễ một người đánh Mê Cung là cả năm ghế tụt xuống 2, kể cả những đàn chỉ còn vài thao tác
hub vụn vặt. Tông chủ nới lên **hai làn riêng, mỗi làn một trần, không tranh ngân sách nhau**:

- Làn TRANG RIÊNG (`pagePath` khác `/nhiem-vu-hang-ngay`): tối đa **2**.
- Làn HUB: tối đa **3**.
- Cùng lắm 5 nhiệm vụ một lúc. Vẫn không phân biệt tài khoản — bộ đếm là của cả tiến trình.

**Tách làn kéo theo một thay đổi không hiển nhiên: luật「hub phải nhường khi có trang riêng
đứng đợi」bị GỠ BỎ.** Nó tồn tại vì hồi ấy hai loại tiêu chung một ngân sách, nên dòng hub bất
tận từ các đàn khác sẽ bỏ đói trang riêng vĩnh viễn. Nay trang riêng có hai chỗ của riêng nó,
hub nhường cũng chẳng mở thêm được chỗ nào cho nó — giữ luật ấy chỉ tổ bắt hub đứng im vô ích.
FIFO trong LÀN thì giữ nguyên: một trang riêng không vượt mặt trang riêng đã xếp trước.

Phép thử đóng đinh đủ bốn góc mới: hai trang riêng ĐƯỢC chạy cùng nhau (điều luật cũ cấm tuyệt
đối), con thứ ba phải xếp hàng, ba hub vào đủ dù hai trang riêng đang chạy, hub thứ tư hết chỗ,
và hub buông thì hub sau vào chứ KHÔNG mở chỗ cho trang riêng. Cộng một lượt chạy thật một vòng
song song với observer soi mọi ảnh chụp cổng: không ảnh nào vượt trần. 234 thuận, 0 nghịch.

## 0.58.3 — bình chú cấu hình khôi lỗi khớp lại với thực tế

Bình chú trong drop-in systemd của VM tính ngân sách bộ nhớ theo「5 ghế × ~1,8GB (Chromium +
~10 tab quest song song)」≈ 9GB. Con số **10 tab là sai**: `WORKER_QUEST_TABS` không được đặt ở
đâu nên mã lấy `DEFAULT_QUEST_TABS = 3`. Lệch về phía an toàn (dùng ít hơn dự trù), nhưng ai
đọc nó để chỉnh `WORKER_MAX_JOBS` về sau sẽ tính nhầm.

Thay ước lượng bằng số ĐO trên chính máy ấy: `MemoryPeak` ~1,92GB, `MemoryCurrent` ~0,63GB cho
TOÀN service sau ~2h chạy thật — kèm cảnh báo rằng đó là đỉnh của khoảng thời gian ấy, KHÔNG
phải đỉnh lúc cả 5 ghế cùng đầy, nên đừng nhân 1,92 cho 5.

**Phát hiện lớn hơn cái bình chú:** hai con số thật của production KHÔNG có trong repo.
`setup.sh` ghi `MemoryMax=4G` và không đặt `WORKER_MAX_JOBS` (mặc định 2), trong khi VM chạy
10G và 5 đàn — chênh lệch sống được vì `setup.sh` cố ý chỉ viết lại unit chính, không đụng
drop-in. Ai soi `.env` hay `setup.sh` đều sẽ kết luận sai. Nay `setup.sh` có một dòng chỉ
thẳng sang drop-in, và bảng vận hành trong `deploy/oracle/README.md` có hẳn một hàng cho nó
cùng đoạn giải thích hai tầng song song (5 đàn × 3 tab = tối đa 15 tab đồng thời).

Không đổi hành vi: sau khi ghi lại drop-in đã `daemon-reload` và xác nhận `MemoryMax` vẫn
10737418240 byte, `WORKER_MAX_JOBS` vẫn 5, service vẫn `active`. Bản cũ giữ ở
`/root/override.conf.bak` trên VM.

## 0.58.2 — khôi lỗi tông môn đổi tên thành `tong-mon-khoiloi`

Trang Hàng Đợi vẽ THẲNG `worker_id` của đàn đã có khôi lỗi nhận (chỉ đàn chưa ai nhận mới ra
nhãn đẹp「khôi lỗi tông môn」), nên cái tên `tong-mon-linhsu` hiện trên màn hình là DỮ LIỆU,
không phải một chuỗi trong mã nguồn. Đổi nó là đổi ba nơi, và thứ tự bắt buộc:

1. `WORKER_ID` trong `/opt/auto-hh3d/linh-su/.env` trên VM, rồi restart. Phải TRƯỚC — đổi
   database trước thì nhịp tim kế tiếp lập tức dựng lại dòng cũ (`workers` là upsert theo id).
2. Migration 0019: bảng `workers` và 51 dòng `automation_jobs.worker_id`.
3. Bảng env trong `deploy/oracle/README.md`.

**Cái giá của thứ tự ấy, và là lý do 0019 không phải một câu `UPDATE workers SET id`:** khôi
lỗi khởi động lại và tự đăng ký tên mới chỉ trong vài giây, nên tới lúc migration chạy thì
`tong-mon-khoiloi` ĐÃ tồn tại — đổi tên dòng cũ sang nó là đụng khoá chính. Đã ngã thật ở lần
chạy đầu. Bản sau: đổi tên nếu chỗ mới còn trống, còn nếu đã có người thì kéo `first_seen` sớm
hơn về dòng mới rồi mới xoá dòng cũ — nhờ vậy tông môn không mất ngày 04/08, ngày khôi lỗi lên
ca lần đầu.

Không đụng khôi lỗi máy nhà (`desktop-…`, `lt-…`) và đàn chưa ai nhận. Người dùng OS `linhsu`
trên VM giữ nguyên — đó là tài khoản hệ thống, không phải cái tên hiện trên màn hình.

## 0.58.1 — vai PHÀM NHÂN cho người chờ duyệt, và mọi môn đồ thành Đệ tử

Thang vai còn NĂM, `pham-nhan` đứng cuối vì nó là bậc thấp nhất — chưa nhập môn:

    gia-chu › thai-thuong-truong-lao › chuong-mon › de-tu › pham-nhan

**Vòng đời một người mới:** gõ cửa → `pending` + danh xưng「Phàm nhân」→ được duyệt → `active`
+ danh xưng「Đệ tử」. Phàm nhân là vai DUY NHẤT do TRẠNG THÁI quyết định chứ không do ai ban.

Backfill: tám đạo hữu chưa mang vai nào nay là Đệ tử. Gia chủ không bị đụng tới —
`[gia-chu, thai-thuong-truong-lao]` giữ nguyên. Lúc migration chạy không có ai đang chờ duyệt
nên nhánh Phàm nhân là phép rỗng; nó có mặt cho những lần sau.

**Ô nguy hiểm nhất là `ROLE_SHIELDS_BEARER["pham-nhan"] = false`.** Ghi `true` ở đó là khoá
cửa hàng chờ lại từ bên trong: mỗi người mới đăng ký lập tức thành kẻ mà Chưởng môn và Thái
thượng trưởng lão đều KHÔNG duyệt nổi, chỉ Gia chủ làm được — đúng cái bẫy `de-tu` đã vấp một
lần. Có một dòng khẳng định riêng canh nó (`bậc trị sự PHẢI quản được phàm nhân`).

**Luật thăng vai sống trong `setStatus`, không trong nút bấm**, vì nó là tính chất của cú
chuyển trạng thái chứ không của một cái nút — ngày có đường duyệt thứ hai thì nó đã đúng sẵn.
Ba điều cố ý ở đó:

- **Chỉ chiều đi lên.** Đẩy ngược về `pending`/`disabled` KHÔNG thu lại danh xưng: thu vai là
  việc của Gia chủ, tự hạ vai khi đình quyền tạm thời là hành vi bất ngờ không ai yêu cầu.
- **Ban `de-tu` vô điều kiện** (trừ Gia chủ), không chỉ khi đang mang `pham-nhan` — nhờ vậy nó
  vừa là phép thăng vai vừa là phép TỰ CHỮA cho hàng cũ chưa có danh xưng.
- **Một câu lệnh.** `neon-http` không có transaction tương tác, nên "trạng thái và danh xưng
  cùng sống hoặc cùng chết" chỉ có một hình dạng.

Chỗ suýt sai trong `register`: KHÔNG trả thẳng `RETURNING` của câu chèn. Cột `roles` là một
truy vấn con, mà CTE cấp vai ghi trong CÙNG ảnh chụp — `RETURNING` sẽ trả mảng vai RỖNG, sai
lặng lẽ. Nên: ghi nguyên tử trước, đọc lại sau.

Phép thử: `verify:permissions` quét trọn 169 ô actor×target; `verify:roles` thêm một lượt đi
đường THẬT — dựng người chờ duyệt, kiểm họ mang đúng `["pham-nhan"]`, gọi `setStatus(active)`,
kiểm đã thành `["de-tu"]`, rồi duyệt lần hai để chắc nó là phép rỗng. Một khẳng định cũ phải
sửa vì nó đóng đinh hành vi cũ ("người mới phải ra mảng vai RỖNG") — nay nó đọc `status` để
đúng ở cả hai nhánh của công tắc xét duyệt.

## 0.58.0 — Hàng Đợi có nút Dừng cho đàn kẹt mãi không thông

- **Gia chủ và Thái thượng trưởng lão dừng được MỘT đàn bất kỳ** ngay trên trang Hàng Đợi —
  dành cho lúc một đàn cứ kẹt vòng này qua vòng khác mà không ai gỡ được.
- **Đây là lần đầu ba vai bậc trị sự thôi ngang nhau.** Chưởng môn KHÔNG có quyền này, cố ý:
  dừng đàn là đụng vào việc đang chạy của người khác, và tông môn muốn ít tay chạm vào đó.
  Câu「ba vai ngang nhau」ở đầu `permissions.ts` vẫn đúng ở chỗ nó nói — quản người — và giờ
  có đúng một chỗ chúng khác nhau.
- **Là lời THỈNH CẦU, không phải lệnh giết**, y hệt nút Thu Đàn của chính chủ: đàn đang xếp
  hàng chết ngay, đàn đang chạy chuyển sang「đang thu」rồi khôi lỗi tự dừng ở điểm an toàn kế
  tiếp. Cân nhắc rồi mới chọn thế — ép thẳng sang `stopped` sẽ để khôi lỗi chạy nốt vòng rồi
  báo cáo vào một đàn đã terminal, mà `reapStaleJobs` vốn đã dọn hộ ca khôi lỗi CHẾT trong 3
  phút. Ca còn lại — khôi lỗi SỐNG mà vòng nào cũng hỏng rồi tự xếp lại — chính là ca cần nút
  này, và「đang thu」cắt đúng vòng lặp ấy.
- **Nhật ký của đàn gọi đích danh người ra lệnh**, mức `warning`. Chủ đàn mở Auto lên phải
  hiểu ngay vì sao đàn mình dừng, chứ không phải ngồi đoán.
- **Bấm lại một đàn đang dừng thì bị từ chối và KHÔNG ghi thêm nhật ký** — một dòng nữa sẽ nói
  dối là vừa có lệnh mới. Phân biệt được ca ấy nhờ tự-join đọc trạng thái CŨ trong cùng câu
  lệnh, vì `returning` chỉ trả về hàng mới.
- Lệnh này đánh thức realtime (`notifyDashboard`), thứ mà nút Thu Đàn của chính chủ không làm —
  người ra lệnh đang đứng nhìn đúng cái bảng ấy, không có lý do bắt họ đợi nhịp soát 30 giây.
- `npm run verify:force-stop` đóng đinh bảy điều trên database thật, trong đó có điều dễ chép
  nhầm nhất: dừng một đàn KHÔNG được kéo theo đàn khác của cùng chủ (`requestStop` thì dừng
  tất cả — hai hàm ở sát nhau và chỉ khác đúng chỗ ấy).

## 0.57.7 — xoá vai `admin`, gộp vào `chuong-mon`

Thang vai còn BỐN: `gia-chu`, `thai-thuong-truong-lao`, `chuong-mon`, `de-tu`. Danh xưng
「Trưởng môn」biến mất khỏi hệ thống.

**Gộp được mà không mất gì của ai**, vì `admin` và `chuong-mon` xưa nay nắm ĐÚNG một bộ quyền
(`TRI_SU_PERMISSIONS`) — chúng chỉ khác nhau ở cái tên. Đây là bỏ một danh xưng thừa, không
phải hạ quyền. Lúc migration chạy, `user_roles` không có dòng nào mang `admin` (đã đếm trước
và sau), nên không môn đồ nào bị đụng tới.

Migration `0016` vẫn viết đủ bước chuyển người sang `chuong-mon` trước khi xoá, dù bước ấy là
phép rỗng: nó phải đúng cả khi có người kịp nhận vai giữa lúc viết và lúc chạy trên production.
`role_permissions` của `admin` tự rụng theo `ON DELETE CASCADE`.

**Chỗ suýt sót:** `de-tu` phải tụt `sort_order` từ 4 xuống 3. Không phải thẩm mỹ —
`verify:roles` khẳng định `sort_order` bằng ĐÚNG chỉ số của vai trong `ASSIGNABLE_ROLES`, mà
`admin` vừa rời vị trí 3. Quên là thang vai dưới database thủng một nấc.

**Bốn nghĩa của chữ "admin" trong repo, và chỉ MỘT bị xoá:**

| Chỗ | Nghĩa | Đã đụng? |
|---|---|---|
| `ASSIGNABLE_ROLES`, bảng `roles` | mã VAI | **xoá** |
| `role: "user" \| "admin"` trong JWT phiên | claim của token | giữ nguyên |
| `/admin`, `/api/admin/*`, `admin.panel` | đường dẫn & mã QUYỀN | giữ nguyên |
| `ADMIN_USERNAME`, đạo hiệu `admin` khi gieo mầm | TÊN ĐĂNG NHẬP | giữ nguyên |

Trình biên dịch làm phần lớn việc rà: `ROLE_LABEL`, `ROLE_PERMISSIONS`, `ROLE_SHIELDS_BEARER`
và `ROLE_BADGE_CLASS` đều là `Record<Role, …>`, nên bỏ `admin` khỏi `ASSIGNABLE_ROLES` là `tsc`
tự chỉ ra từng chỗ còn khai thừa.

Kèm theo: mấy câu báo lỗi xưng hô「Trưởng môn không đụng được người mang vai」đổi sang gọi theo
BẬC (「Bậc trị sự…」) — giữ nguyên là gọi sai tên một Chưởng môn. Và bộ `verify:permissions`
được dọn: hai fixture `admin`/`admin2` nay trùng hệt `master`/`master2` nên bỏ hẳn, còn dòng
kiểm「ngang vai không ai đụng được ai」đổi sang cặp KHÁC vai (Thái thượng × Chưởng môn) — để
nguyên thì nó so một fixture với chính nó.

## 0.57.6 — bỏ hai đoạn chữ dẫn giải trong Ngọc Giản

- **Bỏ đoạn mở đầu của khối chọn hạng tài khoản** ("Một bộ cấu hình chung cho cả đội…") và
  **đoạn mô tả khối Nhiệm vụ tài khoản thường** ("Tám nhiệm vụ chạy trên trang riêng…"). Hai
  cái tab đã tự nói ra chúng làm gì, và bảng nhiệm vụ ngay dưới cũng vậy.
- Giữ lại đúng dòng còn mang THÔNG TIN chứ không phải lời dẫn: `Đội hình hiện tại: 1 VIP.`
  Nó giờ đứng một mình, nên điều kiện `accounts.length > 0` bọc CẢ thẻ `<p>` thay vì chỉ phần
  chữ bên trong — không thì lúc chưa có tài khoản nào, đoạn rỗng ấy vẫn chiếm nguyên `mb-4`,
  tức một khoảng trống 1rem không ai hiểu từ đâu ra.

## 0.57.5 — bỏ trống ô tên thì tài khoản tự mang tên nhân vật trong cookie

Ô「Tên gợi nhớ」để trống trước đây cho ra một cái nhãn vô hồn:「Tài khoản 2」. Nay nó lấy đúng
tên nhân vật đọc được trong cookie vừa dán — cùng phép và cùng thứ tự ưu tiên với bản PC
(`GameAccount.ResolveLabel`): **tên tự đặt → tên đọc từ cookie → tên đánh số**. Nấc cuối vẫn
do `accounts.ts` cấp, vì đó là nơi duy nhất biết số thứ tự.

Cookie đăng nhập WordPress mang giá trị `user|expiry|token|hmac` đã URL-encode, nên tên là
đoạn trước dấu `|` đầu tiên. Hàm `detectWordPressUser` đặt trong `quest-engine/cookies.mjs`
chứ không trong server action — đó là kiến thức về ĐỊNH DẠNG COOKIE, đúng thứ module lá ấy
giữ, và cũng là nơi duy nhất `npm run smoke` với tới được (server action kéo theo `next/cache`
và cả tầng database, không đơn vị hoá được).

**Hai chỗ cố ý KHÁC bản PC, cả hai đều là ca xấu nhất:**

- `decodeURIComponent` **ném** khi gặp phần trăm hỏng (`%zz`, hay một `%` lạc lõng), khác
  `WebUtility.UrlDecode` bên C# vốn im lặng để nguyên. Một chuỗi dán thiếu đuôi là đủ dựng ra
  cảnh ấy, mà một cái tên gợi nhớ thì không đáng để làm hỏng cả lượt lưu tài khoản — nên bắt
  lại và dùng giá trị thô.
- Bản PC lấy `pipe > 0 ? decoded[..pipe] : decoded`, tức giá trị bắt đầu bằng `|` cho ra
  NGUYÊN chuỗi làm tên. Ở đây đoạn đầu rỗng nghĩa là không đọc được tên → rơi về tên đánh số,
  thay vì khắc một chuỗi rác lên nhãn phải nhìn mỗi ngày.

Thêm 11 phép thử trong `npm run smoke` cho đúng những ca ấy (235 thuận, 0 nghịch), và một lượt
kiểm đầu-cuối đi đúng đường người dùng đi: để trống ô tên, dán cookie, bấm Lưu — nhãn ra đúng
tên trong cookie, rồi xoá lại tài khoản thử bằng chính nút Xoá của giao diện.

Nhân tiện hai chỗ nhỏ: lời nhắn sau khi lưu giờ khoe luôn tên đọc được (「có phiên đăng nhập
của『…』」) để biết ngay mình vừa dán cookie của ai; và phép nhận diện cookie đăng nhập trong
lời nhắn được siết lại cho khớp với phép đoán tên — trước nó so tiền tố lỏng hơn, thiếu gạch
dưới cuối và phân biệt hoa thường, nên có thể khoe「có phiên đăng nhập」trong khi phép đoán tên
lại bảo không thấy gì.

Dọn một dòng chết: `@ts-ignore` trên lượt import `cookies.mjs`. Đã đo — gỡ ra thì `tsc --noEmit`
vẫn sạch (`allowJs` lo được). Và import nay trải nhiều dòng nên lỗi module, nếu còn, sẽ rơi ở
dòng cuối, ngoài tầm che của nó: còn cần thật thì tsc đã đỏ.

## 0.57.4 — dời tàng thư sang kho Postgres mới, và vá một phép thử đã đỏ từ 0.57.0

- **Toàn bộ dữ liệu đã chuyển sang database Postgres mới** (`jarvis-auto-hh3d`, Neon
  `us-east-1`), rời kho cũ ở `ap-southeast-1`. 11 bảng, 1.941 dòng. Không đổi một dòng code
  nào — đây là việc của biến môi trường và dữ liệu.
  - Chép bằng `json_agg` bên cũ → `json_populate_recordset` bên mới, tức để CHÍNH Postgres
    dựng lại từng giá trị về đúng kiểu cột. Một vòng qua JavaScript là một vòng có cơ hội biến
    `text[]` thành chuỗi, timestamptz thành ISO lệch múi, hay bóp jsonb thành `[object Object]`.
    (`pg_dump` không dùng được: máy làm việc không có bộ công cụ client của Postgres.)
  - Schema bên mới dựng bằng CHÍNH bộ migration của repo, không chép DDL tay — nhờ đó bảng
    `drizzle.__drizzle_migrations` bên mới khớp đúng repo.
  - Đối chiếu bằng **md5 nội dung từng bảng**, không chỉ đếm dòng: đếm dòng không bắt được một
    cột bị nuốt hay một mốc thời gian lệch múi. Cả 11 bảng khớp từng byte.
  - `job_events_id_seq` được `setval` về max id (25889). Chép id tường minh KHÔNG đẩy sequence,
    nên bỏ bước này là dòng nhật ký kế tiếp đâm vào một id đã tồn tại.
  - **Bảng `workers` được so bằng phép loại trừ cột `last_seen`** — khôi lỗi ghi lại nhịp tim
    5 giây một lần kể cả trong lúc bế quan (cửa claim đóng, nhưng nó vẫn gõ cửa và vẫn được
    điểm danh). Đo được: hai bên lệch đúng 32 giây, mọi cột khác trùng khít.
  - Chép lượt cuối trong lúc **đóng cửa tông môn**, để không có lượt ghi nào rơi vào kho cũ
    giữa chừng. Cửa mở lại ngay sau khi production đã đọc kho mới.
- **`PGHOST_UNPOOLED` bị gỡ khỏi Vercel**, và đó là cái bẫy suýt bị bỏ sót: realtime (LISTEN)
  không dùng thẳng `DATABASE_URL` mà SUY ra host trực tiếp từ nó — ưu tiên `PGHOST_UNPOOLED`
  nếu có. Biến ấy còn trỏ vào host kho CŨ, nên đổi mỗi `DATABASE_URL` là bảng Auto mất realtime
  mà trang vẫn xanh. Gỡ đi thì phép suy `-pooler.` → `.` tự cho đúng host mới, và
  `DATABASE_URL` trở lại làm nguồn DUY NHẤT như thiết kế đã định.
- **Bảng mồ côi `password_resets` KHÔNG được mang theo** (0 dòng, không nằm trong schema.ts,
  không migration nào tạo, không code nào đọc). Kho cũ đã áp 17 migration trong khi repo chỉ có
  16 — đúng một migration đã bị gỡ khỏi repo, và bảng ấy là dấu vết còn lại của nó.
- Vá `verify:maintenance`: nó đã ĐỎ từ bản 0.57.0 mà không ai chạy. Vòng lặp cũ quét trọn
  `ASSIGNABLE_ROLES` và đòi **vai nào cũng** đi qua được lúc bế quan — đúng khi mọi vai đều là
  vai trị sự, sai ngay khi có `de-tu`. Đệ tử phải gặp bảng chắn như mọi môn đồ; bảng viết tay
  `ROLE_PASSES_MAINTENANCE` giờ bắt mỗi vai thêm về sau khai mình thuộc phía nào.

## 0.57.3 — chỉ đích danh một cách lấy cookie, thay cho lời tả định dạng

Ô「Chuỗi cookie đăng nhập」trước đây mời người dùng bằng một câu tả ĐẦU RA:「'a=1; b=2' từ
DevTools hoặc bản xuất JSON」. Câu ấy đúng nhưng vô dụng với đa số — nó nói cái chuỗi trông
như thế nào, không nói làm sao có được nó. Ai không quen DevTools đọc xong vẫn đứng im.

Nay ô nhập chỉ còn「Dán chuỗi cookie đăng nhập vào đây」, và ngay dưới là một đường đi cụ thể:
cài tiện ích Chrome **J2TEAM Cookies**, mở trang game đang đăng nhập, bấm tiện ích → **Export**,
dán nguyên chuỗi vừa chép. Câu báo lỗi「chuỗi cookie không đọc được」cũng đổi theo đúng một
đường ấy — trước nó chỉ sang DevTools và Cookie-Editor, tức đá nhau với dòng hướng dẫn nằm
ngay dưới ô dán.

**`parseCookieString` KHÔNG đổi.** Nó vẫn dễ tính như cũ và vẫn nhận cả bốn định dạng (chuỗi
`a=1; b=2`, `{url, cookies:[…]}`, mảng JSON trần, object phẳng) — nói hẹp lại ở phần chữ không
đóng đường nào cả, chỉ là chỉ cho người ta con đường ngắn nhất. Đã kiểm bằng một bản export
đúng hình dạng J2TEAM Cookies: đọc ra 2 cookie của site game, và cookie `.facebook.com` lẫn
trong bản "export tất cả" bị lọc bỏ đúng như thiết kế.

Còn sót một chỗ CHƯA đổi, cố ý: câu báo lỗi trong `runCycle.mjs` (khi cookie đã lưu hết hạn
giữa lượt chạy) vẫn nói「dạng 'a=1; b=2' từ DevTools hoặc bản xuất JSON」. Nó nằm trong
quest-engine, mà sửa quest-engine thì phải cài đè khôi lỗi trên VM — một cái giá không tương
xứng cho một câu chữ, nên để dành ghép vào lượt nào có sửa engine thật.

## 0.57.2 — quét dọn Chromium mồ côi, bằng sổ chứ không bằng cách quét tiến trình

- **`npm run shot:clean`** dọn những Chromium mà một lần treo hay một cú Ctrl-C để lại. Lượt
  chụp bình thường cũng tự dọn ở đầu mỗi lần chạy, nên thường không ai phải gõ tay.
- **Không quét tiến trình — giữ MỘT CUỐN SỔ.** Hai lý do, và cả hai đều là lý do chắc:
  - Quét theo TÊN là giết luôn Chrome thật của chủ máy: Chromium của Playwright cũng tên
    `chrome.exe`.
  - Quét theo ĐƯỜNG DẪN thì an toàn hơn, nhưng đo được trong môi trường này: `tasklist` và
    `Get-CimInstance Win32_Process` **đều trả về rỗng ngay cả khi Chromium đang chạy**. Một
    phép dọn dựa vào thứ có lúc không nhìn thấy gì là một phép dọn không kiểm chứng được.
- **Bằng chứng trước, lệnh giết sau.** Sổ nhớ PID kèm `wsEndpoint`; lúc dọn thì BẮT TAY qua
  chính endpoint ấy, và chỉ thứ trả lời được giao thức Playwright mới bị đụng tới. PID bị hệ
  điều hành cấp lại cho tiến trình khác cũng không sao — tiến trình lạ không bắt tay được.
- **Hàng rào tuổi**: mặc định chỉ dọn bản ghi cũ hơn 10 phút, nên một lượt chụp của phiên khác
  đang chạy song song không bao giờ bị đụng. Một lượt có trần 90 giây × 2, nên mười phút là xa
  hơn mọi lượt hợp lệ.
  - **Cờ `--all` tháo hàng rào ấy, và nó nguy hiểm thật.** Chính lượt kiểm chứng đầu tiên của
    bản này đã dùng `--all` rồi giết mất một trình duyệt mở 7 giây trước — gần như chắc chắn là
    lượt chụp của một phiên đang chạy trên cùng cây làm việc. Giờ `--all` in ra danh sách những
    gì nó sắp giết kèm tuổi, và `verify:sweep` **không dùng cờ ấy**.
- **`npm run verify:sweep`** đóng đinh ba điều, vì đây là mã GIẾT TIẾN TRÌNH: nhặt đúng orphan,
  chừa nguyên lượt đang chạy, và tuyệt đối không phát lệnh giết nào khi không bắt tay được.
- Bỏ kết cục「đóng tử tế」khỏi phép dọn: đo ra là `browser.close()` trên một trình duyệt nối
  qua `connect()` chỉ cắt dây, tiến trình server vẫn sống. Giữ cái nhãn ấy chỉ để nhật ký
  nói「không đóng được」về một chuyện hoàn toàn bình thường.

## 0.57.1 — hàng danh tính trong sảnh nhỏ lại một bậc

Đạo hữu đặt ảnh chụp lên và nói chân dung với bài vị quá khổ. Đúng: ở 980px bề ngang, riêng
hàng tên đã chiếm 60px chiều cao và bài vị dài 260px — nó át cả bong bóng chữ nằm ngay dưới.
Cả hàng nhỏ đi ~20%: chân dung 78→62px, tên 1.2→1.05rem, bài vị 92→74px.

**Ba con số này phải đi cùng nhau.** Chân dung giữ đúng tỉ lệ 0,77 so với chiều cao DÙNG THẬT
của bài vị (74 − 2×13 = 48px, đo lại trong trang: đúng 48px) — sửa lẻ một món là lệch thế cân
giữa mặt người và tấm biển bên cạnh. `margin-block` âm cũng phải co cùng tỉ lệ (−16→−13px):
giữ nguyên −16px ở chiều cao 74px là ăn lẹm vào chính cái biển.

Chỗ dễ sai vẫn là chỗ cũ: chiều cao CSS **không** phải chiều cao cái biển — tệp gốc 920×291
mang quầng sáng chiếm gần nửa khung, biển thật chỉ ~0,6 chiều cao khai báo. Nên trước khi chọn
số đã dựng bàn thử bốn cỡ với ĐÚNG tấm webp thật: 92px (biển ~55px), 80 (~48), 74 (~44), 66
(~40). Ở 66px chữ khắc bắt đầu bết, nên 74px là gần sàn — ai muốn hạ tiếp thì phải chụp lại,
đừng suy từ con số.

Kiểm chứng dưới máy phải đi đường vòng vì Mongo không kết nối được từ đây (resolver không trả
bản ghi SRV) nên sảnh luôn rỗng: chặn `/api/chat` bằng Playwright rồi trả tin dựng sẵn, để
React vẽ đúng component với đúng CSS vừa biên dịch, chụp hai tấm mới/cũ trong cùng một trang.

## 0.57.0 — vai ĐỆ TỬ, và bài học về một tấm khiên phát nhầm

- **Thêm vai `de-tu` (Đệ tử)** — danh xưng cho môn đồ thường, đứng CUỐI thang vai. Nó là vai
  ĐẦU TIÊN của hệ thống **không mang quyền nào**: `ROLE_PERMISSIONS["de-tu"]` rỗng, không mở
  trang Tông Môn, không quản ai, không đổi vai của ai. Trưởng môn ban nó cho ai thì người ấy
  được gọi tên trong bảng môn đồ và trong sảnh đàm đạo, chấm hết.
- **Chỗ khó nằm ở phép CHE CHẮN, không nằm ở việc thêm một dòng vào danh mục.** Trước bản này,
  `canManageUser` che chắn *bất kỳ ai mang một vai có trong danh mục* khỏi bậc trị sự — một luật
  đúng khi mọi vai đều là vai trị sự. Thả `de-tu` vào theo cách ấy là **trao cho mỗi đệ tử một
  tấm khiên chắn cả ba bậc trị sự**: Trưởng môn, Chưởng môn và Thái thượng trưởng lão đều không
  duyệt, không sửa, không trục xuất được họ nữa — chỉ Gia chủ làm nổi. Đúng ngược với ý nghĩa
  của vai: đệ tử chính là người mà bậc trị sự sinh ra để quản.
  - Tách đôi bằng `ROLE_SHIELDS_BEARER`, và cố ý là `Record<Role, boolean>` chứ không phải một
    danh sách các vai được che: kiểu này bắt MỌI vai thêm về sau phải trả lời câu hỏi ấy ngay
    tại chỗ, **không biên dịch được nếu bỏ trống**. Một danh sách thì im lặng bỏ sót, và bỏ sót
    ở đây nghĩa là một vai trị sự mới lặng lẽ thành người ai cũng trục xuất được.
  - Ba câu hỏi từ nay rời hẳn nhau: "mở được trang Tông Môn" (`isAdminUser`), "có tên trong danh
    mục vai" (đúng cả với đệ tử), và "được che chắn khỏi bậc trị sự" — chỉ câu cuối được dùng ở
    `canManageUser`.
- **Hai hàng rào cũ đã ĐỎ đúng lúc, và đó là tin tốt**: `verify:permissions` khẳng định "vai nào
  cũng phải mở được cửa trị sự" và "vai không mở được việc gì thì nó là một cái nhãn". Cả hai
  đều là giả định đúng của thời bốn vai, và cả hai đều gãy khi có vai đầu tiên sinh ra để làm
  cái nhãn. Thay bằng bảng `ROLE_SHAPE` viết tay (`opensAdminDoor` × `labelOnly`) — vẫn giữ đúng
  nguyên tắc của tệp ấy: oracle phải VIẾT TAY, vì oracle đi hỏi chính thứ đang bị kiểm thì nó
  gật đầu với mọi lỗi mà code mắc.
- Huy hiệu「Đệ tử」dùng sắc nhã của tag, KHÔNG dùng màu của bậc trị sự — theo đúng luật đã ghi
  tại `ROLE_BADGE_CLASS`: màu nói về QUYỀN, và vai này không mở gì cả.
- Migration `0015` chỉ thêm một dòng vào danh mục `roles` (sort_order 4) và **không** thêm dòng
  nào vào `role_permissions` — phép so của `verify:roles` là hai chiều, nên một ô thừa ở đó cũng
  đỏ y như một ô thiếu.
- Kiểm chứng: `verify:permissions` quét trọn **169 ô** actor×target (13 người, thêm một đệ tử,
  một đệ tử thứ hai và một Trưởng môn đeo kèm danh xưng đệ tử — để chắc tấm khiên của vai trị sự
  KHÔNG mất đi vì đeo thêm nhãn). `verify:roles` xanh trên database thật: 5 vai, 5 quyền, 11 ô
  vai→quyền.

## 0.56.2 — `npm run shot` thôi treo, và thôi để lại Chromium mồ côi

- **Tìm ra chỗ treo, và nó không phải `networkidle`.** Phép chờ ảnh trước khi bấm máy viết
  `img.decode().catch(() => {})` — mà `.catch()` chỉ bắt lời hứa BỊ TỪ CHỐI, nó không cứu được
  một lời hứa KHÔNG BAO GIỜ NGÃ NGŨ. Ảnh `loading="lazy"` chưa từng vào khung nhìn thì
  `decode()` nằm đó mãi, và `page.evaluate` không có hạn giờ nào cả.
  - Trang Tông Môn hội đủ điều kiện: `AdminTabs` vẽ MỌI tab rồi chỉ `hidden` tab không hoạt
    động, nên ảnh trong tab đang ẩn không bao giờ tải. Đo được: lượt chụp `/admin` in
    ra「đã bấm」rồi đứng im **hơn ba phút**, không tệp nào được ghi. Sau bản này: **12,2 giây**.
  - Giờ phép chờ có trần 4 giây, và trần ấy nằm TRONG trang — hết giờ thì chụp với những gì đã
    tải được. Một tấm ảnh thiếu vài hình còn hơn không có tấm nào.
- **Đồng hồ canh giờ + thử lại**, vì "đã vá cái treo đã biết" không phải một lời hứa: mỗi lượt
  có hạn (mặc định 90 giây, đổi bằng `--timeout`), hụt hạn thì GIẾT trình duyệt rồi thử lại một
  lượt nữa, hết lượt thì thoát mã 1 kèm lý do — thay vì treo im lặng.
  - Cả phép KHỞI ĐỘNG trình duyệt cũng nằm trong hạn ấy. Khe này suýt bị bỏ sót: `launchServer`
    treo thì chưa có PID nào để giết, tức không hàng rào nào phía dưới với tới được.
- **Dọn tiến trình theo PID, ba nấc**: `server.kill()` (đo được 101ms) → hạn chót cho chính lời
  hứa ấy → `taskkill /T /F` cả cây nếu vẫn còn sống. Đổi sang `chromium.launchServer()` chính
  là để có PID — `browser.process()` không tồn tại trên `Browser` của bản playwright-core này.
  - **Giết theo PID, TUYỆT ĐỐI không quét theo tên.** Trên máy còn `next dev` của phiên khác và
    Chrome thật của chủ máy; một lệnh `taskkill /IM chrome.exe` là giết luôn tab ngân hàng của
    họ. Đây là lý do bản này không có tính năng "quét dọn Chromium mồ côi" nào cả.
- Thoát tường minh sau khi chụp xong: `connect()` để lại socket, và một tiến trình node nằm lại
  sau khi đã in「Đã chụp」đúng là thứ phiền toái cần dẹp.

## 0.56.1 — dọn nốt tấm nền Hàng Đợi khỏi repo

- **`public/backdrop-hang-doi.png` đã đi** (1.8MB): bản 0.56.0 đưa nó lên tàng khố và gán cho
  trang Hàng Đợi, đã xác nhận production đang ăn ảnh từ OCI — nên bản trong repo chỉ còn là
  trọng lượng chết. `public/backdrop.png` ở lại, nó là nấc cứu hộ.
- **Script di dân `media:backdrops` cũng đi cùng.** Nó đọc đúng tệp vừa xoá, nên giữ lại là để
  một lệnh chắc chắn ngã nằm trong package.json. Việc nó làm giờ là việc của tab Giao Diện.

## 0.56.0 — tấm nền dời sang tàng khố, và mỗi trang chọn được nền riêng

- **Tab Giao Diện mới trong trang Tông Môn**: tải ảnh nền lên, xem lưới ảnh trong kho, và gán
  nền cho từng trang. Không sửa mã, không deploy — đổi nền giờ là một cú bấm.
- **Ảnh nằm ở OCI** (tiền tố `backdrops/`), **phép gán nằm ở `app_settings`**, và **luật CSS do
  layout gốc dựng ở mỗi lượt vẽ trang**. Trước bản này cả hai tấm nền đều gõ cứng trong
  `globals.css` và nằm trong `public/`.
- **Lưới ảnh đọc THẲNG từ kho**, không qua một sổ trong `app_settings` — khác hẳn Khung Tag.
  Nghĩa là không có hai bản danh sách để mà lệch nhau, và một tấm vừa tải lên là thấy ngay dù
  chưa gán cho trang nào. Cái giá: kho không giữ nhãn, nên tên hiển thị suy từ key.
- **Thang rơi ba nấc**: nền riêng của trang → nền mặc định (cũng là nền trang chủ) → tấm cứu hộ
  `public/backdrop.png` còn nằm trong repo. Nấc cuối cố ý giữ lại: một tông môn thiếu nền riêng
  thì vẫn đẹp, một tông môn chỉ còn màu đen trơn thì không.
- **Trang tự khai mình là ai** bằng `data-backdrop`, vì layout gốc không biết nó đang dựng
  đường dẫn nào — và đường "proxy gắn đường dẫn vào header" đã được đo là không chạy trên
  Next 16.2. Chín trang khai dấu; trang chủ không, vì nó CHÍNH LÀ nền mặc định.
- **Một lỗ bảo mật do chính phép thử bắt được, trong mã của bản này.** URL trong `app_settings`
  đi thẳng vào một thẻ `<style>`, nên phép làm sạch ở đó là ranh giới tin cậy thật. Bản đầu cho
  qua `//example.com/a.png` — dấu gạch chéo nằm trong bộ ký tự hợp lệ nên chuỗi ấy vẫn là
  "gạch chéo rồi toàn ký tự hợp lệ", mà nó là URL theo GIAO THỨC TƯƠNG ĐỐI: trình duyệt sẽ tải
  tấm nền từ một tên miền lạ. `verify:backdrops` đóng đinh 15 ngả thoát ra, và đúng ngả này là
  ngả đã đỏ.
- **Xoá ảnh đang dùng thì bị từ chối**, kèm tên những chỗ đang treo nó — thay vì để lại một URL
  chết và một trang lặng lẽ rơi về nền mặc định.
- **Client gửi KEY, server tự dựng URL.** Nếu nhận URL từ client thì phép làm sạch là hàng rào
  duy nhất; nhận key rồi tự dựng thì URL luôn là URL của chính kho, và phép làm sạch thành lớp
  thứ hai.
- Cửa bế quan và tấm nền giờ **dùng chung một lượt đọc `app_settings`** (`getRenderSettings`,
  bọc `cache()` của React). Không chung thì mỗi lượt vẽ trang tốn hai câu truy vấn cho cùng một
  dòng JSONB — và tệ hơn, hai câu ấy có thể trả về hai đời cấu hình nếu trưởng môn bấm Lưu đúng
  khe giữa chúng.
- `npm run media:backdrops` đưa tấm Hàng Đợi đang có lên kho rồi gán đúng chỗ cũ, idempotent —
  chạy SAU khi deploy, vì bản code cũ không biết nhánh `appearance` và `saveAppSettings` sẽ
  nuốt mất nó.

## 0.55.2 — khay emoji mang mặt cười, và đổi chỗ với nút kẹp file

Thanh soạn Phòng Chat trước đây là `[💬] [ô nhập] [📎] [➤]`. Bong bóng thoại đọc ra là "nhắn
tin" — trùng nghĩa với chính ô nhập ngay bên cạnh, nên nó chẳng nói được rằng bấm vào thì ra
emoji. Nay là `[📎] [ô nhập] [😊] [➤]`: kẹp file sang trái, khay chọn sang phải sát ấn Truyền
Âm. Mặt cười cố ý dùng ĐÚNG 😊 của nút thả cảm xúc trên mỗi tin — hai nút cùng một nghĩa
"chọn một emoji" thì chung một mặt chữ là nhất quán, không phải lẫn.

`.chat-picker` phải đổi neo `left` → `right` theo. Khay `position: absolute`, nên nút dời đi
mà neo đứng yên thì khay rơi xuống ở tận đầu kia thanh soạn, như từ đâu hiện ra.

Đã cân nhắc 😀 rồi bỏ: dựng thử bằng chính bộ Chromium của `npm run shot` cho thấy Segoe UI
Emoji vẽ nó mắt TRẮNG to và miệng há màu hồng, lạc hẳn khỏi tông vàng-cam của sảnh — trong khi
😊 là mặt cam, mắt hai nét cong, cùng bảng màu với viền khung. Đây là loại khác biệt mà đọc mã
không thấy, phải dựng ảnh ra mới phán được.

Kèm một vá cho `scripts/shotPage.mts`: `waitUntil: "networkidle"` **không bao giờ** tới trên
`/chat` dưới máy phát triển — trang poll `/api/chat` mỗi 2,5 giây, mà kết nối Mongo dưới local
treo ~50 giây (resolver máy nhà không trả bản ghi SRV), nên mạng không có nổi một khoảng lặng
500ms. Script chết vì hết giờ dù trang đã vẽ xong từ lâu, và lần chụp đầu tiên chạy được chỉ
là gặp may về nhịp. Nay hụt thì lùi về `load` rồi chụp tiếp, và in ra là đã lùi — mốc chờ ảnh
`decode()` phía sau vẫn giữ cho không bấm máy sớm.

## 0.55.1 — viền khung Phòng Chat vẽ lại cho khớp bản thiết kế

Đạo hữu đặt ảnh hiện tại cạnh bản thiết kế và nói vẫn chưa giống. Đúng — ba chỗ lệch, và
chỉ ảnh chụp mới lộ ra:

- **Ngoặc góc từ `linear-gradient` sang SVG.** Gradient chỉ vẽ được hình CHỮ NHẬT, nên bốn
  ngoặc luôn vuông trong khi khung thì bo tròn — nét ngoặc cắt ngang đường bo, trông như dán
  lên. SVG vẽ được cung tròn nên ngoặc chạy song song với viền. Nét đôi cách 5px và chỉ dày
  lên ở vùng góc, còn giữa cạnh vẫn một nét, đúng như bản thiết kế.
- **Ấn đỉnh từng bị cắt mất nửa trên.** `.chat-shell` phải `overflow: hidden` (header và
  thanh soạn có nền riêng, không cắt thì chúng vuông góc chồi ra khỏi bốn góc bo), và chính
  cái cắt ấy xén đôi viên ngọc — nó hiện ra thành một hình chữ V cụt. Bản trước vá bằng cách
  kéo ấn xuống rồi lấy một dải màu che chỗ nối: chữa triệu chứng. Nay tách một lớp bọc
  `.chat-frame` KHÔNG cắt, hoa văn nằm ngoài khung con — ấn vẽ trọn vẹn, cưỡi đúng lên viền,
  và cái dải che kia biến mất.
- **Nút thanh soạn đè lên ngoặc góc dưới.** Đệm ngang 14px → 30px để hai nút tròn nằm gọn
  bên trong, hoa văn thông suốt như bản thiết kế.

Một lỗi tự gây rồi tự bắt trong lúc sửa: lớp bọc dùng `height: calc(...)` + `min-height`, mà
khung con lại `height: 100%` — phần trăm ấy phân giải theo chiều cao KHAI BÁO, không theo
`min-height`. Màn thấp hơn 560px thì bọc cao 420px còn con vẫn tính theo calc, ngắn hơn bọc,
và hoa văn đáy trôi hẳn khỏi viền. Cho con làm flex item là căng đúng chiều cao dùng thật.
Đã đo lại ở khung 900×520: cả bốn ngoặc bám khít viền.

Cũng đã THỬ rồi BỎ một lớp mây cuộn nằm sâu trong góc, vì ảnh chụp cho thấy nó đè lên chữ
「Phòng Chat」(header chỉ cách mép 22px) — và soi kỹ thì phần "hoa văn" ấy ở hình mẫu nhiều
khả năng là cành cây của ảnh nền lọt qua, không phải nét của khung.

- **`npm run shot` thêm `--clip x,y,rộng,cao`** để chụp đúng một vùng. Không có nó thì một
  tấm 1450px thu vừa màn hình chỉ còn vài pixel cho nét viền, nhìn không phán được gì — mọi
  kết luận ở trên đều đến từ các ảnh cắt vùng chụp ở 2×.

## 0.55.0 — Hàng Đợi có tấm nền riêng

- **Trang Hàng Đợi Công Việc đổi sang「Tử Linh Tiên Tử」** (`public/backdrop-hang-doi.png`),
  các trang khác giữ nguyên「Nam Cung Uyển dưới trăng」. Đây là lần đầu một trang mang nền riêng,
  nên nó cũng là lần đầu cần một cơ chế cho việc ấy.
- **Cơ chế là MỘT luật CSS, không phải JS.** Trang đánh dấu `data-backdrop="hang-doi"` trên
  `<main>`, và `body:has(...) .backdrop` đổi ảnh. Không chọn `usePathname` rồi gắn class vì tấm
  nền là thứ được vẽ sớm nhất trên trang — một quyết định chạy sau hydrate thì luôn đến sau
  nước sơn đầu tiên, tức người dùng thấy nền cũ loé lên rồi mới bị thay.
- **`:has()` là selector ĐỘNG, và đó là chỗ phải đo chứ không đoán.** `.backdrop` nằm trước
  `<main>` trong HTML (byte 2264 so với 4387), nên nếu trình duyệt tính kiểu lúc dấu chưa được
  phân tích thì nó tải tấm mặc định rồi mới đổi — 2MB thừa cộng một cú nháy. Dựng sân thử riêng
  đúng hình dạng DOM ấy: gửi tài liệu một cục thì chỉ tải MỘT tấm, cắt làm hai với 300ms ở giữa
  thì tải CẢ HAI. Trang thật gửi một cục (production: 17,5KB, TTFB 1,628s, tổng 1,631s — chênh
  2,5ms), và đo lại trên trang thật thì đúng một tấm được tải ở cả desktop lẫn mobile.
  - Nó gửi một cục vì trang không có `loading.tsx`, mà đó lại chính là chủ ý đã ghi sẵn trong
    `hang-doi/page.tsx`. Hai chủ ý ấy giờ đứng chung một chỗ trong chú thích, không phải trùng hợp.
- **Phép pan tranh trên mobile không phải đụng tới**: tấm mới đúng bằng 1672×941 như tấm gốc,
  nên `width: calc(100lvh * (1672 / 941))` vẫn khớp — đo lại trên máy: 1443×812, tỉ lệ 1,7771.
- **Màu lót đi theo ảnh**: `#050d20`, đo ở dải mép trái của chính tấm mới, cùng lẽ với `#060b1a`
  của tấm gốc. Nó là thứ hiện ra trong tích tắc ảnh chưa tải xong và ở tỉ lệ màn hình cực đoan.
- Đã kiểm cả đường điều hướng phía client — bấm「Hàng Đợi」rồi bấm「Auto」quay lại thì nền đổi
  đúng cả hai chiều, không phải tải lại trang.

## 0.54.0 — nút Ngắm Tranh: làm mờ cả trang để nhìn rõ tấm nền

- **Một nút tròn ở góc trên bên phải, có mặt trên MỌI trang** (kể cả cửa đăng nhập và trang bái
  sư — nơi tấm tranh lộ ra nhiều nhất). Bấm một cái là cả trang mờ xuống còn **12%**, đủ để ngắm
  trọn mặt trăng và mái chùa sau những tấm thẻ đục nhất. Bấm lại, hoặc gõ **Esc**, là trở về.
- **CHỈ MỜ, KHÔNG GIẤU** — và đó là cả yêu cầu, nên nó được đóng đinh bằng phép thử: không
  `display:none`, không `visibility:hidden`, không `pointer-events:none`. Nội dung vẫn ở đó, vẫn
  đọc được lờ mờ, và vẫn **bấm được** (đo tận nơi bằng `elementFromPoint`).
- Cách làm: một thuộc tính `data-peek` trên `<body>`, rồi **một** luật CSS làm mờ mọi con trực
  tiếp của body trừ tấm nền và chính cái nút. Chọn đường ấy thay vì bọc nội dung trong một thẻ
  có `opacity` vì hai lẽ: nút phải nằm NGOÀI vùng mờ (bọc rồi đặt nút bên trong là tự làm mờ
  luôn đường quay lại — người dùng kẹt trong một trang 12% không còn gì để bấm), và thanh đầu
  trang / nội dung / chân trang vốn là ba con riêng của body nên một luật phủ trọn cả ba, phủ
  luôn trang nào thêm vào sau này.
- **KHÔNG lưu lại lựa chọn.** Đây là cử chỉ nhất thời — liếc nhìn tấm tranh rồi thôi. Lưu vào
  localStorage thì hôm sau người ta tải trang và thấy cả web mờ tịt, và thứ đầu tiên họ nghĩ là
  web hỏng chứ không phải "à mình đang bật chế độ ngắm".
- Thanh đầu trang **chừa chỗ** ở mép phải (`--peek-gutter`) thay vì nút đi né nó. Bản đầu làm
  ngược lại — ghim nút ngay dưới thanh ấy theo một con số `top` đoán theo chiều cao — và **đo ra
  là sai**: ở khung 375px cụm menu XUỐNG DÒNG, cao tới 221px, nên nút rơi trúng giữa hàng nút.
  Chiều cao hàng menu co giãn theo cả bề rộng màn lẫn số mục (khách thấy 2, Gia chủ thấy 6), nên
  mọi con số đoán trước đều là bẫy chờ đúng người mở trúng. Sau khi đổi chiều: **0/6 mục bị che**
  ở 375px, **0/2** ở desktop.
- CSS của tính năng nằm ở `src/app/peek.css` chứ không nhập vào `globals.css`, vì lý do rất trần
  tục: lúc viết, `globals.css` đang mang phần sửa chưa commit của một phiên khác.

## 0.53.0 — vá ba lỗ bảo mật: XSS lưu trữ trong sảnh, nhãn tệp do client khai, và cửa cron mở

Một lượt rà soát cả website. Ba lỗ tìm được, vá cả ba; thứ tự dưới đây theo mức nguy hiểm.

- **XSS LƯU TRỮ trong Phòng Chat — nặng nhất.** `z.string().url()` của Zod **NHẬN**
  `javascript:alert(1)`, `data:text/html,<script>…</script>` và `vbscript:` — đo được, không
  phải suy đoán. Mà bong bóng tin vẽ mọi đính kèm thành `<a href={url}>`, nên **bất kỳ môn đồ
  nào** cũng chỉ cần POST thẳng vào `/api/chat` một đính kèm mang `javascript:` là gài được mã
  chạy **trên chính tên miền của tông môn**, trong trình duyệt của người bấm vào — kể cả một
  Trưởng môn. Cookie phiên là `httpOnly` nên không đọc trộm được, nhưng mã ấy gọi được mọi
  action/API dưới danh nghĩa nạn nhân, và đó đã là chiếm quyền.
  - Vá bằng danh sách **CHO PHÉP** (`https:`), không phải danh sách cấm: một lược đồ lạ mai kia
    mặc định nằm ngoài, chứ không mặc định lọt vào. Mọi URL hợp lệ của hệ thống đều là https.
  - **Hai lớp**: server chặn lúc GHI, client chặn lúc VẼ. Lớp thứ hai không thừa — nó phủ cả
    những tin đã nằm trong kho từ trước khi có lớp thứ nhất; đính kèm không an toàn hiện thành
    chữ chết「đính kèm không hợp lệ」, không có gì để bấm.
- **Nhãn tệp đính kèm do CLIENT khai.** `/api/chat/upload` chép thẳng `file.type` xuống object.
  Bucket công khai đọc, nên một môn đồ tải lên tệp HTML tự khai `text/html` (hoặc SVG có
  `<script>`) là có ngay một trang web của họ chạy trên `objectstorage.…oraclecloud.com` — một
  tên miền nghe rất chính danh để dựng trang lừa. Nhãn giờ do **BYTES** quyết định: soi ra ảnh
  thì giữ nhãn ảnh thật (bong bóng vẫn vẽ `<img>` như cũ), còn lại ra `application/octet-stream`
  kèm `Content-Disposition: attachment` — trình duyệt tải xuống thay vì dựng trang. PDF, zip,
  tài liệu vẫn gửi bình thường. Cùng phép soi đã dùng cho ảnh đại diện từ 0.45.0.
- **`/api/cron` mở cho cả Internet.** Route cho qua khi `user-agent` chứa chữ "vercel-cron" —
  mà header thì do client đặt, nên một dòng `curl` là chạy được vòng quét. Hậu quả có giới hạn
  (hai việc đều idempotent, chỉ đụng thứ vốn đã quá hạn) nhưng đó vẫn là một cửa mở và một
  đường bào tài nguyên. Giờ **bắt buộc** `Authorization: Bearer CRON_SECRET`, so bằng
  `timingSafeEqual`, và **fail closed** khi chưa đặt biến. Vercel Cron tự gắn header ấy khi
  project có `CRON_SECRET` — đã xác nhận biến này có trong môi trường Production.
- Siết thêm một nấc không tốn gì: `jwtVerify` khai rõ `algorithms: ["HS256"]`. Khoá đối xứng nên
  jose vốn đã chỉ nhận HS*, nhưng viết ra thì khoá luôn cửa nếu mai có ai đổi sang khoá bất đối
  xứng mà quên rằng phép xác minh đang mở cho mọi thuật toán khoá ấy hỗ trợ.
- Những chỗ đã soi và **KHÔNG** thấy vấn đề, ghi ra để lần sau khỏi soi lại: phiên (cookie
  `httpOnly`+`secure`+`sameSite=lax`), mật khẩu (bcrypt cost 12), linh phù khôi lỗi
  (`timingSafeEqual`, hash SHA-256, fail closed), phong bì cookie game (AES-256-GCM, IV mới mỗi
  lần), IDOR tài khoản game (mọi câu ghi đều kèm `userId` trong bộ lọc), tiêm NoSQL (mọi tham số
  vào Mongo đều bị `String()` ép kiểu nên không lọt được toán tử), tiêm SQL (Drizzle tham số
  hoá), và không có `dangerouslySetInnerHTML` hay `eval` nào trong mã nguồn.
- `verify:chat` thêm mục chặn lược đồ URL; `verify:media` thêm mục nhãn-theo-bytes chạy **thật
  trên OCI**: HTML tự khai là `anh.png` vẫn ra octet-stream + ép tải xuống, PNG thật giữ
  `image/png` và KHÔNG bị ép tải (nếu không thì mọi ảnh trong sảnh biến thành link tải).

## 0.52.1 — thẻ Khung Tag dời sang tab Đàm Đạo, và sổ khung về một nguồn

- **Thẻ「Khung Tag」chuyển từ tab Môn Đồ sang tab Đàm Đạo**, đứng giữa hạn lưu và nút thanh
  tẩy. Khung là chuyện của Phòng Chat nên nó ở cùng chỗ với mọi núm khác của Phòng Chat; thứ
  tự trong tab theo mức nguy hiểm, thứ không có đường lui đứng cuối.
- Đây KHÔNG phải một cú cắt-dán, và chỗ đó là phần đáng kể của bản vá: thẻ ấy đang là **nguồn
  nuôi chip tag** trong hộp Sửa (tab Môn Đồ) qua `onFramesChange`. Hai tab là hai nhánh cây
  khác nhau, nên dời thẻ đi là đứt dây — chip sẽ lặng lẽ đông cứng ở bộ mặc định.
- **Sổ khung nay đi vào bằng PROP từ trang** thay vì mỗi bên tự `fetch`. Trang admin (server
  component) vốn đã đọc `getAppSettings()` để lấy hạn lưu, nên sổ nằm sẵn trong tay — truyền
  xuống cả `TagFrameManager` lẫn `UserTable` là xong. Chọn cách này thay vì cho mỗi bên tự
  fetch vì `AdminTabs` chỉ bật `hidden` chứ không unmount: hai bản sao sẽ LỆCH NHAU thật —
  thêm khung ở tab này, sang tab kia vẫn thấy danh sách cũ nằm nguyên đó.
- Sau mỗi lần ghi thì `router.refresh()`. Route đã `revalidatePath("/admin")` từ đầu nhưng một
  route handler không tự làm client vẽ lại (khác server action), nên lời gọi ấy trước nay
  không có tác dụng gì; giờ nó mới thật sự dùng được.
- **Gỡ `GET /api/admin/tag-frames`** — không còn ai gọi, và một endpoint đọc song song với
  prop của trang là một đường thứ hai tới cùng dữ liệu, thứ chỉ chờ ngày trả lời lệch nhau.
- Nút bị khoá tới khi server vẽ lại XONG (`sending || refreshing`), không chỉ tới khi `fetch`
  xong — giữa hai mốc ấy danh sách trên màn hình vẫn là sổ cũ.
- **`npm run shot` thêm `--click`** để chụp được giao diện có TAB (tab là state client nên URL
  không chở tới đó được): `npm run shot -- --path admin --click "text=Đàm Đạo"`.
- Kiểm trên trình duyệt thật, gồm cả phép thử đắt nhất: thêm một khung ở tab Đàm Đạo thì chip
  bên tab Môn Đồ **tự mọc theo (5 → 6)** rồi gỡ ra là cả hai về lại 5 — đúng cái sẽ hỏng nếu
  chỉ cắt-dán. Sổ sau đó về đúng 5 khung, không sót rác.

## 0.52.0 — thu hồi hai cột vai di sản, và ba phép thử đỏ kinh niên

Nửa sau của 0.48.0: `user_roles` đã cầm sự thật trọn một nhịp deploy, giờ dọn nốt gương.

- **`users.role`, `users.roles` và enum `user_role` đã bị drop** (migration `0014`). Bảng
  `users` không còn cột vai nào — vai là một quan hệ, và chỉ có một chỗ trả lời nó.
- **Thứ tự thu hồi NGƯỢC với thứ tự mở rộng, và nhầm chiều là hỏng thật.** Thêm cột thì migrate
  trước, deploy sau (bản cũ chưa biết cột mới). Bỏ cột thì **deploy trước, migrate sau** — bản
  cũ còn *ghi* vào cột ấy, drop sớm là mọi lượt sửa người văng lỗi cho tới khi deploy xong.
- **`0014` mở đầu bằng một chốt chặn, không xoá thẳng.** Nó đếm số đạo hữu còn vai trong cột
  gương mà chưa có dòng nào trong `user_roles` rồi `RAISE EXCEPTION` nếu còn ai — vì với đúng
  những người ấy, cột sắp bị xoá là bản DUY NHẤT còn giữ vai của họ, và một câu `DROP COLUMN`
  thì không có nhật ký nào cả. Đây chính là khe hẹp mà 0.48.0 đã ghi lại: bản code cũ đổi vai
  trong khoảng giữa migrate và deploy. Đã đo trước khi chạy: 0 người.
- **Đường ĐĂNG NHẬP còn đọc cột di sản, và suýt bị bỏ quên.** `loginAction` đặt claim phiên từ
  `user.role` trong khi đường bái sư ngay cạnh đã soi xuống từ vai thật — hai đường sinh đôi,
  một đường bị bỏ lại. Chỗ tệ nhất để một cột sắp bị drop còn được hỏi tới.
- **Ba phép thử đỏ quanh năm mà không ai biết, nay xanh thật:**
  - `verify:membership` so `PublicUser.role` — cột chưa bao giờ có ở đó, nên phép so luôn là
    `undefined === "user"`, tức nó không gác gì suốt từ lúc vai thành một TẬP HỢP.
  - `smoke` có hai check dò NGUYÊN VĂN `user.role === "admin"` trong mã nguồn. Chúng vẫn kêu
    "thiếu hàng rào" trong khi hàng rào có thật, chỉ là đã đổi tên thành `isAdminUser`. Một
    phép thử dò nguyên văn nguồn phải được sửa cùng nhịp với nguồn, nếu không nó chỉ là tiếng ồn.
- `PublicUser` giờ **cộng** `roles` vào chứ không `Pick` ra từ `UserRow`. Đó là chỗ tsc canh
  giúp: thêm một đường đọc người mà quên phép ghép từ `user_roles` thì không biên dịch được,
  thay vì lặng lẽ trả về một Gia chủ không mang vai nào.
- `db:seed`, `db:reset-password`, `dev:session` cũng thôi đọc/ghi hai cột ấy.

## 0.51.0 — `npm run shot`: tự chụp được trang, và bài vị hết bé tí

- **`npm run shot -- --path chat --out anh.png`** — chụp ảnh một trang của web đang chạy dưới
  máy, kể cả trang sau cửa đăng nhập (ký phiên như `dev:session`, không ai gõ mật khẩu).
  Dùng `playwright-core` + bộ Chromium đã có sẵn trong repo cho quest-engine, nên **không
  thêm một dependency nào**.
  - Vì sao cần: Browser pane của Claude Code chỉ dựng frame khi nó ĐANG HIỂN THỊ. Pane ẩn thì
    `screenshot` hết giờ, ảnh `loading="lazy"` không bao giờ tải, `img.decode()` treo — tức
    mọi lượt kiểm bằng MẮT đều phải nhờ tay người mở pane. Chromium do chính script khởi động
    thì luôn dựng frame, dù không ai nhìn.
  - Chụp ở `deviceScaleFactor: 2` để soi được chữ nhỏ; đợi mọi ảnh `decode()` xong mới bấm
    máy; và **kể ra lỗi console/mạng** của trang — một tấm ảnh đẹp che được rất nhiều thứ hỏng.
  - Nhận cả `--path chat` lẫn `--path /chat`: Git Bash trên Windows tự bẻ đối số bắt đầu bằng
    `/` thành đường dẫn Windows (`/chat` → `C:/Program Files/Git/chat`), và script gỡ lại.
- **Bài vị tăng 44px → 92px, chân dung 56 → 78px, chữ và khoảng thở lớn theo.** Cái sai không
  nhìn ra bằng `getComputedStyle`: tệp khung gốc 920×291 mang một QUẦNG SÁNG chiếm gần nửa
  khung ảnh, nên chiều cao CSS không phải chiều cao cái biển — ở 44px biển chỉ còn ~26px và
  chữ khắc trên nó mờ tịt. Máy báo "44px, đúng như đã khai" và vẫn sai. `margin-block: -16px`
  thu lại phần quầng rỗng để dòng tên không bị đội cao.
- Bỏ dấu ✦ khi người nói đã có bài vị — bản thiết kế không có nó, và bài vị đã nói rõ thứ bậc.

## 0.50.1 — khung son 0.49.0 mới đổi MÀU ÁO, bản này đổi DÁNG KHUNG cho đúng thiết kế

- Đạo hữu đặt bản thiết kế cạnh 0.49.0 và nói thẳng: vẫn giống cũ. Đúng — lần trước chỉ tô
  lại màu trên bố cục cũ. Những thứ làm nên DÁNG của bản thiết kế thì còn thiếu cả, và bản
  này bù từng cái một:
  - **Bốn ngoặc góc** chữ L bằng tám dải gradient trên một element — không ảnh, không thêm DOM.
  - **Ấn ở đỉnh** thành SVG hai nhánh mây ôm một kim châm, thay cho một ký tự ❖ bé xíu; kèm
    viên kim châm nhỏ đậu cuối đường chỉ dưới header như trong hình.
  - **Mốc ngày là chữ trần canh phải** với đường chỉ mảnh chạy từ trái tới — 0.49.0 bọc nó
    trong một viên thuốc có viền, thứ không hề tồn tại trong bản thiết kế.
  - **Bong bóng bỏ viền**: cấu trúc đến từ chênh sáng của khối màu, không phải nét kẻ; và
    **mốc giờ dọn vào TRONG bong bóng, cuối dòng chữ**(「…thật đấy. 00:48」) bằng float phải
    kèm clearfix — câu ngắn thì giờ cùng dòng, câu dài thì nó lặn xuống góc phải đáy.
  - **Nút chữ「Truyền Âm」thành ấn tròn mũi tên**; khay chọn dời sang trái ô nhập (💬), kẹp
    file đứng cạnh nút gửi — đúng đội hình ba nút tròn của bản thiết kế.
  - Chân dung 56px nhỉnh hơn bài vị 44px một bậc, tên người nói mang font hiển thị serif,
    hàng tin thở rộng 18px.
- Đo trên trình duyệt thật (mongod nội bộ, đủ 5 nhân vật của bản thiết kế): 8 dải ngoặc góc,
  ấn SVG có mặt, ngày không viền + kẻ chỉ trái, bong bóng viền trong suốt, giờ float phải và
  ĐỨNG CÙNG DÒNG với câu ngắn, nút gửi 42px tròn — và gửi thật một tin bằng chính ấn mũi tên.

## 0.50.0 — ảnh đại diện động: WebP động và APNG được vào cùng GIF

- **Cả BA loại ảnh động đều giữ được phần động**: GIF, WebP động, APNG. Trước bản này chỉ GIF
  được miễn bước thu nhỏ; WebP động và APNG đi qua `canvas` nên về tới sảnh chỉ còn **khung đầu**
  — mất động mà không một lời báo nào, đúng loại thất bại tệ nhất.
- **Phép quyết định giờ ĐỌC BÊN TRONG TỆP, không tra `file.type`** — và đó là điểm cốt tử: một
  tấm WebP tĩnh và một tấm WebP động mang **đúng cùng một kiểu MIME**, nên `file.type` không bao
  giờ phân biệt nổi hai thứ ấy. `src/lib/media/animatedImage.ts` đi theo cấu trúc container:
  - GIF — ĐẾM số Image Descriptor, đi đúng theo chuỗi block. Quét thô byte `0x2C` là trúng cả dữ
    liệu pixel nén rồi báo động cho một tấm ảnh tĩnh.
  - WebP — cờ ANIM trong chunk `VP8X`, hoặc có chunk `ANIM`/`ANMF`.
  - APNG — có chunk `acTL` **nằm trước** `IDAT` đầu tiên. Đứng sau là APNG hỏng, và trình duyệt
    vẽ tệp ấy thành ảnh tĩnh — nên ta cũng gọi nó là tĩnh, không thì ta giữ nguyên bản một tệp mà
    người dùng vẫn thấy đứng im.
- **KHÔNG dùng `ImageDecoder`** dù API ấy trả lời sẵn `animated`/`frameCount`: Firefox chưa có
  nó, và một API vắng mặt sẽ khiến nhánh miễn trừ im lặng không chạy — người dùng Firefox mất
  phần động mà không hiểu vì sao. Thêm một lý do đo được: Chrome trả `animated: true` cho cả một
  tấm GIF **một khung** (container vốn có khả năng động), nên cờ ấy không dùng làm chuẩn được;
  con số đáng tin là `frameCount`. Đọc container cho cùng câu trả lời ở mọi trình duyệt.
- **Hệ quả tốt ngoài dự tính: GIF TĨNH giờ cũng được thu nhỏ.** Trước đây mọi tệp `.gif` đều đi
  nguyên bản, nên một tấm GIF tĩnh 5MB bị từ chối vì trần 2MB — dù chẳng có phần động nào để giữ.
  Giờ nó đi đường ảnh tĩnh: đo được 35 byte → 554 byte ở cỡ 1×1 (số nhỏ nghe ngược, nhưng ở cỡ
  thật thì đây là đường thu nhỏ), và không còn bị trần 2MB chặn.
- `image/apng` và `.apng` vào **bộ lọc hộp chọn tệp**. Thiếu chúng thì trình duyệt — vốn tra bộ
  lọc theo ĐUÔI — làm mờ luôn tệp `.apng` ngay trong hộp chọn, tức tính năng chết ở bước đầu
  tiên mà không có lời báo nào. Bắt được ca này ở vòng soát lại, không phải khi chạy.
- Tên tệp gửi kèm multipart thu về **một hằng số** không đuôi: route ảnh đại diện không đọc
  `file.name` một lần nào — nó suy đuôi thật từ bytes. Ba cái tên "đúng đuôi" trước đây chỉ tạo
  ảo giác rằng chúng quyết định điều gì.
- Trang Hồ Sơ **bỏ đoạn dẫn** dưới tiêu đề: mục ảnh đại diện và biểu mẫu ngay bên dưới đã tự nói
  hết những gì nó nói.
- `npm run verify:avatar` thêm mục đếm khung, chạy trên **sáu tệp ảnh THẬT** (dựng bằng canvas +
  phẫu thuật container rồi soi lại bằng `ImageDecoder` — cả sáu đều giải mã được), so từng tệp
  với `frameCount` mà trình duyệt đếm. Kèm phép cắt tệp ở **mọi vị trí** để chắc rằng tệp cắt cụt
  không làm hàm ném hay quay vòng.

## 0.49.0 — Phòng Chat khoác khung son, và tag thành BÀI VỊ có hoa văn

- **Sảnh đàm đạo đổi theo bản thiết kế mới**: khung viền vàng kép với ấn triện ở đỉnh, nền
  lam thẫm, mốc ngày canh phải, chân dung mang vòng kim quang, ô nhập thuôn tròn với hai nút
  tròn hai bên. Toàn bộ là CSS — không một ảnh nền nào phải tải thêm.
- **Tag giờ hiện thành KHUNG (bài vị hoa văn) cạnh tên** trong Phòng Chat. Sổ khung sống
  trong app_settings; bytes sống trong tàng khố media dưới tiền tố `tag-frames/` — CỐ Ý đứng
  ngoài `chat/`, vì nút thanh tẩy sảnh quét theo tiền tố và một bộ khung nằm lọt trong đó sẽ
  chết theo lần bấm. `verify:tag-frames` đóng đinh đúng điều này.
- **Luật chọn bài vị** (frameForTags, thuần và có phép thử): tag ĐỨNG TRƯỚC thắng — thứ tự
  tag là thứ admin sắp, không phải chỗ code chọn hộ; các tag còn lại vẫn là huy hiệu chữ;
  không tag nào có khung thì đeo khung MẶC ĐỊNH (bài vị「Đệ tử」— môn đồ thường cũng có bài
  vị, như trong bản thiết kế); sổ trống thì sảnh vẽ y như trước. So khớp bỏ hoa/thường và
  khoảng trắng thừa, nhưng DẤU tiếng Việt là luật cứng —「chuong mon」là một tag khác.
- **Trang Tông Môn có sổ Khung Tag** ngay dưới bảng môn đồ: xem, upload (nhãn + tệp + cờ
  mặc định), gỡ. Upload đi qua route chứ không phải server action — bài vị nặng ~2.8MB,
  vượt trần 1MB của action; cùng lý do với ảnh đại diện. Một nhãn một khung: trùng là 409,
  muốn thay thì gỡ trước — cho hai khung cùng nhãn thì phép so khớp phải chọn hộ, và nó sẽ
  chọn sai với một nửa số người nhìn.
- **Chip tag trong hộp Sửa mọc theo sổ khung**: upload khung「Hộ pháp」xong là chip「Hộ pháp」
  xuất hiện, không cần deploy. Sổ trống hay chưa tải xong thì chip rơi về bộ TAG_PRESETS cũ.
- **`npm run seed:tag-frames -- <thư mục>`** gieo bộ khung gốc (5 bài vị: Chưởng môn, Trưởng
  lão, Thái thượng trưởng lão, Thánh nữ, và Đệ tử làm mặc định) lên OCI rồi đăng ký vào sổ.
  Chạy lại vô hại; đã chạy thật — cả 5 URL công khai trả 200 và giải mã được (920×291…351).
  Không nhét 13MB webp vào `public/`: mỗi deploy sẽ chở ngần ấy cho những bytes không bao
  giờ đổi, trong khi kho media đã có sẵn và khung upload sau này cũng đi đường ấy.
- Sổ khung đi vào ChatRoom từ server render (một lần mỗi lượt tải trang), KHÔNG kẹp theo
  nhịp poll 2.5s — cấu hình đổi vài lần một năm không có cửa đòi ghế trên mọi hồi đáp.
- Kiểm chứng trên trình duyệt thật với mongod nội bộ (DNS SRV của Atlas hỏng ở máy dev):
  đủ 6 nhánh vẽ — 4 bài vị đúng người, không-tag đeo Đệ tử, tag lạ đeo Đệ tử kèm huy hiệu
  chữ — và trọn vòng API: upload 200, trùng nhãn 409, bytes công khai 200, gỡ 200/404, sổ
  không sót rác.

## 0.48.0 — vai và quyền thành bảng thật trong database

- **Ai mang vai nào giờ là một BẢNG (`user_roles`), không còn là cột mảng `users.roles`.** Quan
  hệ "một đạo hữu giữ nhiều vai" vốn là nhiều–nhiều, mà một cột `text[]` thì không nói được
  điều đó với database: không khoá ngoại, nên một mã vai gõ sai nằm im trong dữ liệu mà không
  gì kêu lên; không index, nên "còn mấy Gia chủ" phải quét cả bảng users; và không câu SQL nào
  hỏi được "ai đang mang vai này" mà không mở mảng ra.
- **Thêm ba bảng danh mục**: `roles` (mã, nhãn, thứ tự thang vai), `permissions` (mã, nhãn),
  `role_permissions` (vai nào mở được việc gì). Cùng migration `0013` di dân trọn dữ liệu cũ —
  đã đo trên database thật: 9 đạo hữu, 1 người mang vai, 2 dòng `user_roles`, không sót ai.
- **`permissions.ts` có bảng quyền, thay cho ba cách viết luật nằm ba nơi.** Trước bản này "ai
  được làm gì" rải rác: một danh sách vai bậc trị sự trong `isAdminUser`, một phép `isOwner`
  trong `canEditRoles`, và một phép `isOwner` nữa tận `purgeChatAction` bên actions. Giờ cả ba
  hỏi cùng một hàm `hasPermission`, và nút「Thanh tẩy」ở trang Tông Môn hỏi đúng câu mà hàng rào
  phía server hỏi — trước đó là hai phép kiểm giống nhau chép làm hai chỗ.
- **Ma trận chạy vẫn ở code, cố ý** — `isAdminUser` bị hỏi ở mọi request có phiên, và hàm thuần
  thì `verify:permissions` đóng đinh được từng ô không cần dựng gì. Ba bảng danh mục là bản sao
  để SQL đọc được; `npm run verify:roles` so từng dòng và **đỏ khi lệch**, nên "thêm quyền mà
  quên viết migration" hỏng ngay tại chỗ.
- **Phía bị quản đổi cách hỏi: `bearsAnyRole` thay cho `isAdminUser`.** Hôm nay hai phép ấy
  trùng kết quả (vai nào cũng là vai trị sự) nên không ô nào trong 100 ô actor×target đổi. Nhưng
  chúng trả lời hai câu khác nhau, và ngày có một vai thuần trang trí thì cách viết cũ lặng lẽ
  thả người mang vai ấy xuống hạng "quản được" — đúng loại lỗ hổng mà bậc Gia chủ sinh ra để bịt.
- **Hai lỗ tự tìm ra khi soi lại, không phải do ai báo:**
  - `npm run db:seed` chỉ ghi cột gương, tức một cài đặt MỚI sẽ dựng ra một Gia chủ mà hệ thống
    không nhìn thấy vai — sinh ra đã khoá trái, đúng thứ vai gia-chu tồn tại để phòng. Giờ nó
    ghi cả `user_roles` trong cùng một câu lệnh.
  - `npm run dev:session` cũng đọc cột gương, tức một lượt kiểm giao diện đang kiểm nhầm hệ
    thống.
- **`verify:profile` đỏ quanh năm mà không ai biết**: nó khẳng định `after?.role === "user"`
  trong khi `PublicUser` chưa bao giờ mang cột `role` — tức phép so luôn là `undefined === "user"`.
  Đổi sang hỏi `roles`, và giờ nó xanh thật.
- Cột `users.roles` và `users.role` còn nằm lại **một nhịp deploy** làm gương ghi-một-chiều:
  `db:migrate` chạy trước `vercel deploy`, nên trong khoảng giữa hai lệnh bản code cũ vẫn đang
  phục vụ và vẫn `select users.roles`. Drop sớm là toàn site 500 cho tới khi deploy xong.

## 0.47.1 — Vấn Đáp: đáp án trang viết ngắn hơn danh sách vẫn phải khớp

- **Bài vấn đáp của tài khoản VIP chết đứng ở mọi lượt** suốt hơn một giờ ngày 09/08/2026.
  Trang bày「Tất cả đáp án」, danh sách tham khảo ghi「Tất cả đáp án trên (ĐCT, VĐCK, ĐPTK)」;
  bỏ ghi chú trong ngoặc xong vẫn thừa đúng chữ「trên」, nên phép so khớp-tuyệt-đối trượt. Vì
  đó là **câu số một**, cả bài dừng ngay ở đó — không trả lời được câu nào.
  - Tài khoản thường bốc phải bộ câu khác nên trông vẫn chạy tốt. Bệnh KHÔNG phân biệt hạng,
    nó chỉ trông như vậy.
- **`matchOption` có nấc thứ ba**: một bên chứa trọn bên kia theo RANH GIỚI TỪ. Chỉ chạy sau
  khi hai nấc khớp-tuyệt-đối đều trượt, nên không câu nào đang tra được bị đổi kết quả; và chỉ
  trả lời khi ĐÚNG MỘT lựa chọn khớp — mơ hồ thì vẫn từ chối và dừng bài, vì trả lời sai tiêu
  mất một trong năm lượt của ngày. Ranh giới từ là chỗ giữ an toàn:「an」không chui được vào
 「khong」, và bốn lựa chọn trơ trọi A/B/C/D không khớp bừa vào giữa chữ.
- **Trước đó phải vá một điểm mù mới lần ra được nguyên nhân.** Khi bí đáp án, nhật ký chỉ nói
 「chưa biết đáp án: <câu hỏi>」— bốn lựa chọn trên trang, tức vế còn lại của phép so, không
  được ghi ở đâu cả. Giờ mỗi ngả thất bại tự khai ở mức `warning` (mức tới được `job_events`):
  câu không có trong danh sách / có nhưng không khớp lựa chọn nào — kèm CẢ đáp án công bố lẫn
  các lựa chọn trên trang / danh sách tự mâu thuẫn. Đường tra được thì im lặng như cũ.
  Chính dòng ấy chỉ đích danh chữ「trên」sau đúng một lượt chạy.
- `verify:quiz-reference` đóng đinh cả ba nấc trên nguồn THẬT (255 câu), cộng hai ca
  phải-từ-chối: hai lựa chọn cùng nằm trong đáp án, và lựa chọn một ký tự.

## 0.47.0 — bảng bế quan phủ MỌI trang, và không tắt được

- **Trong lúc bảo trì, môn đồ thường không vào được trang nào.** Mỗi trang trả về bảng「Tông môn
  đang bế quan trùng tu」kèm đồng hồ đếm ngược và lời nhắn của trưởng môn; **không có nút đóng**,
  và cả trang chỉ còn đúng một thứ bấm được là **Xuất Quan**. Trước bản này popup chỉ phủ trang
  Auto và đóng được bằng một nút — đóng rồi là đi lại khắp nơi bình thường.
- **「Ẩn một trang」KHÔNG PHẢI「không cho vào trang ấy」, và đây là chỗ trả giá của bản này.**
  Bản đầu làm theo cách dễ nghĩ nhất: layout gốc không vẽ `children`. Markup ra đúng như mong
  đợi — chỉ có bảng chắn, không một pixel nào của trang. Nhưng Next dựng đoạn trang **song song**
  với layout, nên nội dung `/dashboard` vẫn nằm nguyên trong flight payload: đo được ở **byte
  13945** của hồi đáp, trong khi markup sạch trơn. Tức là dữ liệu của đạo hữu vẫn rời khỏi
  server, và server vẫn làm trọn phần việc của trang cho một người sẽ không thấy gì.
- Nên phép chặn thật nằm ở **`redirect()` trong `requireUser()`** — dòng đầu tiên của mọi trang
  có guard, và nó kết thúc hồi đáp trước khi trang kịp dựng xong. Sau khi đổi, dấu vết nội dung
  Auto biến mất khỏi hồi đáp. `MaintenanceGate` ở layout gốc lo phần còn lại: vẽ bảng cho những
  trang KHÔNG có guard (trang chủ, cửa đăng nhập, trang bái sư) và vẽ dải nhắc cho ai đi qua được.
- **Hai ngoại lệ, và chúng là ĐIỀU KIỆN để chế độ bế quan còn tắt được** — không phải nương tay:
  - **Bậc trị sự đi qua tự do** (kèm dải nhắc mỏng trên đầu trang). Công tắc tắt bảo trì nằm
    TRONG trang Tông Môn của họ; dựng bảng chắn trước mặt họ là khoá trái căn phòng chứa chìa
    khoá của chính nó — đúng loại lỗi mà `permissions.ts` sinh ra để phòng.
  - **Khách chưa đăng nhập cũng đi qua.** Cửa đăng nhập là đường DUY NHẤT để một trưởng môn vừa
    hết phiên quay lại được với công tắc ấy. Khách vốn đã không vào được trang nào của thành
    viên nên chỗ này không mở thêm cửa nào — chỉ giữ cửa vào.
- **Hai đường đã thử và KHÔNG dùng được**, ghi ra để người sau khỏi đi lại:
  - *Proxy gắn đường dẫn vào header rồi layout đọc ra* (để layout tự `redirect()` mà không đẩy
    chính trang bế quan vào vòng lặp): `NextResponse.next({ request: { headers } })` **không**
    chuyển được header tới lượt dựng RSC trong Next 16.2 — đo trên cả `next dev` lẫn `next
    start`, proxy vẫn chạy (chuyển hướng khách khỏi `/dashboard` vẫn đúng) mà header không bao
    giờ tới. Vì thế cửa ở layout không biết mình đang ở đâu, và vì thế nó không tự chuyển hướng.
  - *`router.replace()` khi cửa mở lại*: nó đổi URL và đổi cả tiêu đề tab, mà **bảng chắn vẫn
    nằm nguyên trên màn hình** — Next TÁI DÙNG layout khi điều hướng phía client, chỉ tải lại
    đoạn trang đã đổi. Chỉ `router.refresh()` dựng lại được layout. Cũng chính vì lẽ đó mà
    `/be-quan` phải tự mang bảng chắn trong trang, cho đường vào bằng điều hướng client.
- **Nhịp soát `/api/maintenance` thay đường SSE cũ**: 10 giây khi đang bế quan, 60 giây khi mở,
  và **nghỉ hẳn khi tab bị ẩn** (tab bỏ quên cả ngày là cái tốn nhiều lượt gọi nhất mà không ai
  nhìn kết quả); quay lại tab thì hỏi ngay. Cờ bế quan vì thế rời khỏi payload của Auto — một
  đường push riêng cho đúng trang mà môn đồ không vào được nữa là đường không còn ai đi.
- `MaintenanceOverlay.tsx` của Auto bị xoá, cùng nhánh `maintenance` trong payload SSE và
  context của nó. Đồng hồ đếm ngược giữ nguyên luật cũ: quá hẹn thì nói「sắp xong」và ghim thanh
  ở 100%, tuyệt đối không đếm số âm.
- Giá phải trả, nói thẳng: **một câu hỏi `app_settings` cho mỗi lượt vẽ trang**, dùng chung giữa
  cửa và guard nhờ `cache()` của React. Phép đọc cấu hình đi TRƯỚC và cắt mạch khi cửa đang mở,
  nên đường đi thường ngày không thêm lượt đọc `users` nào.
- `npm run verify:maintenance` thêm mục kiểm phép quyết định thuần cho cả bốn vai, khách chưa
  đăng nhập, và một vai lạ không được nhận vơ quyền trị sự.

## 0.46.0 — thêm Thái thượng trưởng lão và Chưởng môn, cùng bốn tag bấm một cái là xong

- **Hai vai mới, quyền NGANG Trưởng môn**: `thai-thuong-truong-lao` và `chuong-mon`. Ba vai ấy
  giờ khác nhau ở danh xưng chứ không ở quyền — cùng duyệt môn đồ, cùng không đụng được người
  mang vai.
- Hệ quả đáng nói nhất, và nó KHÔNG hiển nhiên: **một Chưởng môn không sửa/xoá được một Chưởng
  môn khác**, cũng không đụng được Trưởng môn. Nghe vô lý cho tới khi nhớ ra vì sao vai Gia chủ
  tồn tại (0.43.0): hai người ngang quyền hạ được nhau thì cả bậc ấy chỉ an toàn tới lúc có
  người đổi ý. Thêm vai mới không phải là lý do để mở lại đúng cái lỗ hổng ấy.
- Vì「ngang admin」đi qua đúng một hàm `isAdminUser`, hai vai mới **thừa hưởng trọn gói mọi thứ
  admin có**: vào được trang Tông Môn, hiện ✦ trong Phòng Chat, và tắt được `capCheck` Mê Cung.
  Cái cuối là một luật GAME chứ không phải UI — ghi ra đây vì nó là thứ dễ quên nhất khi thêm
  một vai.
- **Không có migration nào.** `users.roles` là `text[]`, nên vai mới chỉ là giá trị mới; đây
  cũng là lý do mã vai giữ nguyên tiếng Việt không dấu thay vì đổi `gia-chu` → `owner` như dự
  tính ban đầu. Đổi mã là di dân dữ liệu, và giữa migrate với deploy sẽ có một cửa sổ Gia chủ
  mang mã cũ trong khi code đã đọc mã mới — tức không còn ai đổi được vai nữa. Một bảng mã đẹp
  hơn không đáng cái giá đó.
- **Tag bày sẵn**: Trưởng lão, Thánh nữ, Thái thượng trưởng lão, Chưởng môn — bấm chip là thêm,
  bấm lại là gỡ, và **vẫn gõ tag tuỳ ý như cũ**. Chip chưa chọn tự khoá khi đã đủ 3 tag, thay
  vì cho bấm rồi mới báo lỗi lúc Lưu.
- **Trần độ dài tag 20 → 24.**「Thái thượng trưởng lão」dài **22 ký tự**: dưới trần cũ, tông môn
  không thể lưu nổi cái tag mà chính họ muốn dùng, và lời từ chối thì không nói ra con số nào.
  `verify:permissions` nay soát「mọi tag bày sẵn phải lọt trần」— chính là phép thử sẽ bắt được
  ca này nếu ai đó thêm một tên dài hơn nữa.
- Ô tag chuyển sang cập nhật theo hàm (`setRaw(prev => …)`) và kiểm lại trần NGAY TRONG đó.
  Bắt được bằng phép đo trên trình duyệt thật: ba cú bấm rơi vào cùng một tick React thì cả ba
  cùng đọc một state cũ và chỉ cú cuối sống sót. Thuộc tính `disabled` chỉ chặn ở lượt vẽ.
- **Luật tag dọn sang `validation/tags.ts`, một tệp KHÔNG import gì cả.** Bản đầu để chúng
  trong `validation/user.ts` cho gọn — nhưng tệp ấy import `zod` và dựng schema ở cấp module,
  nên một component `"use client"` nhập một hằng số từ đó là gánh cả zod sang bundle trình
  duyệt. Tách ra là hết.
- Bảng môn đồ **vẽ huy hiệu và ô tick theo dữ liệu** thay vì gõ tay từng vai, nên thêm vai lần
  sau không phải sờ vào bảng nữa. Ba vai bậc trị sự dùng CHUNG màu huy hiệu — cố ý: màu nói về
  hạng quyền, còn chữ đã đủ phân biệt Chưởng môn với Trưởng môn.
- `verify:permissions` quét **trọn 100 ô actor×target** so với một bảng hạng viết tay (cố ý
  không hỏi `isAdminUser`, vì một oracle đi hỏi chính thứ đang bị kiểm thì gật đầu với mọi lỗi
  của nó), và chặn luôn đường「tự hạ xuống Chưởng môn」như một cửa sau để Gia chủ rời ngôi.

## 0.45.0 — mọi đạo hữu đặt được ảnh đại diện

- **Trang Hồ Sơ có mục「Ảnh đại diện」** — chọn một tấm PNG/JPEG/WebP/GIF, và nó hiện ngay cạnh
  tên trong Phòng Chat lẫn trên thanh đầu trang. Bỏ ảnh thì trở về vòng tròn chữ đầu như trước.
  Mở cho MỌI người đã đăng nhập, kể cả người còn trong hàng chờ hay đang bị đình quyền — cùng
  một luật với danh xưng và email ở ngay dưới, vì ảnh là danh tính chứ không phải đặc quyền của
  thành viên đã duyệt.
- **Ảnh được thu nhỏ NGAY TRÊN MÁY người dùng** về hình vuông cạnh 512px trước khi gửi. Một tấm
  từ điện thoại nặng 3–8MB và rộng 4000px, còn vòng tròn nó sẽ nằm trong rộng 34px: gửi nguyên
  bản là trả tiền đường truyền lẫn tiền lưu trữ cho phần không ai từng thấy, và phải nhét một
  thư viện xử lý ảnh vào function — trong khi `canvas` có sẵn trong mọi trình duyệt. Đo được ở
  một lượt kiểm: 800×600 (28,8 KB) → 512×512 WebP (8,1 KB). Cắt VUÔNG vì mọi chỗ hiển thị đều
  là vòng tròn `object-fit: cover`, tức trình duyệt vốn đã cắt giữa đúng thế lúc vẽ.
  - GIF động là ngoại lệ, đi nguyên bản: canvas chỉ vẽ được khung đầu, nên thu nhỏ một GIF động
    là lặng lẽ giết phần động của nó. Đổi lại nó phải tự dưới 2MB.
  - EXIF hướng ảnh được tôn trọng (`imageOrientation: "from-image"`), không thì ảnh dựng đứng
    từ điện thoại vào tới đây là nằm ngang.
- **Kiểu ảnh suy từ BYTES, không từ `file.type` mà client khai.** Bucket media công khai đọc,
  nên nhãn ta ghi lên object chính là nhãn cả thế giới nhận được khi tải nó về — và cái nhãn ấy
  là thứ DUY NHẤT ngăn trình duyệt hiển thị một tệp HTML như trang web trên một tên miền không
  phải của mình. `\x89PNG` thì không khai gian được. Chỉ nhận đúng bốn định dạng; HTML, PDF, BMP
  và cả WAV (`RIFF` nhưng không `WEBP`) đều bị trả về 415.
- **Đổi ảnh xoá ảnh cũ, trong một câu lệnh không có khe hở.** `setAvatar` ghi ảnh mới và trả về
  tên object CŨ bằng phép tự-join `from users prev` — ảnh chụp bảng trước khi ghi. Đọc-rồi-ghi
  thì hai tab cùng đổi ảnh sẽ cùng đọc ra một key cũ, và một trong hai ảnh mới thành object
  không ai trỏ tới, không ai biết để dọn. Thứ tự cũng có chủ ý: bảng trước, bytes sau — ngược
  lại là mọi nơi treo ảnh vỡ, còn theo thứ tự này thì cùng lắm một tệp mồ côi nằm im.
- **Key có hậu tố ngẫu nhiên chứ không phải `avatar/{userId}` cố định**, dù cố định thì khỏi cần
  cột `avatar_key`. Lý do: kho stamp `immutable, max-age=30 ngày` lên mọi object, nên một key
  bất biến nghĩa là trình duyệt còn giữ MẶT CŨ suốt một tháng sau khi đổi.
- **Ảnh KHÔNG bị đóng băng vào tin nhắn**, khác với tên và tag. Cả ba đều là "danh tính lúc
  nói", nhưng đổi ảnh là XOÁ object cũ: một URL đóng băng trong tin cũ sẽ thành ảnh vỡ ngay lần
  đổi đầu tiên, còn một cái tên đóng băng thì chỉ là chuỗi chữ, không hỏng đi được. `/api/chat`
  vì thế trả kèm một bản đồ `userId → URL`; phép tra ấy nằm ở ROUTE chứ không trong chat.ts, để
  tầng MongoDB vẫn không biết gì về Postgres.
- **Trục xuất một đạo hữu giờ quét cả ảnh của họ.** Cấu hình, job và nhật ký đi theo `on delete
  cascade` của schema, nhưng bytes trong OCI thì không có ràng buộc nào biết tới — chúng là thứ
  duy nhất của một thành viên không nằm trong Postgres. Quét theo TIỀN TỐ nên dọn luôn những ảnh
  cũ mà một lần đổi ảnh trước đây có thể đã không xoá được. Quét trượt thì KHÔNG làm lượt trục
  xuất thất bại — người ấy đã rời tông môn thật rồi.
- Vòng tròn danh tính về MỘT bản dùng chung (`components/Avatar.tsx`) cho thanh đầu trang, trang
  Hồ Sơ và sảnh đàm đạo; `initialOf`/`hueOf` thôi nằm riêng trong ChatRoom.tsx. Lớp CSS
  `.chat-avatar` đổi tên thành `.avatar`.
- `npm run verify:avatar` — soi bytes, đặt tên object, vòng đời trong bảng (đặt → đổi → bỏ),
  và vòng đời thật trên kho OCI kể cả phép quét ảnh mồ côi.

## 0.44.3 —「Linh Đài」thành「Auto」

- Nhãn nav, tiêu đề tab và tiêu đề trang của bàn làm việc đổi thành **Auto**.
- Đổi cả những câu văn GỌI TÊN nó, không riêng cái nút: lời chào ở trang đăng nhập
  ("trở lại Auto"), thẻ giới thiệu ngoài trang chủ, lời ở phòng chờ, popup bảo trì, dòng mô
  tả công tắc xét duyệt, và lời nhắc của `db:reset-password`. Đổi mỗi nhãn nav thì phần còn
  lại chỉ người dùng tới một trang không còn tên ấy.
- Giữ nguyên **`"Auto HH3D — Linh Đài Tự Động"`** ở `layout.tsx`: đó là khẩu hiệu của cả
  site chứ không phải tên trang — "Auto Tự Động" thì vô nghĩa. Đây là quyết định có cân
  nhắc, không phải sót.
- CHANGELOG giữ tên cũ như mọi lần: sử sách không viết lại.

## 0.44.2 — chân trang ký tên đạo hữu, không ký tên hoa

- Chân trang đổi từ `© 2026 Bảo Hoa tiên tử` thành **`© 2026 Nam Cung Bình`**. Cái tên cũ vào
  đó từ bản 0.5.x là vì lúc ấy nó đang là chủ đề của cả trang chủ — mưa cánh hoa lấy tên nàng,
  nên chân trang cũng ký theo. Nhưng dòng ấy là dòng **bản quyền**, và bản quyền phải ghi người
  giữ nó, không phải ghi cảm hứng thẩm mỹ của trang.
- Mưa cánh hoa vẫn là **bảo hoa** và trong `page.tsx` / `globals.css` vẫn ghi rõ nguồn gốc cái
  tên ấy — đổi chân trang không phải là xoá xuất xứ của hiệu ứng.

## 0.44.1 — dọn xác hai kho đã đóng

- Kho **Vercel Blob** và **Upstash Redis** đều đã bị xoá khỏi Vercel, nên mọi thứ chỉ còn sống
  vì chúng nay là mã chết: dependency `@vercel/blob` + `@upstash/redis`, và hai script chuyển
  kho `migrateBlobToOci.mts` / `migrateChatToMongo.mts`.
- Giữ lại một script chỉ chạy được với một kho không còn tồn tại là **giữ một cái bẫy**: người
  đọc sau sẽ tưởng còn đường lui, chạy thử, rồi nhận `This store does not exist`.
- `verify:media` bỏ hai nhóm kiểm phép sửa URL — chúng kiểm chính đoạn code vừa xoá. Nhóm còn
  lại (đặt tên, URL công khai, ranh giới cấu hình, vòng đời thật trên OCI) không đổi, và
  `mongodb-memory-server` cũng rời script này vì nó chỉ phục vụ hai nhóm ấy.
- Mục 6 của [deploy/mongodb.md](deploy/mongodb.md) viết lại thành ghi chú lịch sử thay cho
  hướng dẫn chạy một script không còn ở đó.
- Media giờ chỉ còn MỘT nhà: OCI Object Storage (`jarvis-media`). Xem
  [deploy/oracle/README.md](deploy/oracle/README.md).

## 0.44.0 — nút thanh tẩy sảnh đàm đạo: xoá sạch tin VÀ bytes đính kèm, trong một lần bấm

- **Tab Đàm Đạo của trang Tông Môn có thêm thẻ「Thanh Tẩy Sảnh Đàm Đạo」** — xoá toàn bộ tin
  khỏi MongoDB và quét sạch mọi tệp đính kèm khỏi OCI Object Storage. Trước bản này, hạn lưu
  là đường DUY NHẤT để tin biến mất, mà hạn lưu thì tính theo ngày: muốn dọn sạch ngay thì
  phải vào tận Atlas và OCI console mà xoá tay — hai nơi, hai lần đăng nhập, và không có gì
  bảo đảm ai đó nhớ làm nốt nửa thứ hai.
- **Xoá bytes đi theo TIỀN TỐ `chat/`, không theo URL đọc từ tin nhắn.** Hai lý do, và cả hai
  đều từng là lỗ thật:
  - Tệp đã tải lên nhưng người gửi đổi ý không bấm gửi thì KHÔNG tin nào nhắc tới nó — đi
    theo tin nhắn là bỏ chúng nằm lại trả tiền lưu trữ mãi mãi.
  - Tin bị xoá TRƯỚC bytes (cố ý — xem dưới), nên tới lượt quét bytes thì URL đã không còn
    tồn tại để mà đi theo. Tiền tố thì vẫn còn đó, nên một lần quét trượt giữa chừng chỉ cần
    bấm lại là dọn nốt.
- **Thứ tự tin trước, bytes sau là một lựa chọn, không phải tình cờ.** Hỏng nửa chừng là
  chuyện phải tính tới, nên câu hỏi thật là "hỏng nửa nào thì đỡ đau hơn": quét bytes trước
  rồi tin ngã ngựa ⇒ cả sảnh treo đầy ảnh vỡ, ai cũng thấy; xoá tin trước rồi bytes ngã ngựa
  ⇒ vài tệp mồ côi nằm im, không ai thấy, và lần bấm sau dọn nốt.
- **Chỉ Gia chủ mở được cửa này.** Cùng mạch lý lẽ với「thu hồi chỉ của chủ tin」ở 0.43.0: để
  một Trưởng môn xoá trắng lịch sử đàm đạo của cả tông môn thì sảnh chung thành thứ ai cầm
  quyền nấy viết lại. Trưởng môn thường vẫn THẤY thẻ ấy kèm lời giải thích — một cái nút biến
  mất không tự giải thích được chính nó.
- **Phải gõ tay「XOA HET」thì nút mới sáng**, và server soát lại đúng câu ấy. Câu không dấu là
  cố ý: một nút xoá sạch không thể phụ thuộc vào việc bộ gõ tiếng Việt có đang bật hay không.
  Hàng rào này không chống kẻ gian (kẻ gian đã qua được hàng rào vai thì gửi thẳng chuỗi ấy)
  mà chống chính mình lúc bấm nhầm — nhưng nó vẫn phải gác ở server, vì một action xoá sạch
  không nên gọi được bằng một cú POST trống.
- **`npm run verify:chat-purge`** — chạy thật trên một mongod trong tiến trình VÀ trên OCI
  thật. Phép thử quan trọng nhất trong đó: đặt một object NGOÀI tiền tố rồi soát xem nó còn
  nguyên sau lượt quét. Một phép quét rộng hơn ý định sẽ không báo lỗi gì cả — nó chỉ lặng lẽ
  xoá nhiều hơn mức đáng xoá rồi báo thành công.
  - Phép thử ép `MaxKeys=1` để **đường phân trang chạy thật** với ba object thay vì phải dựng
    đủ một nghìn; nhờ vậy biết chắc OCI có trả `NextContinuationToken` dùng được, chứ không
    phải tin rằng nó giống S3.
  - Nó **KHÔNG** chạm vào tiền tố `chat/` của kho đang dùng: tự dựng tiền tố tạm mang dấu thời
    gian rồi quét chính mình. Muốn soi luôn `purgeChatMedia()` thì đặt `CHAT_PURGE_TEST_BUCKET`
    trỏ sang một bucket bỏ đi.
- **Xoá từng object một, KHÔNG dùng `DeleteObjects` (xoá gộp 1000 key).** Lớp tương thích S3
  của OCI không kể lệnh gộp trong danh sách hỗ trợ, còn `DeleteObject` thì đã được
  `verify:media` chạy thật trên kho thật từ 0.41.0. Chậm hơn một chút, đổi lấy việc chắc chắn
  chạy — và tám lệnh chồng nhau lấy lại phần lớn khoảng chênh ấy.

## 0.43.3 —「Nhiệm vụ VIP/Thường」thành「Tài khoản VIP/thường」,「Lư Khai Đàn」thành「Tế đàn auto」

- Hai tab trong Ngọc Giản Cấu Hình đổi nhãn thành **Tài khoản VIP** / **Tài khoản thường** —
  đúng hơn với thứ chúng chia: hai tab ấy chọn theo HẠNG TÀI KHOẢN, không phải theo nhiệm vụ.
- Thẻ điều khiển đổi tiêu đề thành **Tế đàn auto**.
- Đổi luôn mọi chỗ CÒN TRỎ tới tên cũ, không riêng hai dòng trong ảnh: dòng nhật ký của engine
  chỉ người dùng sang "tab Nhiệm vụ Thường", mục hướng dẫn trong HUONG-DAN.md, và các chú
  thích gọi thẻ ấy là "Lư Khai Đàn". Một cái tên đổi nửa vời thì phần còn lại chỉ người đọc
  tới một chỗ không còn tồn tại.
- Dòng nhật ký được viết lại cho khỏi lặp: "…dùng các flow riêng **ở tab cùng tên**" thay vì
  nhắc "Tài khoản thường" hai lần trong một câu.
- **Bản PC không đụng tới**: tab bên ấy vẫn tên「Nhiệm vụ VIP/thường」và các dòng log của nó
  trỏ đúng vào tab của chính nó — sửa một bên sẽ làm bên kia nói sai về giao diện của mình.
  CHANGELOG cũng giữ nguyên tên cũ: sử sách không viết lại.

## 0.43.2 — `dev:session`: xem được trang sau cửa đăng nhập mà không ai gõ mật khẩu

- **`npm run dev:session`** phát một cookie phiên ngắn hạn (30 phút) cho một đạo hữu bất kỳ,
  ký bằng chính `AUTH_SECRET` như `createSession()` — dán vào console trình duyệt là vào được.
  Mọi trang đáng xem đều nằm sau `requireActiveUser()`, nên kiểm chứng bằng mắt luôn vướng
  một bước đăng nhập; đường này gỡ đúng chỗ vướng ấy mà không đụng tới mật khẩu của ai.
- Nó cũng làm được thứ mật khẩu KHÔNG làm nổi: **đóng vai bất kỳ ai mà không cần biết mật
  khẩu của họ**. Muốn kiểm ma trận quyền cho đúng thì phải nhìn cùng một trang bằng mắt Gia
  chủ, mắt Trưởng môn thường và mắt môn đồ — ba người, ba mật khẩu không ai biết.
- Hạn 30 phút là **cố ý**: `AUTH_SECRET` dưới máy chính là secret của production, nên token
  phát ra ở đây dùng được cả trên production. Script không mở thêm cửa nào — ai cầm
  `AUTH_SECRET` thì vốn đã ký được phiên — nhưng nó khiến việc đó tiện, và tiện thì dễ buông
  tay, nên token lỡ lọt ra chỉ sống được ít phút.

## 0.43.1 — script và `next dev` thôi bất đồng về biến môi trường

- **`loadEnv()` đọc CẢ `.env.local` lẫn `.env`**, theo đúng thứ tự ưu tiên của Next (tệp
  trước thắng). Trước đó nó chỉ đọc `.env`, mà `vercel env pull` thì ghi vào `.env.local` —
  nên sau khi kéo biến về, `next dev` thấy đủ kho còn `npm run verify:media` vẫn một mực báo
  「kho chưa khai mở」. Cùng một máy, cùng một lúc, hai câu trả lời trái ngược, và không có gì
  trên màn hình gợi ý vì sao. `MONGODB_URI`, `OCI_*` và `GIPHY_API_KEY` đều chỉ sống ở
  `.env.local` nên cả ba kho cùng dính.
  - Bằng chứng cái bẫy là thật, không phải phòng xa: `verifyRealtimeSse.mts` đã tự vá tay
    bằng một dòng `loadEnv(".env.local")` thừa ra. Nay dọn — sửa ở gốc thì bản vá tay hết việc.
- **`npm run env:pull`** — một lệnh cho việc ấy, thay vì phải nhớ cú pháp `vercel env pull`
  kèm đúng môi trường. Kèm một mục trong README giải thích hai tệp env và vì sao thiếu bước
  này thì hệ thống KHÔNG gãy mà chỉ treo biển「chưa khai mở」 — nghĩa là một máy quên chạy nó
  trông y hệt một máy đã cài đúng.
- **`db:migrate` in ra database nó sắp sửa**, trước khi sửa. Đổi thứ tự nạp env ở trên có
  nghĩa là hai tệp lỡ trỏ hai nơi khác nhau thì cái được chọn không hiện ra ở đâu cả, mà
  migration chạy nhầm database là loại sai lầm không có nút hoàn tác.
  - Bản đầu của chính dòng in ấy **làm rò mật khẩu database** và bị bắt lúc tự soi lại:
    `new URL()` ném TypeError mang nguyên chuỗi kết nối trong thuộc tính `input`, và Node in
    thuộc tính ấy ra khi lỗi không được bắt. Đo thật, thấy mật khẩu trên màn hình. Tệ hơn:
    `neon()` ở ngay dưới cũng viết thẳng `Connection string: <nguyên văn>`. Nên chuỗi hỏng
    giờ bị chặn NGAY tại script với một lời báo không kèm giá trị — đã đo lại: 0 lần rò.

## 0.43.0 — vai Gia chủ, thu hồi chỉ của chủ tin, tag trang trí, và「linh sứ」thành「khôi lỗi」

- **VÁ LỖ HỔNG: thu hồi tin của người khác.** Trước bản này admin thu hồi được tin của BẤT KỲ
  ai — và tệ hơn, có một phép thử bảo chứng điều đó như một tính năng. "Thu hồi" nghĩa là TÔI
  rút lời TÔI; để người khác rút được lời của bạn thì lịch sử đàm đạo thành thứ ai cầm quyền
  nấy viết lại. Giờ quyền sở hữu nằm NGAY TRONG bộ lọc của câu update (`userId: viewer.id`,
  không nhánh, không tham số role) — admin lẫn Gia chủ đều bị từ chối như nhau, và phép thử
  đảo chiều: nó gác việc admin KHÔNG thu hồi được, kèm kiểm tin còn nguyên vẹn sau cú hụt.
- **Vai mới「Gia chủ」(gia-chu) — và lý do nó phải tồn tại**: các Trưởng môn ngang quyền sửa
  role hay trục xuất được LẪN NHAU, nghĩa là admin nào cũng chỉ an toàn cho tới khi một admin
  khác đổi ý. Giờ: chỉ Gia chủ sửa/xoá được người mang vai; Trưởng môn quản môn đồ thường
  thôi — và "không đụng được admin khác" bao trùm CẢ đổi trạng thái lẫn sửa hồ sơ, vì đình
  quyền một admin cũng chính là vô hiệu hoá họ, chỉ là bằng cửa khác. Đổi VAI (kể cả thăng
  môn đồ lên admin) là đặc quyền của riêng Gia chủ.
- **Một người giữ được NHIỀU vai**: cột `role` enum đơn thay bằng mảng `roles` (migration
  0011). Mảng rỗng = môn đồ thường; Gia chủ nghiễm nhiên có mọi quyền Trưởng môn. Cột cũ
  GIỮ LẠI một nhịp deploy (ghi gương, không đọc) — migrate chạy trước deploy, drop ngay là
  bản đang phục vụ 500 trong cửa sổ ấy. Bootstrap: admin LÂU ĐỜI NHẤT nhận gia-chu.
- **Chống khoá cửa**: Gia chủ cuối cùng không xoá được và không tự rời ngôi được — chỉ
  Gia chủ đổi được vai, nên khoảnh khắc người cuối rời ghế là hệ thống VĨNH VIỄN không còn
  ai đổi vai được nữa. Muốn nghỉ thì truyền ngôi trước.
- **Ma trận quyền là MỘT module thuần** ([permissions.ts](src/lib/auth/permissions.ts)) —
  action nào đụng vào người khác cũng phải đọc lại người ấy từ DB rồi hỏi ma trận, không tin
  role nào do form gửi kèm. `npm run verify:permissions` đóng đinh từng ô, chạy không cần DB.
  Nó cứu bản này một lần trước khi phát hành: checkbox gia-chu của chính Gia chủ bị
  `disabled` để khỏi tự bỏ — mà checkbox disabled thì trình duyệt KHÔNG GỬI, nên Gia chủ chỉ
  đổi cái tên hiển thị của mình cũng bị chặn oan vì "tự rời ngôi". Vá bằng một hidden input.
- **Tag trang trí cho đạo hữu**: Trưởng môn/Gia chủ ban tối đa 3 tag × 20 ký tự (tab Môn Đồ);
  tag hiện thành huy hiệu cạnh tên trong Phòng Chat, và ĐÓNG BĂNG vào tin lúc gửi — cùng
  triết lý với tên người gửi: huy hiệu tại thời điểm nói trung thực hơn huy hiệu sau này đổi.
  isAdmin lẫn tags đều đọc từ bản ghi thật phía server, body không tự khai được.
- **「Linh sứ」đổi tên thành「khôi lỗi」** (linh sứ tông môn → khôi lỗi tông môn, linh sứ
  máy nhà/túc trực → khôi lỗi máy nhà/túc trực) ở MỌI chữ hiển thị và tài liệu. Định danh
  máy GIỮ NGUYÊN có chủ ý: URL `/linh-su/*` nằm trong script cài của người dùng và setup.sh
  đã nằm sẵn trên VM, service `auto-hh3d-linh-su` đang chạy, `WORKER_ID=tong-mon-linhsu` đã
  ghi trong sổ điểm danh — đổi chúng là làm gãy các bản cài hiện có để đổi lấy một cái tên
  mà máy móc chẳng bao giờ đọc to. CHANGELOG cũ và migration đã áp cũng giữ nguyên: sử sách
  không viết lại.
- **Xoá nút 🀄 khỏi thanh soạn** — khay ba tab mở từ nút 😊, một nút là đủ vào cả ba.

## 0.42.0 — khay chọn ba tab, và bấm ra ngoài thì nó chịu tắt

- **Bấm ra ngoài đóng khay.** Khay emoji/sticker và khay thả cảm xúc trước đây chỉ tắt được
  bằng cách bấm lại đúng cái nút đã mở nó — mở xong rồi đi làm việc khác là nó nằm đấy che
  mất tin. Nghe `pointerdown` ở `document`, và tha những gì mang `data-chat-popup` (thân khay)
  hoặc `data-chat-popup-trigger` (nút mở). Thêm `Escape`.
  - Dùng **thuộc tính** chứ không phải một rừng `ref`: khay cảm xúc mọc TRONG từng bong bóng
    tin, nên số popup bằng số tin đang hiển thị. Một câu `closest()` không quan tâm có bao
    nhiêu cái; một Map ref thì phải dọn tay mỗi lần danh sách tin đổi.
  - Phải tha cả nút mở, nếu không: bấm nút lúc khay đang mở sẽ bị tay này đóng rồi `onClick`
    mở lại ngay — khay không bao giờ tắt được bằng chính nút đã mở nó.
  - `pointerdown` chứ không phải `click`: một cú kéo bắt đầu ngoài khay sẽ không bao giờ sinh
    ra `click` để mà đóng. Nó cũng bao luôn màn cảm ứng.
- **Khay gộp thành BA TAB — STICKER / EMOJI / GIF** ([ChatPicker.tsx](src/app/chat/ChatPicker.tsx)),
  có mục "Gần đây" nhớ qua các phiên, tiêu đề mục dính trên đầu khi cuộn, và dải danh mục dưới
  đáy để nhảy tới từng mục. Theme không đổi một sắc nào.
  - Khay **nổi lên trên** dòng tin thay vì chen vào dòng chảy như trước: mở bảng cũ là cả sảnh
    nhảy một nấc và chỗ đang đọc trôi mất.
  - Neo theo **mép trên của thanh soạn** (`bottom: calc(100% + 6px)`) chứ không theo một con số
    pixel — ô nhập cao dần tới 120px khi xuống dòng, và một khoảng cách cố định sẽ để khay
    trườn lên đè chính nó.
- **Tab GIF tìm thật qua GIPHY.** Khoá API **chỉ sống ở server**: client hỏi qua
  `/api/chat/gif`, không bao giờ thấy khoá — đó là toàn bộ lý do có route đứng giữa thay vì
  gọi thẳng. Chưa đặt `GIPHY_API_KEY` thì tab treo biển "chưa khai mở", emoji và sticker vẫn
  chạy đủ. Gõ tìm có chờ 300ms; GIF gửi đi bằng đường **đính kèm** nên bong bóng vẽ nó bằng
  đúng nhánh `image/*` đã có sẵn, không thêm hình dạng tin nào để mọi chỗ khác phải học.
  - Bản đầu viết cho **Tenor**, đổi sang GIPHY trước khi phát hành vì Tenor thôi phát khoá
    miễn phí. Hợp đồng của service (`gifSearchReady`, `searchGifs`, kiểu `Gif`) giữ nguyên
    từng chữ nên route và khay chọn không đổi một dòng — đúng cái giá của việc nhốt nhà cung
    cấp vào sau một service thay vì gọi thẳng từ component.
  - **"Powered By GIPHY" là BẮT BUỘC** theo điều khoản của họ, không phải trang trí. Nó hiện
    dưới đáy tab GIF mọi lúc API được dùng.
- **GIF ở lại CDN của GIPHY, KHÔNG chép về tàng khố media**: vừa tốn dung lượng trong hạn
  Always Free vốn đã hẹp, vừa chẳng bền hơn bản gốc.
- **`npm run verify:gif` — 7 nhóm**, không tiêu một lượt hạn mức nào (dữ liệu mẫu, cộng một
  `fetch` thay tạm để soi cách gọi). Nó gác đúng chỗ dữ liệu của bên thứ ba đi vào hệ thống:
  - **Tài liệu GIPHY khai `width`/`height`/`size` là number, API thật trả CHUỖI.** Phép thử
    đóng cả hai dạng lại, để lần sau ai "dọn cho gọn" thì nó kêu ngay thay vì để mọi kích cỡ
    lặng lẽ thành NaN.
  - Rendition `preview` của GIPHY là **MP4**; nhận nhầm nó là ảnh thì bong bóng ra một ô vỡ.
  - **Mọi trần của `attachmentSchema` được vá TỪ ĐÂY** — tên rỗng có đường lui, tên dài cắt
    còn 200, URL quá 2048 bị loại, bản gửi quá 64MB lùi xuống bản nhỏ hơn. Chỗ cuối là một
    lỗi thật bắt được lúc tự soi lại: để nguyên thì một GIF quá khổ làm cả TIN bị từ chối
    400, mà người gửi chỉ thấy "có trắc trở".
  - `q` của GIPHY chặn **50 ký tự** — cắt ở service, không để API trả lỗi vì người ta dán cả
    câu vào ô tìm.
  - GIPHY trả **HTTP 200 kèm `meta.status` hỏng** (hay gặp: 403 khoá sai). Không soi chỗ ấy
    thì lỗi khoá hiện ra thành "không có GIF nào khớp" — một lời nói dối êm ái dẫn người đi
    sửa nhầm chỗ.
- **Khung sảnh rộng thêm 25%** — `max-w-3xl` (48rem) → `max-w-[60rem]`.

## 0.41.1 —「Nghị Sự Đường」đổi tên thành「Phòng Chat」

- **Đổi ở MỌI chỗ hiển thị, không chỉ nút được chỉ**: thanh điều hướng, tiêu đề tab trình
  duyệt (`metadata.title`), tiêu đề trang, và mục cấu hình bên Tông Môn. Đổi mỗi cái nút thì
  bấm「Phòng Chat」lại rơi vào một trang đề「Nghị Sự Đường」— nửa vời còn khó hiểu hơn tên cũ.
- Hai tài liệu người dùng đọc ([HUONG-DAN.md](HUONG-DAN.md), [deploy/mongodb.md](deploy/mongodb.md))
  đổi theo. CHANGELOG thì **không** — các mục cũ là lịch sử, và 0.25.1 kể đúng chuyện sảnh này
  từng mang tên「Tụ Nghĩa Sảnh」; sửa lại thành tên hôm nay là bôi xoá chính cái vết ấy.

## 0.41.0 — file đính kèm dọn nhà sang OCI Object Storage

- **Kho media chuyển từ Vercel Blob sang OCI Object Storage** (bucket `jarvis-media`,
  eu-frankfurt-1). Lý do trần tục: tông môn **đã** có tài khoản OCI nuôi linh sứ, và dung
  lượng ở đó nằm trong hạn Always Free — trong khi Vercel Blob tính tiền riêng theo GB lưu và
  GB tải. Gộp về một nhà cũng bớt được một nhà cung cấp phải canh hạn mức.
- **Nói qua lớp tương thích S3, không qua SDK riêng của OCI.** `@aws-sdk/client-s3` đã được cả
  thế giới soi từng đường ký request; cái giá phải trả chỉ là một biến endpoint, rẻ hơn nhiều
  so với tự ký theo chuẩn riêng của OCI (RSA-SHA256 trên chuỗi header) chỉ để tải một tấm ảnh.
- **GHI qua endpoint S3, ĐỌC bằng URL gốc của OCI** trên bucket `ObjectReadWithoutList` — ai có
  URL thì đọc được, không ai liệt kê được bucket. Cố ý **không** dùng Pre-Authenticated Request:
  PAR có hạn, mà URL thì nằm trong database vĩnh viễn — một hạn dùng âm thầm hết là cả album
  ảnh cũ chết theo.
- **Hai cái bẫy của lớp tương thích S3**, cả hai đều làm mọi lần tải lên chết mà lời báo lỗi
  không chỉ về đúng chỗ:
  1. OCI chỉ hiểu địa chỉ **path-style**, không hiểu virtual-host style mà SDK mặc định dùng.
  2. Từ v3.729 SDK **tự gắn** `x-amz-checksum-crc32` vào mọi PutObject, mà OCI **từ chối** header
     ấy. Phải tắt bằng `requestChecksumCalculation: "WHEN_REQUIRED"`.
- **Trần dung lượng là quota cấp tenancy, không phải thuộc tính của bucket** — bucket OCI co
  giãn, không có dung lượng để đặt. Chính sách `jarvis-object-storage-always-free` đặt trần
  **19 GiB**, dưới hạn Always Free 20 GiB. Cố ý đặt ở **tenancy** chứ không ở compartment con:
  hạn 20 GiB là hạn của cả tenancy, nên quota bó trong compartment con không thật sự chặn được.
- **`npm run verify:media` — 6 nhóm**, trong đó vòng đời thật chạy trên bucket thật (tải lên →
  tải về bằng HTTPS công khai, không mang chữ ký → so từng byte → xoá). Thiếu `OCI_*` thì phần
  ấy bị bỏ qua và bản kê **nói rõ là đã bỏ qua** — một phép thử im lặng không chạy mà trông như
  đã xanh là cách nhanh nhất để tin vào một kho chưa từng được chạm tới.
- **Một lỗi của chính bản này bị phép thử bắt**: đường lui cho tên file rác từng áp lên cả
  chuỗi *sau khi đã ghép đuôi*, nên `"???.png"` rửa xong thành `_.png` — chuỗi ấy CÓ chữ (trong
  đuôi "png") nên đường lui không kích hoạt và tên file rút còn đúng một dấu gạch dưới. Đường
  lui phải áp lên phần tên **sau khi tách đuôi**.
- **Chuyển kho**: [scripts/migrateBlobToOci.mts](scripts/migrateBlobToOci.mts) chép bytes giữ
  nguyên tên object rồi mới sửa URL trong `chat_messages` — không bao giờ trỏ tin vào một object
  chưa tồn tại. Chỉ đọc từ Vercel Blob, không xoá gì bên đó. Thực tế chuyển 3 object (1.17MB),
  và **0 tin nào trỏ tới chúng** — chúng là file mồ côi từ lần thử tính năng hôm 07/08.
- Cách dựng và vận hành: [deploy/oracle/README.md](deploy/oracle/README.md), nay gom cả truy cập
  tài khoản OCI, phát hành linh sứ tông môn, lẫn tàng khố media vào một chỗ.

## 0.40.0 — tin đàm đạo dọn nhà sang MongoDB

- **Kho tin chuyển từ Upstash Redis sang MongoDB.** Hợp đồng công khai của `chat.ts` giữ
  nguyên từng chữ, nên `/api/chat` và `/api/cron` không đổi một dòng nào.
- **Mô hình document xoá được HAI thứ chắp vá mà key-value bắt phải có** — đây mới là lý do
  đổi, không phải đổi cho khác:
  1. Cảm xúc từng sống trong một HASH riêng `chat:react:{id}`, field ghép bằng một **dấu
     phân cách tự chế** `U+0001` (vì ':' và '-' đều cắt sai: userId là UUID, emoji thì đủ
     trò ZWJ). Giờ chúng là mảng con ngay trong tin, `$pull`/`$addToSet` nguyên tử.
  2. Mục lục thời gian từng là một ZSET song song `chat:index` — mỗi lần ghi hay xoá phải
     nhớ đụng vào **hai** chỗ. Giờ chỉ còn một index trên `createdAt`.
  Kết quả đo được: xoá một tin là xoá một document (cảm xúc chết theo, không còn key thứ hai
  để quên), và một trang tin là **một câu find** thay cho pipeline 2N lệnh.
- **Sửa và thu hồi thành nguyên tử.** Bản Redis phải đọc-rồi-ghi, để hở một khe giữa hai
  lượt đi; giờ quyền sở hữu nằm TRONG bộ lọc của câu update — hoặc trúng đúng tin của mình,
  hoặc không trúng gì.
- **Hạn lưu CỐ Ý không dùng TTL index của Mongo**: số ngày là thứ tông chủ đổi lúc chạy, mà
  `expireAfterSeconds` nằm trong định nghĩa index — đổi nó phải `collMod`. Một câu xoá theo
  khoảng đọc thẳng cấu hình hiện hành, đổi số là ăn ngay.
- **`chat_typing` không thể phình**: `_id` = userId nên số dòng bị chặn trên bởi số thành
  viên. Nhờ vậy bỏ luôn lượt dọn rác mà bản Redis phải chạy kèm MỖI nhịp poll 2,5 giây của
  MỖI người; TTL 60s làm lưới cuối.
- **Ranh giới lỗi giữ nguyên và được nói rõ**: *thiếu cấu hình* là「chưa khai mở」(503, sảnh
  treo biển tử tế); *có cấu hình mà kết nối hỏng* thì để lỗi nổ kèm nguyên văn — báo「chưa
  khai mở」cho một kho đang hỏng là dán nhãn sai lên sự cố và giấu mất manh mối duy nhất.
- **Một lỗi thiết kế của chính bản này bị bắt bằng cách trả giá 2 lần chạy 600 giây**: pool
  Mongo cache toàn cục (đúng cho web) khiến MỌI script treo mãi không thoát, và stdout ghi
  ra file thì đệm lại nên nhìn như treo từ dòng đầu. Thêm `closeChatStore()` cho tiến trình
  có điểm kết thúc; web function không bao giờ gọi.
- **`npm run verify:chat` — 11 nhóm phép thử chạy trên một mongod THẬT** (bật trong tiến
  trình, không cần Atlas, không đụng production): gửi/đọc, chặn tin rỗng và tin quá dài, đếm
  cảm xúc theo người và bấm-lại-là-rút, sửa chỉ chủ nhân, trích đoạn trả lời theo nội dung
  mới nhất, thu hồi giữ vết + lột cảm xúc, trưởng môn thu hồi tin người khác, "đang gõ"
  không kể chính mình và mỗi người một dòng, phân trang 50 tin không chồng không hụt, quét
  hạn lưu đúng số, và index tự dựng. Trước bản này `chat.ts` **không có lấy một phép thử
  nào** — đổi cả kho lưu trữ mà không chạy thật thì không có gì để tin.
- **Đã chuyển dữ liệu thật:** `scripts/migrateChatToMongo.mts` chỉ đọc Redis (kho cũ nguyên
  vẹn làm bản lui), upsert theo `_id` nên chạy lại bao nhiêu lần cũng một kết quả — chạy lần
  hai cho đúng `0 tin mới / 3 giữ nguyên`. Ba tin ấy đều là bia mộ đã thu hồi từ 02/08.
- Hướng dẫn dựng kho: [deploy/mongodb.md](deploy/mongodb.md).

---

## 0.39.3 — công tắc xét duyệt lên chung hàng với nút thu nhận

- **Tab Môn Đồ có một thanh công cụ**: công tắc「Xét duyệt thành viên mới」bên trái, nút
  「+ Thu nhận đạo hữu mới」bên phải, ngang hàng nhau. Trước đây công tắc là một thẻ riêng
  chiếm trọn bề ngang, nằm chồng lên trên cái nút.
- **Công tắc dựng lại thành cụm điều khiển, không còn là thẻ có tiêu đề** — một thẻ mang h2
  thì không thể ngang hàng với một cái nút. Tiêu đề「Môn Quy — Cổng Bái Sư」và dòng dẫn nhập
  bỏ đi vì TRÙNG NGHĨA chứ không phải vì thiếu chỗ: nhãn ô tick đã nói đúng việc nó làm, còn
  dòng trạng thái ngay dưới nói cụ thể hơn cả dòng dẫn nhập — nó kể tình trạng đang có thật.
  Dòng trạng thái và cảnh báo hàng chờ giữ nguyên, không mất chữ nào.
- **Panel thu nhận khi mở ra chiếm trọn dòng riêng** (`w-full`): lúc gập nó chỉ là một cái
  nút nên nằm chung hàng là vừa, nhưng lúc mở ra là cả một biểu mẫu — không có ràng buộc ấy
  thì nó bị bóp cạnh công tắc.
- Đo trên trình duyệt ở hai trạng thái (đang bật / đang tắt còn 3 người chờ): **lệch tâm dọc
  0px** giữa ô tick, nút「Lưu Môn Quy」và nút「+ Thu nhận đạo hữu mới」; mở panel thì thẻ rộng
  đúng bằng cả hàng và tụt xuống dòng dưới; ở 375px thanh công cụ tự xuống dòng và không góp
  một pixel nào vào cuộn ngang (phần cuộn ấy vẫn đúng bằng bề rộng tranh nền — tính năng pan
  của 0.33.2).
- **Bắt được một lỗ hổng trong cách tôi tự kiểm**: sau khi xoá route thử, `.next/dev/types`
  còn tham chiếu nó nên `next build` hỏng ở bước type-check — mà những lượt trước tôi đọc kết
  quả build bằng `grep` nên một lần hỏng như thế có thể lọt. Lần này dọn `.next` rồi chạy lại
  và đọc ĐÚNG mã thoát: tsc 0, build 0. (Các bản deploy trước không bị ảnh hưởng: chúng dựng
  từ `git archive` ra thư mục trắng, không có `.next` cũ.)

---

## 0.39.2 — trả lại nguyên văn ba thẻ giới thiệu

- **Hoàn nguyên bản viết lại ở 0.39.1.** Tông chủ muốn giữ nguyên giọng cũ; việc cần làm chỉ
  là bỏ dòng「Chỉ dành cho thành viên Lạc Vân Tông」, không phải sửa văn phong. Bản 0.39.1 đi
  quá phạm vi được giao, và mục này giữ lại để lần sau không ai lặp lại.
- Ba tiêu đề và ba đoạn thân về đúng nguyên văn — lấy thẳng từ commit `8a03905` bằng
  `git show` chứ không gõ tay: văn bản có dấu tiếng Việt và gạch ngang dài, gõ lại là mở
  đường cho một sai khác không ai nhìn ra.
- **Giữ lại đúng hai thứ của 0.39.1**: dòng badge đã xoá, và nhánh render `badge` cũng xoá
  theo — không thẻ nào còn mang badge thì nhánh ấy là mã chết. Diff so với `8a03905` được
  đối chiếu và đúng bằng hai khối ấy, không sót một chữ nào của văn bản cũ.
- Đo lại trên trình duyệt: ba tiêu đề gốc trở lại, ba thẻ cùng cao 158px, mỗi thẻ một đoạn,
  không còn chữ「Lạc Vân Tông」ở bất kỳ đâu trong `src/`.

---

## 0.39.1 — ba thẻ giới thiệu thôi giọng dịch máy

- **Viết lại ba thẻ ở trang chủ.** Bản cũ đọc ra「máy viết」vì bốn tật, và bản mới tránh
  đúng bốn tật ấy: tiêu đề ghép bốn chữ Hán-Việt cho sang (「Tông Môn Nghiêm Cẩn」— không ai
  đặt tên mục như vậy); cụm「ngôn ngữ nhân tộc」dịch sát từ *human language* mà tiếng Việt
  không có; cả ba thẻ dùng chung một nhịp câu dài nối bằng dấu gạch ngang; và động từ tiếng
  Anh chen giữa câu (「Mọi lượt chạy log bằng…」).
- **Giữ nguyên chất tu tiên.** Linh Đài, khai đàn, đạo hữu, huyền tinh là tiếng nói của
  chính sản phẩm, không phải thứ trang trí bỏ đi được. Thứ bỏ đi chỉ là giọng dịch máy.
- **Thẻ giữa thôi hứa「phải được duyệt mới vào」.** Từ 0.33.0 trưởng môn tắt được bước xét
  duyệt, nên một lời hứa cứng ở trang chủ sẽ sai đúng vào ngày họ tắt nó — cùng loại lỗi mà
  trang bái sư đã phải sửa ở 0.33.0. Câu mới đúng ở cả hai chiều.
- Xoá「Chỉ dành cho thành viên Lạc Vân Tông」, và xoá luôn nhánh render `badge` — không còn
  thẻ nào mang badge thì nhánh ấy là mã chết.
- Xoá dòng mô tả dưới hai ô lời nhắn Mê Cung ở Linh Đài.
- Đo lại trên trình duyệt: ba thẻ cùng cao 181px (grid stretch nên bỏ badge không làm thẻ
  giữa hụt xuống), mỗi thẻ đúng một đoạn, không còn vệt vàng của badge; mobile 375px nội
  dung không tràn — phần cuộn ngang vẫn đúng bằng bề rộng tranh nền, tức tính năng pan của
  0.33.2 chứ không phải hồi quy.

---

## 0.39.0 — Mê Cung biết nhắn vào Trò Chuyện Đội (schema 51)

- **Hai lời nhắn cấu hình được cho Mê Cung**, đọc từ recording 08/08 (`me-cung-20260808-104700`,
  kèm ghi chú của tông chủ ngay trong video:「cần thêm config send/chat」): một câu lúc mở
  phòng, một câu khi trận mở màn. Rỗng = không nhắn. Áp cho cả hai twin.
- **Không có màn mở/đóng panel nào để hỏng.** Recording cho thấy người thật phải bấm nút
  tròn mở「Trò Chuyện Đội」rồi gõ — nhưng DOM cho thấy `#mc-chat-input` nằm sẵn trong trang
  dù panel đóng, và `sendChatMsg()` là hàm toàn cục của chính site (onclick của nút gửi).
  Automation đặt giá trị bằng native setter + sự kiện `input`, rồi gọi thẳng hàm ấy.
- **Trận chỉ nhắn MỘT lần cho cả lượt ghé** — đúng như recording, không phải mỗi trận một
  câu: cờ `window.__jvzChatFightSent` chặn các vòng sau, và navigate của lượt ghé kế nạp
  trang mới nên cờ tự sạch. Widget chưa sẵn sàng thì KHÔNG đặt cờ — trận sau còn được thử.
  Cả hai bước đều `optional`: chat là phụ trợ, lỡ hụt không được phép hỏng lượt Mê Cung.
- **`sanitizeChatMessage` ở biên config, và nó không phải trang trí.** Lời nhắn được nhúng
  vào MỘT LITERAL trong nguồn bước `evaluateJavaScript` bằng phép thay chuỗi trần, nên nháy
  đơn/kép, backslash, backtick, ký tự điều khiển đều là đường thoát khỏi literal — nhẹ thì
  vỡ script mất lời nhắn, nặng thì lời nhắn TRỞ THÀNH script. Loại tại một nơi thay vì
  escape rải rác; trần 200 ký tự đúng `maxlength` của ô nhập trên site.
- **Hồ sơ bump schema 50 → 51**; đồng bộ với desktop 1.50.0 (bên đó hồ sơ đã lưu bị thay ở
  lần mở đầu tiên — cần bật lại nhiệm vụ và chọn lại tuỳ chọn).
- **Smoke 216 → 224.** Sanitize được ghim (nháy các loại biến mất, cắt đúng 200), cả hai
  twin cùng nhận lời nhắn, và bốn ca chạy THẬT trên fixture giả widget — chạy đúng bước
  trong hồ sơ chứ không chép script vào test (chép là hai bản lệch nhau ngày ai đó sửa một
  bên): gửi nguyên vẹn tới `sendChatMsg`; rỗng thì im lặng; bước trận chạy 3 lần chỉ gửi 1
  tin; widget vắng mặt thì lặng lẽ bỏ qua, lượt vẫn thuận.

---

## 0.38.0 — Hàng Đợi nói rõ người khác đang làm nhiệm vụ nào

- **Tên nhiệm vụ đang chạy giờ hiện trên MỌI dòng của Hàng Đợi Công Việc**, không riêng dòng
  của mình. Trước đây dòng người khác chỉ có「9/11 nhiệm vụ」.
- **Đây là một ranh giới riêng tư được DỊCH CÓ CHỦ Ý, không phải một chỗ rò rỉ** — và nó
  được ghi lại đúng như vậy trong `queue.ts`. Luật cũ để tên nhiệm vụ bên phía「KHÔNG BAO
  GIỜ」với lập luận: con số trả lời đúng câu hỏi trang này sinh ra để trả lời (ghế linh sứ
  kia sắp trống chưa) mà không hé lộ ai bật nhiệm vụ nào. Lập luận ấy vẫn đúng về logic; thứ
  đổi là điều tông môn MUỐN thấy. Người sau đọc mã nguồn sẽ thấy cả hai vế.
- **Cái được lộ hẹp hơn「cấu hình nhiệm vụ」** — thứ vẫn nằm bên phía không bao giờ: đây là
  các nhiệm vụ đang chạy NGAY LÚC NÀY của vòng hiện tại, không phải danh sách đã bật trong
  ngọc giản, và nó biến mất ngay khi vòng chạy xong. Những ranh giới KHÔNG đổi phía vẫn
  nguyên: tên chủ nhân còn che 2/3, tên tài khoản game và id linh sứ riêng vẫn chỉ mình thấy.
- **Sửa đúng một nơi, vì phép cắt vốn đặt ở chỗ hẹp nhất.** `readProgress` là cửa duy nhất
  mọi đường đọc hàng đợi đi qua, nên giao diện không phải đổi một dòng logic nào — chỉ đổi
  mấy chú thích đang mô tả luật cũ.
- **Tham số `mine` bị bỏ hẳn** khỏi `readProgress` thay vì để lại và luôn truyền `true`: một
  tham số riêng tư không còn ai đọc là cái bẫy mời người sau tin rằng vẫn còn phép cắt.
- **Thêm trần ở đường đọc** (12 tên, mỗi tên ≤60 ký tự). Zod của /api/worker vẫn là lớp canh
  thật ở đường ghi; trần này có vì từ hôm nay chuỗi ấy đi thẳng lên màn hình của CẢ tông môn,
  nên một dòng jsonb méo mó (bản cũ để lại, hay sửa tay) làm hỏng trang của tất cả chứ không
  của riêng ai. Hai con số rộng gấp nhiều lần dữ liệu thật (tối đa 8 tab, tên dài nhất ~30
  ký tự) nên không bao giờ chạm vào một hàng đợi lành lặn.
- **Smoke 215 → 216**, và ba phép ghim luật cũ được viết lại thành ghim luật mới, cộng hai
  phép mới cho trần đọc. Đã dựng thật giao diện trên một route tạm với dòng của người khác:
  hiện「Mê Cung · Vấn Đáp」cho dòng đang chạy,「đang chuẩn bị…」cho dòng vừa mở trình duyệt,
  và tên chủ nhân vẫn che. Route tạm đã xoá trước khi commit.
- Không đụng engine → **không cần cài lại linh sứ**; `queue.ts` không nằm trong gói linh sứ.

---

## 0.37.0 — trang chưa dựng xong thì tải lại và chạy lại, tối đa 3 lượt

- **Nhiệm vụ gục vì「Trang chưa dựng xong sau Ns」giờ được chạy lại từ đầu, tối đa 3 lượt.**
  Trước đây một lần trang vẽ hụt là mất trọn nhiệm vụ ấy cho cả vòng chạy.
- **Chạy lại CẢ nhiệm vụ, không chỉ bước hỏng — và đây là quyết định đáng kể nhất.** Nghe thì
  「tải lại trang rồi thử lại bước ấy」có vẻ đúng nghĩa đen hơn, nhưng nó SAI với chính ca đã
  báo: Hỷ Sự Đường trượt `#blessing-default-options`, mà phần tử đó nằm trong MODAL vừa được
  bước liền trước mở ra. Tải lại trang là modal biến mất, nên thử lại đúng bước ấy sẽ hỏng
  chắc chắn ba lần liền và tốn thêm ba lần thời gian chờ. Kiểm tra hồ sơ cho thấy **mọi**
  nhiệm vụ customSteps đều mở màn bằng `navigate` tới trang của chính nó, nên「chạy lại nhiệm
  vụ」ĐÃ LÀ「tải lại trang」— cộng thêm việc dựng lại đủ trạng thái mà bước hỏng cần.
- **Chỉ `waitForSelector`, KHÔNG phải `waitForCondition`.** Hai thứ nghe giống nhau nhưng hỏi
  hai câu khác nhau: một cái hỏi「trang vẽ xong chưa」(thử lại vô hại), cái kia hỏi「chuyện đó
  xảy ra chưa」— và bước bằng-chứng-đòn-đánh của Hoang Vực chính là loại thứ hai. Chạy lại nó
  nghĩa là đánh boss thêm lần nữa, đốt một lượt trong ngày của đạo hữu.
- **Rủi ro làm lại tác dụng phụ đã được ĐO, không phỏng đoán.** Rà toàn hồ sơ tìm những
  `waitForSelector` bắt buộc đứng sau một bước gây tác dụng phụ: chỉ có **đúng một** nhiệm vụ
  — Hỷ Sự Đường, chính cái đã báo lỗi — và nó có sẵn hai chốt `stopIf`(「không có tiệc cưới
  nào」/「đã chúc phúc hết」) cùng một `until`, cộng trạng thái site giữ phía server. Không
  nhiệm vụ nào khác có thể làm lại một hành động.
- **Nhận diện bằng cờ trên `state`, không dò chữ trong thông điệp lỗi.** `repeat` bọc lỗi
  thành「repeat vòng 3: …」nên phép so chuỗi sẽ phải đoán qua nhiều lớp và sẽ chết lặng ngày
  ai đó sửa lời văn; `state` là cùng một object đi xuyên mọi tầng repeat.
- Bước tuỳ chọn trượt **không** châm ngòi chạy lại; **Thu Đàn** vẫn xuyên thẳng qua vòng thử
  lại (một vòng lặp nuốt tín hiệu dừng là cách biến nút Thu Đàn thành nút gợi ý); mỗi lượt
  dựng `state` MỚI để kết quả cuối không kể chuyện của một lượt đã chết.
- Mỗi lần thử lại ghi một dòng **info** — đó là thứ giải thích vì sao một nhiệm vụ tốn gấp
  đôi, gấp ba thời gian.
- **Smoke 211 → 215**, với máy chủ giả mọc thêm một trang「chậm dựng」đếm số lượt tải THẬT.
  Hai ca đối chứng đều được chứng minh có răng: gỡ ngòi thử lại thì hai phép đầu hỏng, còn
  nới sang cả `waitForCondition` thì đúng phép canh Hoang Vực hỏng.

---

## 0.36.1 — bớt chữ trên các thẻ cấu hình

- Bỏ năm đoạn văn giải thích dài trên giao diện: dòng dẫn nhập của Bế Quan Trùng Tu, Tên Miền
  Game và Nghị Sự Đường; hộp cảnh báo cookie trong Tên Miền Game; và dòng mô tả dưới ô「Chạy
  song song các nhiệm vụ」ở Linh Đài. Các thẻ cấu hình giờ giữ đúng phần thao tác.
- **Giữ lại các dòng gợi ý ngắn gắn với ô nhập** (1–365 ngày, cách gõ tên miền, ý nghĩa mốc
  đếm ngược) — chúng trả lời câu hỏi「gõ gì vào đây」, khác hẳn văn giải thích nền tảng.
- Lời nhắc「đổi tên miền là mọi cookie đã lưu chết theo」vẫn còn nguyên ở hai chỗ nó thật sự
  cần: thông báo sau khi lưu, và dòng lỗi chính vòng chạy nói ra khi phiên không dùng được.
- Sửa kèm hai chỗ mà việc xoá chữ làm hỏng bố cục, và cả hai đều được ĐO chứ không đoán:
  tiêu đề ba thẻ lên `mb-5` để không còn khoảng mồ côi (đo được: cả ba cách nhau đúng 20px
  như nhau), và nhãn「Chạy song song」chuyển sang canh giữa vì `items-start` + `mt-0.5` vốn
  sinh ra để giữ ô tick thẳng hàng với DÒNG ĐẦU của một nhãn nhiều dòng — không còn dòng nào
  để canh thì nó thành lệch (đo lại sau khi sửa: lệch tâm 0px).

---

## 0.36.0 — cổng sẵn sàng thôi nói dối, và tên miền game thành cấu hình chạy được

Sự cố 07/08: chín nhiệm vụ liên tiếp báo `Trang chưa dựng xong sau 25s`, mỗi vòng bốn phút
đỏ rực, nửa tiếng một lần, và nhật ký không một lần nhắc tới nguyên nhân. Truy ra hai tầng.

- **Nguyên nhân ngoài đời: site dời tên miền.** `hoathinh3d.am` 301 sang `hoathinh3d.one`.
  Cookie gắn chặt vào tên miền nên KHÔNG đi theo cú nhảy — tên miền mới nhìn linh sứ như
  khách lạ. Đo được: các vòng chạy sạch tới 11:22, hỏng từ ~11:25, và bản 0.35.0 đã sống
  yên 15 tiếng trước đó nên không phải thủ phạm.
- **Nguyên nhân trong nhà, và là cái đáng xấu hổ: cổng sẵn sàng tuyên bố một điều nó chưa
  hề chứng minh.** `readinessProbe` trả `loggedIn: null` khi trang không phát tín hiệu về
  PHÍA NÀO — không dấu đã-đăng-nhập, cũng không form đăng nhập. Gặp `null`, cổng ghi một
  dòng debug (chỉ vào journal, người dùng không thấy) rồi vẫn phát ra dòng XANH
  「Đã vào được trang game — phiên đăng nhập còn hiệu lực」và thả cả vòng vào chín nhiệm vụ.
  Đúng cái mà chú thích của chính hàm ấy nói nó sinh ra để ngăn.
- **Và có tới HAI nhân chứng bị bỏ qua.** Ngay sau cổng, vòng chạy ghé hub poll `.nv-quest`
  20 giây để dò hạng tài khoản. Hub không dựng → vòng lặp hết giờ trong im lặng: nó vừa bỏ
  ra 20 giây CHỨNG MINH hub không dựng, rồi không nói với ai.
- **Cách chữa: nói thật, rồi để nhân chứng tốt hơn phân xử.** `ensureReady` trả thêm
  `loginConfirmed` và chỉ nói câu kia khi đã chứng minh được. Hai nhân chứng cùng câm thì
  DỪNG vòng với thông điệp gọi đúng tên. Phải là PHÉP HỘI, không phải phép tuyển: hub không
  dựng mà phiên vẫn xác nhận được thì đó là site trở chứng, và nhiệm vụ có trang riêng vẫn
  chạy ngon — cắt vòng lúc ấy là phá hoại. Cố ý KHÔNG cứng rắn hoá `null` thành lỗi, vì mấy
  cái dấu kia chỉ là suy đoán: hôm nào site đổi markup của người ĐANG đăng nhập, một phán
  quyết cứng sẽ chặn đứng automation của những tài khoản hoàn toàn lành.
- **Cổng còn tự nhận ra cú 301.** `session.navigate` trả về nơi THẬT SỰ dừng chân, và lệch
  origin nghĩa là site đã dời — thông điệp gọi tên cả hai đầu. Một đêm truy vết thành một
  dòng nhật ký.
- **Tên miền game thành cấu hình chạy được — tab Bảo Trì của trang Tông Môn.** Trước bản này
  mỗi cú dời TLD bắt cả tông môn chờ một lần deploy để sửa ba ký tự. Giờ trưởng môn gõ tên
  miền mới, /api/worker ghép nó vào từng lần phát việc, và mọi linh sứ — VM tông môn lẫn máy
  nhà từng đạo hữu — dùng ngay ở vòng kế: không deploy, không sửa env, không cài lại. Ghép ở
  cửa phát việc chứ không đông lạnh trong snapshot, vì job có thể đã nằm trong hàng chờ từ
  trước khi trưởng môn đổi.
- **Ô nhập nhận mọi cách gõ** (`hoathinh3d.one`, `https://hoathinh3d.one/`, có cả đường dẫn)
  và chuẩn hoá về đúng một origin; giá trị hỏng bị từ chối kèm lý do, giá trị rác trong
  database rơi về hằng số trong mã nguồn thay vì để cả tông môn trỏ vào chuỗi rỗng.
- **Soát cookie lúc dán cũng theo tên miền đang sống.** `parseCookieString` LOẠI cookie
  không thuộc tên miền đang nhắm tới, nên đối chiếu với tên miền cũ nghĩa là chuỗi mới dán
  đúng bị vứt sạch rồi người dán nhận đúng câu「không đọc được」cho một chuỗi hợp lệ.
- **Cảnh báo về cookie nằm TRÊN nút bấm**, không nằm trong thông báo sau khi lưu: hậu quả
  cần đọc trước khi bấm, vì sau đó thì mọi tài khoản đã mất phiên rồi.
- **Smoke 211, và hai ca đối chứng đã được chứng minh có răng.** Máy chủ giả mọc thêm một
  「trang câm」và một「tên miền cũ 301」: khôi phục hành vi cũ thì ca trang-câm hỏng cả 5 phép
  và tái hiện nguyên văn ảnh chụp sự cố; gỡ `gameBaseUrl` khỏi thứ tự ưu tiên thì ca tên
  miền hỏng đúng chỗ. Bắt được một phép thử xanh-vì-lý-do-sai trong lúc viết: nó truyền cả
  `baseUrl` lẫn `config.gameBaseUrl`, mà tham số truyền thẳng luôn thắng — nên nó xanh kể cả
  khi trường kia bị bỏ qua sạch.

---

## 0.35.0 — song song chỉ dành cho hub; trang riêng có cổng nhường đường toàn cục

- **Luật mới của tông chủ, sau đêm 07/08:** chạy song song chỉ dành cho các nhiệm vụ ngắn
  trên `/nhiem-vu-hang-ngay`. Nhiệm vụ có TRANG RIÊNG (Hoang Vực, Mê Cung, Luyện Đan…) chỉ
  được phép có tối đa MỘT nhiệm vụ khác chạy cùng lúc — **kể cả nhiệm vụ của đạo hữu khác**
  trên cùng linh sứ. Mục đích: đảm bảo tài nguyên cho các trận dài, phức tạp; 0.34.1 nới
  ngân sách là thuốc giảm đau, bản này là thuốc chữa.
- **`questGate.mjs` — một bộ đếm cho cả tiến trình linh sứ**, xuyên mọi đàn và mọi đạo hữu
  nó phục vụ. State mức module là chủ ý: worker chạy nhiều đàn trong cùng tiến trình Node,
  nên "toàn cục trên cái máy này" chính là phạm vi tài nguyên (CPU) mà luật muốn bảo vệ.
  Hai linh sứ trên hai máy khác nhau không cần biết nhau.
- **Hai nhiệm vụ trang riêng KHÔNG bao giờ cặp với nhau**, dù "mỗi cái chỉ thấy 1 cái khác"
  nghe như thoả luật — cặp Mê Cung + Hoang Vực chính là sự cố sinh ra luật này, và hai con
  quái vật chia nhau hai nhân CPU thì chẳng con nào được đảm bảo gì. Trang riêng cầm cổng
  MỘT MÌNH, với đúng một nhiệm vụ hub làm bạn đồng hành (tổng ≤ 2).
- **Công bằng có chủ ý ở hai chiều.** Trang riêng đứng đợi thì hub mới không được chen
  ngang (không có luật này, dòng hub bất tận của các đàn khác bỏ đói trận đánh lớn vĩnh
  viễn); nhưng trang riêng ĐÃ cầm cổng thì hub sau được vượt lên lấp chỗ đồng hành trống —
  chỗ ấy để không thì không ai được gì, và trang riêng kế tiếp không mất lượt.
- **Chờ huỷ được:** Thu Đàn giữa lúc xếp hàng rút lui qua nhịp poll 500ms, không kẹt sau
  một trận Mê Cung 35 phút của người khác chỉ để nói "tôi dừng đây".
- **Nhánh tuần tự cũng đi qua cổng** — tuần tự trong đàn này không có nghĩa là một mình
  trên máy: các đàn khác của cùng linh sứ vẫn chạy cạnh bên.
- **Kế hoạch chạy xếp trang riêng ra cuối** (tường thuật vẫn theo thứ tự hồ sơ): một lane
  của pool bị waiter chiếm là một lane không chạy được nhiệm vụ hub nào — tệ nhất là cả ba
  lane cùng xếp hàng trong khi đống hub phía sau hoàn toàn có thể chạy ngay.
- **Lỗi bắt được trong lúc viết test:** bản nháp đầu chỉ drain cổng khi có người buông —
  một hub tới lúc chỗ đồng hành còn trống phải đợi nhịp poll 500ms vô cớ. Test 20ms vạch
  trần; giờ acquire tự drain ngay trong cùng nhịp.
- **Smoke 189 → 202:** dựng lại đúng hình sự cố (Mê Cung giữ cổng, Hoang Vực xếp hàng, hub
  lấp một chỗ, buông là trang riêng vào trước), phân loại đọc từ hồ sơ thật (twin thường
  của Điểm Danh sống trên `/diem-danh` nên NÓ là trang riêng dù bản VIP là hub), và một
  observer gắn vào vòng chạy Chromium thật xác nhận hai nhiệm vụ trang riêng nối đuôi dù
  vòng bật song song.

---

## 0.34.1 — ngân sách bằng chứng đòn đánh chịu được tab bị bỏ đói CPU

- **45s được cân cho nhầm đêm.** Bản ghi 06/08 đo chuỗi thật trên MỘT tab rảnh: POST trả lời
  ngay, hoạt ảnh ~11s, đồng hồ thay nút ở ~12s — và 45s (~4×) được tin là đủ cho ba tab trên
  VM hai nhân. Nhật ký 07/08 01:03:55 phủ định điều đó: Hoang Vực chạy song song cạnh một
  trận Mê Cung「Đủ đội」, hoạt ảnh của tab bị bỏ đói CPU chưa chạy xong ở giây 45, và một đòn
  đánh THẬT SỰ TRÚNG bị báo thành `Hết 45s chờ: #battle-button hidden`. Tuần tự không bao
  giờ hỏng — khác biệt chưa từng nằm ở flow, chỉ nằm ở việc ai đang ăn CPU bên cạnh.
- **Bước bằng chứng giờ chờ tới 120s** — 10× mốc 12s đo được, vẫn xa dưới cooldown 450s. Đòn
  trúng là thoả điều kiện NGAY lúc nút biến mất, nên sự hào phóng này miễn phí trên mọi trận
  thắng; chỉ một trận thật sự hỏng mới phải trả trọn. Không đổi schema: cùng bước, cùng nhân
  chứng, một con số.
- **Một kịch bản cho cả hai chế độ vẫn là luật** (nguyên tắc từ 0.32.0): tuần tự với song
  song chỉ khác nhau ở tốc độ trang vẽ — đúng thứ cửa sổ có hạn sinh ra để hấp thụ. Cửa sổ
  chỉ đơn giản là quá nhỏ, nên KHÔNG rẽ nhánh timeout theo chế độ chạy: còn hai con số là
  còn ngày chúng lệch nhau.
- Smoke thêm chốt sàn `>= 120s` cho bước bằng chứng của cả hai twin — teo con số này lại là
  mở cửa cho đúng đêm lỗi ấy quay về. **189 thuận, 0 nghịch.**

---

## 0.34.0 — bế quan trùng tu: dừng cả tông môn mà không chém một đàn nào giữa vòng

- **Tab Bảo Trì trong trang Tông Môn.** Trưởng môn khai bảo trì với một ước lượng số phút
  và một lời nhắn tuỳ ý; đang bảo trì thì dời hạn chót được (startedAt đứng yên — nó là chân
  trái của thanh tiến độ, đổi giữa chừng là thanh nhảy ngược trước mắt người xem), và có nút
  mở cửa lại. Kèm bảng drain: bao nhiêu đàn đang chạy nốt, bao nhiêu nằm chờ —「đang chạy」
  về 0 là deploy an toàn.
- **"Dừng tất cả job" bằng cách đóng ĐÚNG MỘT cánh cửa.** Giao thức linh sứ có năm op; bảo
  trì chỉ khoá `claim`. Bốn op còn lại mở nguyên nên vòng đang chạy dở về đích đàng hoàng,
  kể xong câu chuyện của nó, rồi `completeWorkerCycle` tái xếp job vào hàng — nơi claim sẽ
  không phát ra nữa. Không cần giết ai cả: chỉ cần thôi phát việc mới. Mở cửa lại là mọi đàn
  tự chạy tiếp từ vòng kế, không ai phải bấm lại Khai Đàn. Linh sứ vẫn điểm danh trong lúc
  chờ — sổ trực mà báo「vắng」giữa lúc trùng tu là dashboard tự bịa thêm một sự cố.
- **Khai Đàn từ chối ngay ở tầng service**, trước mọi phép kiểm khác — form nào, đường gọi
  nào cũng đập vào cùng cánh cửa, kể cả cái tab mở từ hôm qua chưa từng thấy popup.
- **Popup trên Linh Đài, hai đường tới cùng một chỗ.** Ai đang mở trang nhận qua frame SSE —
  admin gạt công tắc là `notifyDashboard("*")` đẩy tới mọi stream trong giây kế; ai mới vào
  nhận từ SSR qua `initialMaintenance`. Cả hai đổ về một context nên popup không cần biết
  mình được báo bằng đường nào. Chữ ký frame của stream PHẢI học thêm trường maintenance —
  thiếu nó thì gạt công tắc không đẩy frame nào, và popup chỉ hiện khi một job tình cờ đổi
  trạng thái, tức đúng lúc hàng chờ lặng gió thì nó câm.
- **Đồng hồ đếm ngược + thanh tiến độ, và tuyệt đối không đếm số âm.** Đếm ngược trỏ vào
  hạn chót; thanh tiến độ nội suy giữa hai mốc. Quá hẹn thì nói「sắp xong」và ghim 100% —
  một cái đồng hồ chạy lùi qua 0 rồi tiếp tục lùi là cách nhanh nhất để người xem kết luận
  cả trang đã hỏng. Popup đóng được (còn ai muốn đọc nhật ký đàn đang chạy nốt), nhưng đóng
  rồi vẫn còn dải mỏng ghim trên đỉnh — trạng thái trùng tu không được biến mất khỏi mắt.
  Đợt trùng tu MỚI (startedAt đổi) thì popup tự bật lại.
- **Một giá trị rác không được đánh chìm cả document.** `getAppSettings` khi parse trượt là
  trả default cho cả document — nghĩa là một trường maintenance hỏng (ai đó sửa tay JSONB)
  sẽ kéo `membership.requireApproval` về BẬT lại sau lưng trưởng môn. Mọi trường maintenance
  vì thế mang `.catch()`: trường hỏng về default một mình, hàng xóm không suy suyển.
- **`npm run verify:maintenance`** chạy trên database thật: document cũ mặc định TẮT (deploy
  không tự đóng cửa tông môn), bật là feed mang cờ + hạn chót và Khai Đàn khoá đúng lý do,
  gia hạn giữ nguyên startedAt, tắt là mọi cửa mở lại. In giá trị gốc trước khi chạm, khôi
  phục trong finally, đọc lại xác nhận.
- Không migration (nhánh mới trong JSONB `app_settings`), không đổi engine — linh sứ đang
  cài không cần đụng tới: cửa claim đóng phía server, worker cũ chỉ thấy「chưa có việc」.

---

## 0.33.3 — fallback vh được cứu khỏi tay minifier

- Bản 0.33.2 hứa「có fallback `100vh` cho trình duyệt cũ」— và trong MÃ NGUỒN thì đúng là
  có: hai dòng cùng property, `100vh` trước làm lưới đỡ, `100lvh` sau đè lên. Nhưng đối
  chiếu CSS production sau deploy: minifier của Next gộp cặp đôi ấy lại và **chỉ giữ dòng
  sau**. Fallback tồn tại trong repo, không tồn tại trên trang — trình duyệt chưa biết lvh
  (Chrome <108, iOS <15.4) thấy `height` vô hiệu, phần tử cao 0, mất hẳn tranh nền mobile.
- Chuyển fallback vào khối `@supports not (height: 100lvh)` — thứ minifier không dám gộp.
  Đã soi CSS đã build: cả `height:100lvh` lẫn khối @supports với `177.683vh` cùng có mặt.
- Bài học ghi lại cho lần sau: fallback kiểu「hai dòng cùng property」phải được kiểm ở tầng
  ĐÃ BUILD, không phải tầng mã nguồn — chỗ đứng của nó chính là chỗ minifier ra tay.

---

## 0.33.2 — mobile được vuốt ngang để ngắm trọn tấm tranh nền

- **`cover` trên điện thoại là một cái máy chém.** Ảnh nền gốc 1672×941; màn 375px phủ theo
  chiều cao chỉ còn thấy 375/1443 ≈ **26% bề ngang** tấm tranh — Nam Cung Uyển dưới trăng mà
  người xem mobile chưa từng thấy mặt trăng. Yêu cầu của tông chủ: mobile phải ngắm được TRỌN
  bức tranh, bằng cuộn ngang lẫn dọc.
- **Đổi `fixed` thành `sticky` đúng tỉ lệ ảnh, chỉ dưới 768px.** `fixed` bị đóng đinh vào
  khung nhìn nên cuộn kiểu gì cũng không nhúc nhích; `sticky` với `top: 0` chỉ ghim chiều
  DỌC — cuộn xuống đọc nội dung thì tranh đứng yên như cũ, còn chiều ngang không ghim nên
  vuốt sang là tranh trôi theo canvas. App vẫn nằm nguyên bên trái đúng bề rộng màn hình;
  phần tranh thừa thò sang phải chờ được ngắm. Đo thật: pan 600px thì header trôi −600 và
  tranh lộ vùng mới, cuộn dọc 400px thì tranh vẫn ghim ở 0.
- **Cái bẫy thật sự không nằm trong CSS mà nằm ở viewport.** Dựng xong phần sticky, đo trong
  emulation mobile: `visualViewport.scale = 0.26` — trình duyệt điện thoại gặp trang tràn
  ngang là tự thu nhỏ cho vừa ("overview mode"), người dùng nhận một cái app kiến tí hon
  thay vì một bức tranh pan được, dù CSS đúng từng dòng. Vá bằng `minimumScale: 1` trong
  viewport export của layout: phần tràn trở thành CUỘN chứ không thành zoom-out. Phóng to để
  đọc chữ vẫn tự do — chỉ khoá chiều thu nhỏ.
- **Hai lối thoát có chủ ý:** điện thoại xoay ngang (khung nhìn rộng hơn ảnh tính theo chiều
  cao) thì `min-width: 100%` trả về cover quen thuộc, không mở cuộn ngang chỉ để lộ một dải
  màu lót — đo ở 667×375: không tràn. Desktop từ 768px giữ nguyên `fixed`, không đổi một
  pixel — đo ở 1280×800: vẫn `fixed`, không tràn ngang.
- Chi tiết đơn vị: bề rộng tranh tính bằng `100lvh` chứ không `100dvh`, vì dvh co giãn theo
  thanh địa chỉ mobile — mỗi lần nó trồi sụt là cả tấm ảnh đổi cỡ giữa lúc đang cuộn. Có
  fallback `100vh` cho trình duyệt cũ.

---

## 0.33.1 — cụm menu thôi nhảy ngang khi đổi tab

- **Thanh trên cùng đứng yên một chỗ trên mọi trang.** Bề rộng của nó từng là THAM SỐ do
  trang truyền vào: năm trang (trang chủ, Tông Môn, Nghị Sự Đường, phòng chờ, Hồ Sơ) nhận mặc
  định `max-w-5xl` = 1024px, còn Linh Đài với Hàng Đợi truyền `max-w-[100rem]` = 1600px. Đo
  trên màn 1920: mép phải cụm menu nằm ở **1441** trên trang chủ và **1729** trên Linh Đài —
  lệch **288 pixel mỗi bên**, và mắt bắt được ngay vì đó là thứ duy nhất có mặt ở cả hai
  trang. Giờ nó là hằng số.
- **Chốt ở bản RỘNG (1600px), không phải bản hẹp** — và đây là chỗ dễ chọn sai. Bề rộng nội
  dung thì vẫn nên khác nhau giữa các trang (một form Hồ Sơ kéo ngang 1600px là vô lý), nhưng
  phần vỏ thì không. Chốt vỏ ở 1024px sẽ khiến chính Linh Đài và Hàng Đợi — hai trang hay lui
  tới nhất và cũng là hai trang có nội dung rộng 1600px — mang một thanh trên cùng thụt vào
  so với hàng thẻ bên dưới, đúng cái lỗi mà tham số kia sinh ra để vá hồi 05/08. Chốt ở bản
  rộng thì hai trang ấy vẫn thẳng hàng, còn các trang hẹp chỉ đơn giản là có vỏ rộng hơn ruột
  — chuyện bình thường của mọi thanh điều hướng.
- **Bỏ hẳn tham số chứ không chỉ đổi giá trị mặc định.** Còn cái núm thì còn đường lệch trở
  lại ở trang tiếp theo ai đó thêm vào; bỏ nó đi thì TypeScript chặn ngay tại chỗ gọi.
- **`SHELL_WIDTH` gom về một bản duy nhất.** Linh Đài và Hàng Đợi trước đây mỗi trang tự khai
  một hằng cùng tên cùng giá trị — hai bản sao của cùng một con số là cách êm ái nhất để
  chúng lệch nhau về sau.
- Đo lại trên trình duyệt thật ở 1920px (vỏ 1024 → 1600, mép menu 1441 → 1729) và ở 375px
  (vỏ vẫn co giãn tràn khung, không sinh cuộn ngang) — bản vá chỉ chạm màn rộng, đúng nơi có
  lỗi.

---

## 0.33.0 — Cổng bái sư có công tắc, và mặc định luôn nghiêng về phía đóng

- **Trưởng môn tắt được bước xét duyệt.** Tab Môn Đồ của trang Tông Môn có thêm một công
  tắc: bật thì người mới bái sư dừng ở phòng chờ như xưa, tắt thì họ được thu nhận ngay lúc
  dâng thiếp và vào thẳng Linh Đài. Công tắc nằm ngay TRÊN cái hàng chờ mà nó cai quản, chứ
  không tách thành một tab cấu hình riêng — gạt xong là thấy hậu quả trong cùng một màn hình.
- **Mặc định là BẬT, và đó là phần đáng kể nhất của thay đổi này.** Mọi document cấu hình đã
  ghi trước bản này đều không có nhánh `membership`, nên giá trị default chính là thứ áp lên
  tất cả chúng ngay khoảnh khắc deploy xong. Default `false` nghĩa là cổng tông môn tự mở
  toang mà không một ai bấm gì. Một công tắc canh cửa chỉ được phép nghiêng về phía đóng khi
  chưa ai nói gì.
- **Trạng thái người mới sinh ra do tầng service quyết, không do người gọi truyền vào.**
  `register()` tự đọc môn quy thay vì nhận `status` qua đối số. Lý do rất cụ thể: form bái sư
  là thứ ngoài Internet chạm tới được, và hễ trạng thái khởi sinh đi vào bằng tham số thì sớm
  muộn cũng có một đường gọi chuyền thẳng dữ liệu form xuống — lúc ấy kẻ gõ cửa tự phong cho
  mình `active` bằng đúng một field thừa.
- **Đích đến sau khi bái sư đọc trạng thái THẬT vừa ghi xuống**, không đoán lại theo công
  tắc: giữa lúc `register()` đọc môn quy và lúc chuyển trang, trưởng môn có thể vừa gạt nó.
- **Tắt cổng KHÔNG với tay ngược về quá khứ** — ai đã đứng sẵn trong hàng chờ vẫn đứng đó.
  Đó là chủ ý (mở cổng là luật cho người tới sau, không phải một lệnh duyệt hàng loạt ngầm),
  nhưng im lặng về nó thì hàng chờ thành cái hố: không còn ai nghĩ tới việc phải dọn. Nên form
  đếm và nói thẳng「còn N đạo hữu trong hàng chờ」ngay khi tick tắt — **trước** lúc bấm lưu.
- **Trang bái sư thôi hứa cứng.** Phụ đề của nó là lời hứa đầu tiên tông môn nói với người
  lạ; hứa có bước xét duyệt trong khi cổng đang mở toang thì lời hứa ấy sai, và người ta phát
  hiện đúng lúc vừa bấm Bái Sư. Giờ nó đọc môn quy thật.
- **Và chính chỗ đó suýt hỏng theo kiểu chỉ bản build mới lộ ra.** `/register` là trang DUY
  NHẤT trong cả control plane được prerender tĩnh — vì nó là trang duy nhất không đọc gì cả.
  Cho nó đọc cấu hình mà không khai `force-dynamic` thì `next build` đọc công tắc đúng một
  lần rồi đóng băng câu trả lời vào HTML: gạt công tắc xong, trang bái sư vẫn hứa hẹn quy
  trình cũ cho tới lần deploy kế tiếp. Kèm theo đó, `next build` bắt đầu cần một database chỉ
  để dịch xong một trang — đúng thứ mà `src/lib/db/client.ts` cố tình tránh. Đã kiểm chứng
  bằng cách build với `DATABASE_URL` trỏ vào hư vô: build vẫn xanh.
- **`npm run verify:membership`** đo cả hai chiều công tắc trên database thật, và chốt luôn
  cái default: document rỗng cũng như document cũ (chỉ có `chat`) đều phải ra `requireApproval
  = true`. Script động vào cấu hình toàn hệ thống thật nên nó in giá trị gốc ra trước khi
  chạm, khôi phục trong `finally`, rồi ĐỌC LẠI để xác nhận — khôi phục hụt là loại thất bại
  phải hét lên, vì hậu quả của nó là cổng tông môn nằm sai chiều trong im lặng.

---

## 0.32.0 — Hoang Vực viết lại từ bản ghi 06/08 21:00, và mỗi hạng có nhịp riêng

- **Vỏ trang boss KHÔNG trung lập — nó mời gọi, và đó chính là con bug.** Lấy thẳng từ DOM của
  bản ghi: `#battle-button` được server giao ra đang **MỞ**, còn `#countdown-timer` giao ra
  `display:none` và **RỖNG**. Sự thật đến sau bằng XHR, và nó chỉ biết **LẤY ĐI** lời mời. Nên
  một trang chưa vẽ xong **trông y hệt** trang nói「đánh được」— mọi đêm Hoang Vực thất bại trên
  linh sứ tông môn đều là một lượt ghé rơi vào giữa cooldown, đọc phải cái vỏ lạc quan ấy, rồi
  lao vào một trận mà server sẽ từ chối. Bản 0.30.0 dạy engine rằng một **sự vắng mặt** có thể
  là「chưa vẽ tới」; đây là đúng bài học đó lật ngược dấu — ở đây **sự có mặt của lời mời** mới
  là lời nói dối. Flow giờ cho XHR trạng thái một cửa sổ có hạn trước khi tin lời mời.
- **「Hết lượt」và「đang chờ」thôi dùng chung một câu.** Trang giữ sẵn một nhân chứng mà script cũ
  bỏ qua: `.remaining-attacks` do **server render**, đúng ngay từ byte đầu tiên. Số 0 ở đó nghĩa
  là hết ngày — và nó được hỏi **TRƯỚC** cửa sổ chờ, vì một tài khoản hết lượt không bao giờ mọc
  ra đồng hồ, hỏi sau thì mỗi lượt ghé còn lại trong ngày đều phải trả trọn cửa sổ. Đo trên
  trang thật: phép dừng giờ trả lời trong **0,8 giây** với đúng chữ「đã hết 5 lượt hôm nay」thay
  vì đốt 12 giây để đoán.
- **Mỗi hạng một nhịp, đúng như luật của site.** Trang boss tự in:「Tấn công boss mỗi 15 phút 1
  lần」— đó là nhịp của tài khoản **thường**. Bản ghi quay trên tài khoản **VIP** đo được nửa còn
  lại: hồi đáp của đòn đánh mang mốc đánh kế cách **451 giây**, trang đếm ngược từ「7 phút 20
  giây」. `fallbackCooldownSeconds` giờ là **450 (VIP) / 900 (thường)**; con số 420 dùng chung
  trước đây sai cho cả hai, và nó bắt tài khoản thường quay lại gần gấp đôi số lần họ có thể đánh.
- **Bằng chứng đòn đánh được nới 30s → 45s.** Bản ghi bấm giờ cả chuỗi thật: POST trả lời ngay,
  nhưng hoạt ảnh sát thương chạy ~11 giây và đồng hồ chỉ thay chỗ cái nút ở ~12 giây — trên
  đường truyền nhà, một tab. Ba tab trên VM hai nhân mới là thứ ngân sách này sinh ra để chịu.
- Hai hạng chạy **cùng một kịch bản**, và không có gì rẽ nhánh theo chế độ chạy: tuần tự với
  song song chỉ khác nhau ở việc trang vẽ nhanh hay chậm — đúng thứ mà cửa sổ có hạn kia hấp thụ.
- **Fixture được dựng lại cho trung thực, và đó là phần khiến phép thử có răng.** Nó giao đúng
  cái vỏ mời gọi (nút mở, đồng hồ rỗng và ẩn) với XHR tới muộn; quan trọng hơn, server giả giờ
  **từ chối theo sự thật của chính nó** chứ không theo thứ trang đã kịp vẽ — gác theo DOM thì
  một flow bấm bừa vào vỏ trang lại được tha bổng đúng vào khoảnh khắc nó sai nhất. Ca đối chứng
  vĩnh viễn chạy flow không-có-đệm trên chính cái bẫy ấy: nó bấm vào cooldown và bị từ chối.
- Kiểm chứng: smoke **187/187**; trên **site thật**, phép dừng hết-lượt trả lời trong 0,8 giây
  đúng lý do, và một lượt chạy trước đó đã đánh thật rồi đọc lại đồng hồ 436 giây. TypeScript và
  production build sạch. Hồ sơ lên **schema 50**, cùng nhịp desktop 1.47.0.

## 0.31.0 — cổng Điều Hòa chờ vùng đếm được, không chờ nút mở khoá

- **Lò nổ lần nữa (19:01 ngày 06/08), đúng một vòng sau bản vá 0.30.0 — và nhật ký kể lại
  từng giây.** Bản 0.30.0 đổi cổng chờ lần-Điều-Hòa-đầu từ chuỗi「68%」(sống đúng một giây)
  sang `enabled #ldBtnTune`, với giả định site khoá nút tới khi lửa ≤ 68%. Đọc
  `luyen-dan.min.js` trên trang thật thì giả định ấy sai: khoá nút chỉ là
  `stability ≥ 99.99 || cooldown || request đang bay` — **nút mở từ 99.98%**. Vòng giữ lửa
  vì thế bấm sáu cú ở ~99-85%, server nhận đủ sáu request và không đếm cú nào (Vt() chỉ tính
  một cú vào 3 lần sống sót khi % ≤ 68), sáu vòng cạn trong ~46 giây, mẻ đan chết ở 0/3 —
  khớp nhật ký production đến từng giây.
- **Cổng mới là dấu hiệu「bấm bây giờ thì được đếm」của chính trang**: `#ldStabilityWrap`
  mang class `is-tune-weak` đúng khi pha bất ổn đang chạy + chưa đủ 3 lần + lửa ≤ 68% — cùng
  phép thử ba vế mà trang dùng cho nhãn của nó. Cú hai và ba vẫn đi theo nhịp 6.5s như bản
  ghi (video gốc cho thấy chúng được đếm ở ~89%; cổng chỉ gác cú đầu).
- **Ngân sách vòng phủ trọn pha bất ổn** (maxSeconds 240 → 300): tốc độ tụt nhân với áp suất
  server đặt (0.5-1.5), riêng đường xuống 68% đã có thể mất ~64-190 giây.
- **Fixture lần trước chính là đồng phạm, và nó bị xử trước tiên.** Nó mô hình nút
  khoá-tới-68 — khớp với bản vá thay vì khớp với site — nên smoke 0.30.0 xanh trong khi
  production nổ. Fixture giờ mô hình đúng cơ chế đo được: nút mở từ 99.98%, bộ đếm `wasted`
  cho những cú bấm ngoài vùng đếm được, và tốc độ tụt đủ chậm để sáu cú bấm mù kết thúc
  TRƯỚC khi lửa chạm 68 — giữ nguyên bất đẳng thức của sự cố thật. Một ca đối chứng vĩnh
  viễn chạy chính flow 0.30.0 trên fixture ấy: đỏ (failed, đếm 0, hụt 6). Flow mới: 3/3,
  không hụt phát nào — smoke **187/187**.
- Hồ sơ lên **schema 49**, cùng nhịp desktop 1.46.0.

## 0.30.0 — trang chưa kịp vẽ không phải là trang nói không

Hai lỗi được báo cùng lúc, và cùng chỉ xuất hiện khi **bật chạy song song các nhiệm vụ**:
Hoang Vực không hoạt động lần nào, còn Luyện Đan Đường thỉnh thoảng không điều hòa nên nổ
đan lô. Hoá ra là **một nguyên nhân**: trang game vẽ làm hai đợt — vỏ do server dựng, ruột do
một XHR trạng thái vẽ 2–4 giây sau — và engine đang đọc「chưa vẽ tới」y hệt「trang trả lời
KHÔNG」. Chạy song song không tạo ra lỗi; nó chỉ kéo dài đúng cái khe hở ấy cho tới khi lỗi
lộ ra. Cả hai đều **báo thành công** trong lúc chạy hụt, nên không ai biết cho tới khi ngồi
đếm số lượt.

- **`stopIf` thôi kết luận từ một mẫu duy nhất của sự VẮNG MẶT.** `hidden` nghĩa là「không
  phần tử nào khớp mà đang hiện」— và một selector CHƯA CÓ MẶT trong DOM cũng thoả mãn nguyên
  văn câu đó. Giữa hai đợt vẽ thì mọi nút của trang đều「hidden」. Với Hoang Vực, mẫu ấy rơi
  vào khoảng trống và nhiệm vụ dừng ở「chưa đánh được (đang chờ lượt hoặc đã hết 5 lượt hôm
  nay)」— mức alreadyDone, không một dòng lỗi — mỗi vòng, suốt cả ngày, trong khi「Lượt đánh
  còn lại」không hề nhúc nhích khỏi 5.
- **Phép phân biệt là SỰ CÓ MẶT TRONG DOM, không phải sự hiển thị — và chính điều đó giữ cho
  bản vá gần như miễn phí.** Nút còn trong DOM mà mang `display:none` là trang ĐÃ trả lời
  (đang cooldown, hết lượt): lượt dừng đi thẳng, không tốn một mili giây. Chỉ khi selector
  không khớp gì cả engine mới nán lại 8 giây xem nó có hiện ra không — hiện ra thì lượt dừng
  bị huỷ và nhiệm vụ đi tiếp, không hiện thì lượt dừng vốn là thật.
- **Luyện Đan Đường chờ site MỞ KHOÁ nút Điều Hòa, thay vì chờ kim lửa chỉ đúng「68%」.** Chuỗi
  cũ không mơ hồ, nhưng nó chỉ sống được khoảng một giây: lửa tụt ~0,33%/giây nên「68%」hiện ra
  một lần rồi thành「67%」và không bao giờ quay lại. Tới muộn một nhịp là cái chờ 110 giây không
  bao giờ về — dài hơn cả ngòi nổ của mẻ đan — và lò nổ với **0/3 lần giữ lửa**. Ngưỡng là một
  TRẠNG THÁI, và site giữ sẵn trạng thái ấy: nó khoá nút cho tới khi % ≤ 68. Áp cho **cả hai
  hạng** (VIP và Thường dùng chung script).
- **Vì sao chỉ hỏng khi song song**: ba tab cùng dựng trang thì mỗi bước chậm đi một nhịp, đủ
  để mẫu của `stopIf` rơi trước đợt vẽ thứ hai, và đủ để script tới lò sau khoảnh khắc「68%」.
  Bản desktop chạy tuần tự nên thoát nạn — nhưng cùng hai bản vá đã được port sang đó (1.45.0),
  vì engine và hồ sơ là tri thức dùng chung, để lệch là hẹn ngày gặp lại.
- Hồ sơ lên **schema 48**, đồng bộ với desktop 1.45.0 cùng đợt.
- Kiểm chứng: smoke **183/183** trên Chromium thật. Bảy ca mới dựng lại ĐÚNG hai sự cố bằng
  fixture vẽ hai đợt và một kim lửa tụt thật: gỡ bản vá ra thì Hoang Vực trả alreadyDone với
  lượt đánh nguyên vẹn và lò nổ ở 0/3, lắp vào thì lượt boss 5 → 4 và lò đạt 3/3 — Đan Lô an
  toàn. Có cả ca giữ cho đường dừng hợp lệ không bị chậm đi (đang cooldown vẫn dừng tức thì).

> **Phải cài đè linh sứ thì bản vá mới có hiệu lực** — engine và hồ sơ nằm trong gói linh sứ,
> deploy web chỉ phát hành gói mới chứ không đụng được vào tiến trình đang chạy ở máy khác.

## 0.29.0 — Hoang Vực phải chứng minh đòn đánh, và ngọc giản đi trước engine thì phải kêu lên

Hai lỗi được báo cùng lúc, và hoá ra chỉ có một thứ chung: **sự im lặng**. Cả hai đều chạy
hụt mà vẫn báo bình thường, nên không ai biết cho tới khi ngồi đếm số lượt.

- **Hoang Vực báo「xong」cho những trận chưa từng đánh.** Nhật ký đêm 06/08:「Hoang Vực: xong」
  cứ 7 phút một lần — đúng bằng `fallbackCooldownSeconds` 420 giây, tức KHÔNG lần nào đọc được
  đồng hồ — trong khi「Lượt đánh còn lại」đứng nguyên ở 5 suốt đêm. Nguyên nhân: sau cú bấm Tấn
  Công, **mọi bước còn lại đều `optional`** (bảng tổng kết, nút đóng, đường về) nên một cú bấm
  bị trang nuốt cho ra kết quả y hệt một trận đánh thật.
- **Giờ có một bước BẮT BUỘC ngay sau cú bấm: chờ nút KHIÊU CHIẾN biến mất.** Chọn nhân chứng
  ấy vì nó trả lời cho CẢ HAI kết cục — đòn trúng thì vào cooldown ~7 phút, đòn cuối ngày thì
  hết lượt, site đều ẩn nút; đó cũng chính là sự thật mà `stopIf` của quest này vẫn dựa vào từ
  đầu. Đo trên trang thật: lúc cooldown nút mang `display:none`, nên phép kiểm `hidden` đọc
  đúng kể cả khi màn đánh còn phủ lên trên. Áp cho cả hai hạng (bản thường dùng chung script).
- **Ngọc giản bật một nhiệm vụ mà engine không biết → nay nói thẳng ra.** Đây là lỗi Hỷ Sự
  Đường: đạo hữu bật nó, ngọc giản lưu `hySuDuong: true`, snapshot của job mang nguyên giá trị
  ấy sang linh sứ — nhưng linh sứ đang chạy **gói cũ**, `SIMPLE_QUESTS` của nó chưa có khoá đó,
  nên nhiệm vụ biến mất không để lại dấu vết. Nhật ký chỉ liệt kê 7 nhiệm vụ và không nói vì
  sao thiếu cái thứ 8; phải lần ngược snapshot trong database mới tìm ra. Lớp dịch giờ đối
  chiếu khoá đang bật với những khoá nó biết, và kêu lên:「linh sứ đang chạy gói cũ. Cài đè
  linh sứ để nhận nhiệm vụ mới.」Một dòng ấy thay cho cả cuộc truy vết.
- Hồ sơ lên **schema 47**, xuất từ bản desktop 1.44.0 cùng đợt.
- Kiểm chứng: smoke **176/176** trên Chromium thật. Trong đó ca ăn tiền dựng lại ĐÚNG sự cố —
  một trang boss mà nút Tấn Công nhận cú bấm rồi không làm gì: trước bản vá nó cho「xong」, giờ
  nó `failed` và gọi đúng tên nhân chứng `#battle-button`; còn đòn đánh thật vẫn `completed` và
  đọc được đồng hồ 7 phút 19 giây. Thêm một lượt chạy trên **site thật** xác nhận script đã sửa
  vẫn đánh được: lượt 4 → 3, cooldown 437 giây. TypeScript và production build sạch.

> **Phải cài đè linh sứ thì hai bản vá này mới có hiệu lực** — engine và hồ sơ nằm trong gói
> linh sứ, deploy web chỉ phát hành gói mới chứ không đụng được vào tiến trình đang chạy ở máy
> khác. Chính điều đó là lý do Hỷ Sự Đường không chạy từ đầu.

## 0.28.0 — Mê Cung trên ghế chung luôn dừng khi đã đủ huyền tinh

- **「Dừng khi đã đủ huyền tinh trong ngày」của Mê Cung bị khoá BẬT với đạo hữu thường.**
  Mê Cung là nhiệm vụ duy nhất giữ một phiên trình duyệt hàng chục phút, mà linh sứ tông môn
  chỉ có vài ghế và cả tông môn dùng chung. Bỏ tick ấy nghĩa là đánh hết lượt — một đàn có
  thể ngồi trong Mê Cung gần trọn ngày, và vài đàn như vậy là những người còn lại xếp hàng
  cả ngày mà không hiểu vì sao mãi không tới lượt. **Tông chủ được miễn**: người vận hành
  cái VM ấy phải có đường tự quyết định dùng nó thế nào.
- **Bấm vào ô đã khoá thì hiện hộp cảnh báo, rồi ô tự tick lại.** Cố ý KHÔNG dùng thuộc tính
  `disabled`: một ô bị khoá cứng nuốt luôn cú bấm, không còn sự kiện nào để mà giải thích, và
  người dùng chỉ thấy một ô không nhúc nhích — bấm lại, lại hụt, rồi kết luận trang hỏng. Ô
  này nhận cú bấm, từ chối nó, rồi NÓI vì sao.
- **Luật nằm ở ba lớp, vì mỗi lớp bịt đúng chỗ hai lớp kia không với tới.** Giao diện chỉ là
  phép lịch sự — một POST dựng tay chẳng đi qua form lần nào. Đường **lưu** ngọc giản ép lại
  theo vai của chính người gọi, và **nói ra** khi nó đã ghi đè (im lặng sửa một lựa chọn
  người ta vừa bấm là cách nhanh nhất để họ tin ngọc giản không nghe lời mình). Nhưng đường
  lưu chỉ chạm được những người còn bấm nút: **document đã nằm sẵn trong database với
  `capCheck: false` từ trước luật này** thì không đường ghi nào với tới. Nên lớp thứ ba nằm ở
  **cửa phát việc** — chỗ duy nhất mọi vòng chạy đều đi qua.
- **Lớp thứ ba gác theo SCOPE của linh sứ, vì luật nói về CÁI MÁY chứ không về con người.**
  Linh sứ riêng chạy trên máy của chính đạo hữu: họ tiêu tài nguyên của mình và không ai phải
  xếp hàng sau lưng, nên ghế riêng không chịu luật của ghế chung. Chi phí: thêm đúng một phép
  đọc theo khoá chính cho mỗi lần PHÁT ĐƯỢC việc — không phải mỗi nhịp hỏi việc. Không tra ra
  chủ nhân thì coi như người thường: luật siết, không nới.
- Kiểm chứng: smoke **164/164**, trong đó mười ca mới ghim luật thuần (tông chủ được miễn,
  người thường bị ép, không đụng vào lựa chọn nào khác, không sửa vật gốc, và trả về CHÍNH
  vật cũ khi không phải sửa — mẹo so tham chiếu mà đường lưu dựa vào để biết có nên báo hay
  không) cùng ba chốt trên NGUỒN rằng cả hai cửa ghi/chạy đều áp luật và linh sứ riêng thì
  không; TypeScript và production build sạch.

## 0.27.0 — Hàng đợi nói rõ mỗi tài khoản đang làm nhiệm vụ gì

- **Mỗi dòng hàng đợi giờ kể tên nhiệm vụ đang chạy**, kèm bộ đếm「3/8 nhiệm vụ」. Trước đây
  một đàn chạy bốn mươi phút chỉ hiện đúng hai chữ「Đang chạy」— không phân biệt được nó
  đang cày Mê Cung hay đã treo từ lâu. Chạy song song thì hiện ĐỦ các nhiệm vụ đang trong
  tay (mặc định tới 3 tab), vì kể một cái là nói dối về hai cái còn lại.
- **Thứ này trước đây không tồn tại dưới dạng dữ liệu.** Tiến trình một vòng chỉ sống trong
  văn xuôi của nhật ký (「Mê Cung: xong」), và dựng giao diện bằng cách dò chuỗi trong log
  của chính mình là buộc một cột trên màn hình vào cách hành văn của một dòng log — mà bản
  0.25.2 vừa viết lại đúng mấy dòng ấy. Nên linh sứ khai thẳng: cột `cycle_progress`
  (migration 0010) và một trường mới **đi kèm nhịp tim sẵn có, không thêm một request nào**.
- **Linh sứ đời cũ không vỡ, chỉ im.** Trường mới là tuỳ chọn: linh sứ chưa cài lại vẫn chạy
  y như trước, dòng của nó chỉ thiếu phần tên nhiệm vụ. **Muốn thấy tên thì cài đè linh sứ**
  (engine nằm trong gói) — linh sứ tông môn đã được cài trong đợt này.
- **Vắng trường KHÁC HẲN gửi rỗng.** Vắng = "linh sứ đời cũ, giữ nguyên cột"; rỗng = "đang
  giữa hai nhiệm vụ". Lẫn hai cái là biến mỗi nhịp tim của linh sứ cũ thành một lệnh xoá lặp
  lại mỗi 5 giây.
- **Trigger có mệnh đề `WHEN`, và đó là toàn bộ giá trị của nó.** Trigger `AFTER UPDATE OF
  <cột>` của Postgres nổ khi cột được NHẮC TỚI trong `SET`, không phải khi giá trị đổi —
  thiếu WHEN thì mỗi nhịp tim của mỗi đàn đánh thức MỌI trang hàng đợi đang mở để vẽ lại
  đúng cái vừa vẽ. Đo được trên database thật: 5 lần gửi lại y nguyên tiến độ → **0 tín
  hiệu**; đổi thật → 1; dọn về null → 1 (phải là `IS DISTINCT FROM`, `<>` gặp NULL trả NULL
  và sẽ im lặng đúng hai lúc cần vẽ lại nhất).
- **Ranh giới riêng tư dịch một nấc, có chủ ý.** Dòng của mình: đủ tên nhiệm vụ. Dòng người
  khác: **chỉ con số**, không bao giờ có tên — tên nhiệm vụ là cấu hình nhiệm vụ, thứ nằm
  bên phía「không bao giờ」từ ngày trang này ra đời. Con số được phép qua vì nó trả lời đúng
  câu hỏi trang sinh ra để trả lời: cái ghế linh sứ tông môn kia sắp trống chưa.
- Tiến độ được **dọn ở cả ba cửa** — nhận việc, xong vòng, và lúc reaper kết liễu một đàn
  mất nhịp tim — nếu không thì một đàn đang nghỉ hiện lên là「đang nghỉ — Mê Cung」suốt cả
  cooldown.
- Kiểm chứng: smoke **154/154** trên Chromium thật, trong đó bảy ca mới lái `runCycle` THẬT
  qua cả hai nhánh song song và tuần tự rồi soi chuỗi tiến độ nó phát ra (bộ đếm không lùi,
  không tên nào mắc kẹt lại, nhánh tuần tự không bao giờ cầm hai nhiệm vụ một lúc);
  `verify:continuous` trên database thật ghim vòng đời cột (ghi được, linh sứ cũ không bị
  xoá trắng, dọn đúng ở claim/complete) và **dựng hai đạo hữu để chứng minh tên nhiệm vụ của
  người khác không lọt ra ở bất kỳ đâu trong ảnh chụp**; TypeScript và production build sạch.

## 0.26.0 — Hỷ Sự Đường: đi chúc phúc các tiệc cưới (tab Thường)

- **Nhiệm vụ mới ở tab Thường: Hỷ Sự Đường** — viết từ recording 05/08 trên site thật
  (`hy-su-duong-20260805-223044`). Nút Hỷ Sự Đường bên `/tien-duyen` mở modal「Đại Điển
  Đang Diễn Ra」; mỗi vòng vào phòng đầu tiên còn「Chưa chúc」, chọn NGẪU NHIÊN một lời
  chúc mặc định (đúng ghi chú của người ghi hình), gửi qua hộp xác nhận rồi mở lại danh
  sách — tới khi hết phòng chưa chúc. Không giới hạn lượt trong ngày: chính lời chúc là
  thứ rút dần điều kiện dừng của vòng lặp.
- **Vào phòng bằng điều hướng, không bấm link.**「Vào Chúc Ngay」mang `target=_blank` —
  bấm nó là flow lạc sang tab thứ hai — nên script đọc href của hàng rồi `location.assign`
  ngay trong tab. Phòng Đạo Lữ (`/phong-cuoi`, dạng trang đã có recording) đi trước phòng
  Hồng Nhan (`/hong-nhan`, chưa ghi hình được): trang chưa kiểm chứng chỉ có thể làm hỏng
  lượt SAU KHI mọi phòng đã kiểm chứng được chúc xong — và hỏng thì kêu to, đó là cách
  trang ấy kiếm được recording của riêng nó.
- **Ghi nhận = nút gửi biến mất khỏi DOM** (state event trong recording: server nhận là nút
  bị gỡ hẳn; gửi bị từ chối thì nút ở lại). Mỗi lời chúc tốn 30 Tiên Ngọc, nhận 120 Tu Vi —
  nên bước chờ ấy bắt buộc, quest tắt sẵn, và giá nói rõ ngay trên form (luật của Luyện
  Đan Đường).
- **Bao lì xì nhặt kiểu cơ hội**: trang phòng cưới có style `.lixi-envelope` nhưng chưa
  recording nào bắt được lúc phát, nên cú bấm là optional + guard Visible — đoán sai
  markup thì bước tự bỏ qua, flow chính không suy suyển.
- Hồ sơ lên **schema 46**, xuất từ bản desktop 1.43.0 cùng đợt — hai sản phẩm vẫn đọc
  chung một tri thức site. Form thêm đúng một công tắc ở tab Thường; tab VIP không thấy
  nó, vì hồ sơ không có twin VIP — một ô tick ở đó là lời hứa suông.
- Ghim bằng smoke trên Chromium thật trước sảnh cưới replica (server nhớ phòng đã chúc
  đúng như site thật): chúc đủ ba phòng theo thứ tự ưu tiên, lời chúc ngẫu nhiên không rơi
  vào ô trống, lì xì nhặt đúng một phòng đang phát, và hai lý do dừng phân biệt rõ —
  「đã chúc phúc hết các tiệc đang mở」khác「không có tiệc cưới nào đang diễn ra」—
  **138/138**.

## 0.25.2 — nhật ký tu luyện thôi nói tiếng của script

- **「stopIf khớp — đã tế lễ hôm nay」giờ chỉ còn「đã tế lễ hôm nay」.** Lý do dừng vẫn hiện
  ở mức info — đó là câu trả lời người ta mở nhật ký lên để tìm — nhưng nói TRẦN: "stopIf"
  là tên một loại bước trong script, ngôn ngữ của người viết flow chứ không phải của người
  đọc nhật ký (ảnh người dùng gửi 05/08 là bằng chứng nó gây khó hiểu).
- **「repeat kết thúc sau 6 vòng — trần số vòng (6)」rút khỏi nhật ký người dùng**, xuống
  kênh debug của máy đang chạy. Câu chuyện người đọc cần đã nằm ở lời kể của chính quest
  (「Giữ lửa 1/3」…) và dòng kết quả cuối lượt (「Luyện Đan Đường: xong」); chi tiết vòng
  lặp là chẩn đoán, không phải tường thuật.
- Bản desktop sửa cùng cặp dòng trong cùng ngày (1.42.1) — hai sản phẩm là một tool, nhật
  ký không được phép lệch giọng.
- Ghim bằng smoke: kênh info sau một lượt chạy thật không được chứa "stopIf", "repeat" hay
  "until", và lý do dừng phải hiện trần — **130/130**. Linh sứ cần cài đè để nhận (engine
  nằm trong gói); linh sứ tông môn đã được cài trong đợt phát hành này.

## 0.25.1 — hàng đợi chuyển sang trực tiếp; Tụ Nghĩa Sảnh đổi tên thành Nghị Sự Đường

- **Hàng đợi sống bằng SSE thay vì hỏi lại mỗi 5 giây.** Nhịp poll cũ có chạy — đo được màn
  hình tự đổi sau đúng 5,0 giây, không cần F5 — nhưng năm giây là năm giây, và trang này tồn
  tại để người ta đứng nhìn hàng chờ nhích. Kênh mới đo được **0,4 giây**.
- **Route riêng `/api/queue/stream`, không dùng lại kênh của Linh Đài.** Kênh kia chỉ vẽ lại
  khi tín hiệu mang đúng userId của người nghe; hàng đợi thì đàn của bất kỳ ai đổi cũng làm
  thứ tự của mọi người đổi theo. Nới cái lọc ấy ra là biến một kênh riêng tư thành kênh chung
  — một lỗi lọc sai ở đó sẽ rò dữ liệu người khác. Hai route tách bạch: kênh cũ giữ nguyên
  luật riêng tư, kênh mới tự dựng payload **đã che tên** cho từng người nghe.
- **Hai nguồn đánh thức, vì hàng đợi đổi theo hai cách.** NOTIFY của Postgres lo phần job
  sinh ra / đổi trạng thái / đổi giờ chạy. Nhưng một đàn đang nghỉ tự vào hàng khi
  `next_run_at` trôi qua — **không có thay đổi nào trong database để mà báo** — nên stream
  còn hẹn sẵn một cái đồng hồ đúng mốc ấy. Thiếu nhánh này thì số thứ tự đứng im cho tới khi
  tình cờ có ai đó làm việc khác. Kiểm chứng: một đàn hẹn hết cooldown sau 6 giây đã **tự**
  nhảy vào hàng với số thứ tự 1, không ai đụng database và không F5.
- Chủ đề `event` bị bỏ qua có chủ ý: mỗi dòng nhật ký của mọi linh sứ đều phát một tín hiệu,
  mà nhật ký không hề xuất hiện trên trang này — nghe nó là tự bắt mình đọc lại database hàng
  chục lần mỗi vòng chạy để rồi không vẽ gì khác.
- **Huy hiệu「Trực tiếp」chỉ nói về kênh SSE**, không nói về việc dữ liệu có tới hay không.
  Lưới an toàn (hỏi lại 30 giây khi kênh sống, 2 giây khi đứt) cố ý KHÔNG bật cờ ấy — kênh đã
  đứt mà màn hình vẫn khoe "trực tiếp" là một lời nói dối nhỏ, đúng vào thứ người dùng dựa
  vào để tin con số.
- **Đổi tên「Tụ Nghĩa Sảnh」→「Nghị Sự Đường」** ở thanh điều hướng, tiêu đề trang, tiêu đề
  phòng, mục cài đặt bên Tông Môn và trong hướng dẫn. Các entry CHANGELOG cũ giữ nguyên tên
  cũ: chúng là lịch sử, sửa lại là làm sai bản ghi.
- Câu giải thích luật hàng đợi rút gọn theo yêu cầu (bỏ vế nói về che tên — phần ấy đã tự
  hiển nhiên trên bảng).
- Kiểm chứng trên Chromium thật: 9 phép thử mới (câu chữ đúng từng chữ, câu cũ đã mất, thanh
  điều hướng đổi tên, huy hiệu trực tiếp, chuyển trạng thái do đồng hồ, số thứ tự) + 14 phép
  thử riêng tư hai-đạo-hữu chạy lại trên bản SSE + smoke **129/129**; TypeScript và production
  build xanh.

## 0.25.0 — Hàng Đợi Công Việc: cả tông môn nhìn chung một hàng chờ

- **Trang mới `/hang-doi`**, có lối vào ngay trên thanh trên cùng. Nó trả lời đúng một câu
  hỏi mà Linh Đài không trả lời được: *đàn của tôi đứng thứ mấy, và vì sao chưa tới lượt?*
  Trước đây mỗi người chỉ thấy đàn của chính mình, nên một lượt chờ lâu trông y hệt một lượt
  hỏng.
- **Số thứ tự là thứ tự THẬT.** Truy vấn sắp xếp đúng như câu `claimNextJob` của linh sứ
  (`next_run_at`, rồi `created_at`), nên con số trên màn hình chính là thứ tự sẽ được nhặt
  việc, không phải một cách sắp xếp riêng của giao diện. Ba trạng thái được tách bạch thay vì
  gộp làm một: **đang chạy** (đã ra khỏi hàng), **chờ tới lượt** (đã tới giờ, đang xếp hàng),
  **đang nghỉ** (chưa hết cooldown nên chưa vào hàng) — gộp lại là nói dối về độ dài hàng chờ.
- **Tên đạo hữu khác được che 2/3**, giữ lại đầu tên đủ để chủ nhân tự nhận ra mình. Phép che
  đếm theo code point (tên có dấu hoặc emoji cắt theo đơn vị UTF-16 sẽ ra ký tự lỗi) và luôn
  che **ít nhất** hai phần ba — tên ngắn dưới ba ký tự bị che sạch, vì lộ một trong hai chữ
  cái đã là quá nửa và lời hứa phải đúng với mọi cái tên.
- **Ranh giới riêng tư được ghim bằng kiểm chứng, không bằng lời hứa.** Của người khác chỉ
  hiện: tên đã che, trạng thái, thời điểm chạy kế, số vòng, và linh sứ thuộc hạng nào
  (tông môn / riêng). KHÔNG BAO GIỜ: tên tài khoản game, cookie, cấu hình, id linh sứ riêng —
  ba thứ đầu là bí mật, thứ tư là danh tính một cái máy cụ thể. Bài kiểm dựng hai đạo hữu tạm
  rồi soát cả payload API lẫn HTML đã render, vì rò rỉ có thể nằm trong payload dù màn hình
  không vẽ ra.
- **Không dùng lại kênh SSE của Linh Đài**: kênh ấy lọc theo đúng một người, biến nó thành
  kênh chung là mở đường cho một lỗi lọc sai làm rò dữ liệu người khác. Trang này có endpoint
  đọc riêng, tự che tên ngay trong service, và hỏi lại mỗi 5 giây — ngừng hỏi khi tab bị ẩn.
- Kiểm chứng: 14 phép thử end-to-end trên Chromium thật với hai đạo hữu tạm (xoá cascade sau
  khi xong) + 6 assert cho phép che tên trong smoke (**129/129**); TypeScript + production
  build xanh.

## 0.24.2 — mỗi khu nhiệm vụ có ô「Chọn tất cả」

- **Hai khu nhiệm vụ một-công-tắc** (Nhiệm vụ ngày ở tab VIP, Nhiệm vụ tài khoản thường ở
  tab Thường) có thêm một dòng đầu khu: ô「Chọn tất cả」bên trái, bộ đếm「N/M đang bật」bên
  phải. Bật mười nhiệm vụ giờ là một cú bấm thay vì mười.
- **Ô tổng chỉ đụng nhiệm vụ của CHÍNH khu nó.** Hai lưới dùng chung một state — bảy mục của
  tab Thường là tập con của mười mục tab VIP — nên một ô tổng quét cả bảng sẽ lặng lẽ bật Bí
  Cảnh và Phúc Lợi VIP cho người chỉ định bật đủ nhiệm vụ tài khoản thường. Đã ghim bằng
  kiểm chứng: bấm ô tổng tab Thường xong, tab VIP còn đúng ba mục riêng của VIP.
- **Ba trạng thái chứ không phải hai**: bật hết → tick, tắt hết → trống, bật một phần →
  gạch ngang (`indeterminate`). Thiếu trạng thái thứ ba thì "đang bật 9/10" trông y hệt
  "chưa bật gì".
- Ô tổng **không mang `name`**, đúng luật đã đặt từ 0.20.0: nguồn FormData duy nhất vẫn là
  các hidden input, nên không có đường nào để màn hình nói một đằng mà thứ được lưu một nẻo.
- Kiểm chứng end-to-end trên Chromium thật với một đạo hữu tạm (xoá cascade sau khi xong):
  14 phép thử đi hết đường bấm-chuột → hidden input → server action → JSONB, gồm cả vòng
  "bấm khi đang dở thì bật hết, bấm khi đã đủ thì tắt hết" và phép đọc lại database xác nhận
  lưu đúng ba mục đang hiện trên màn hình. TypeScript + production build + smoke 123/123 xanh.

## 0.24.1 — chạy song song có trần: tám trang cùng dựng làm các tab thua cuộc đua CPU

- **Triệu chứng**: tài khoản thường「Donald Trump」rải lỗi `Selector không bao giờ xuất hiện`
  gần như mỗi vòng — 18 dòng lỗi trong 10 vòng — nhưng KHÔNG cố định ở nhiệm vụ nào: Luyện
  Đan `#ld-app` 7 lần, Tế Lễ `#te-le-button` 4, Vấn Đáp 3, Vòng Quay 3, và một lần trượt cả
  `.nv-quest` của chính hub. Cùng khoảng thời gian đó tài khoản VIP chạy 10 nhiệm vụ, **0
  lỗi trong 9 vòng**.
- **Nguyên nhân**: nhịp song song ở 0.22.0 mở **một tab cho MỖI nhiệm vụ, không giới hạn**.
  Tài khoản thường bật 8 nhiệm vụ, và 8 nhiệm vụ ấy là **8 trang khác nhau** cùng dựng một
  lúc trên VM 2 nhân; tab nào thua cuộc đua CPU thì hết 25 giây chờ mà trang chưa dựng xong,
  và engine gọi đó là "selector không xuất hiện". Tài khoản VIP thoát nạn chỉ vì 7 trong 10
  nhiệm vụ của nó bấm nút ngay trên hub — bảy tab cùng mở MỘT trang đã nằm trong cache, gần
  như miễn phí. Đo tại chỗ trên VM lúc hai vòng chồng nhau: **load average 3.20 trên 2
  nhân**, tức hàng đợi CPU dài gấp rưỡi số nhân. Bằng chứng chốt lại: vòng 11:34 hỏng ở
  Hoang Vực + Tế Lễ — hai nhiệm vụ hoàn toàn khác — đúng vào giây tài khoản VIP mở thêm 10
  tab. Không phải hạng tài khoản, không phải trang nào hỏng, không phải tính năng chưa mở.
- **Cách chữa**: một vòng chỉ mở tối đa **3 tab cùng lúc**, tab xong thì nhường chỗ ngay cho
  nhiệm vụ kế trong hàng đợi. Vẫn giữ gần trọn cái lợi của song song (vòng dài bằng đợt chậm
  nhất, không phải tổng cộng dồn) mà mỗi trang đủ CPU để dựng. Con số 3 rút từ chính bằng
  chứng: tài khoản VIP sống khoẻ với ~4 trang khác nhau một lúc. Người vận hành máy khoẻ hơn
  nới bằng `WORKER_QUEST_TABS` (kẹp 1–8). Lưu ý nhân với `WORKER_MAX_JOBS`: 5 đàn × 3 tab là
  trần 15 tab, nên máy yếu thì hạ một trong hai.
- **Thông điệp lỗi nói đúng chuyện**: `Trang chưa dựng xong sau 25s — không thấy #ld-app`
  thay cho `Selector không bao giờ xuất hiện`. Câu cũ đọc như thể trang thiếu hẳn phần đó,
  và nó khiến một tab đói CPU trông y hệt một tính năng chưa mở — hai chuyện cần cách chữa
  khác nhau.
- Kiểm chứng: 6 assert mới cho bộ điều phối (không bao giờ vượt trần, không sót nhiệm vụ,
  giữ đúng thứ tự kết quả dù chạy xen kẽ, trần lớn hơn số việc, trần 1 = tuần tự, danh sách
  rỗng không treo) — smoke **123/123**; TypeScript + production build xanh.

## 0.24.0 — Luyện Đan Đường: tab VIP và tab Thường thôi nhìn chung một bộ tuỳ chọn

- **Lỗi được sửa**: từ 0.23.0, Luyện Đan Đường chạy được cho cả hai hạng nhưng chỉ mang MỘT
  bộ tuỳ chọn đứng ngoài hai tab — khắc ngọc giản từ tab VIP là lặng lẽ đè loại đan, mức
  phân giải và cả công tắc bật/tắt của tab Thường, và ngược lại. Ai muốn đội VIP luyện
  Cực Phẩm còn đội thường chỉ luyện Hạ Phẩm là không có cách nào.
- **Tách đôi cấu hình**: config mọc thêm `quests.luyenDanThuong` cạnh `quests.luyenDan`;
  mỗi tab một fieldset với bộ field mang tên riêng (`luyenDan*` / `luyenDanThuong*`), và lớp
  dịch áp mỗi bản cho đúng twin của hồ sơ theo `requiresVip`. Mê Cung vẫn là một bộ chung —
  không ai kêu về nó, và hai bản Mê Cung chỉ khác nhau ở hạng là chuyện hồ sơ đã lo.
- **Di trú không ai mất gì**: document cũ chưa có `luyenDanThuong` được GIEO bản thường từ
  bản chung ngay lúc đọc — nếu để Zod tự điền default thì mọi tài khoản thường đang luyện
  đan bỗng tắt ngầm sau deploy, không một dòng lỗi. Luật gieo đứng ở CẢ HAI cửa JSONB thô
  gặp Zod: đường đọc của trang cấu hình, và op claim của /api/worker — nơi snapshot vừa
  được claimNextJob/completeWorkerCycle chép thô từ user_configs bằng SQL, không hề đi qua
  đường đọc kia (soát chéo lúc review mới lộ ra cửa thứ hai). Snapshot đóng băng trước
  deploy còn thêm lưới dưới cùng trong lớp dịch: thiếu hẳn bản thường thì rơi về bộ chung
  cũ, đúng hành vi lúc snapshot được khắc.
- Smoke test thêm 8 ca ghim ranh giới mới: hai twin nhận đúng bộ của hạng mình, công tắc
  không kéo nhau, snapshot cũ rơi về bộ chung, luật gieo khi đọc document cũ/mới, và chốt
  giữ op claim phải gieo trước khi parse.
- Linh sứ máy nhà chưa cài đè bundle mới vẫn chạy an toàn: engine cũ chỉ biết bộ chung nên
  áp nó cho cả hai twin — đúng hành vi trước tách, tự hết khi cài đè.

## 0.23.1 — Linh Đài rộng ra 1600px, và thanh trên cùng thôi lệch tâm

- **Khung Linh Đài lên 1600px** (từ 1152px). Đo trên màn 1920: mỗi cột từ 566/514px lên
  796/724px, ô nhiệm vụ trong lưới hai cột từ ~245px lên 340px — mọi dòng gợi ý trước đây
  gãy ba dòng giờ nằm gọn một-hai dòng. Vẫn có TRẦN chứ không thả tự do: một biểu mẫu kéo
  ngang hết màn 2560px thì mắt phải quét quá xa, và dòng chữ dài ra là khó đọc hơn.
- **Thanh trên cùng canh đúng mép thẻ.** Trước đây header rộng 1024px đứng trên nội dung
  1152px, tức ấn môn phái thụt vào 64px so với hàng thẻ bên dưới — nay trang tự khai bề
  rộng khung của mình cho header qua một prop, và cả hai dùng chung một hằng số nên không
  thể lệch nhau nữa. Đo mép trái ấn so với mép trái thẻ: **0px** ở 1280/1600/1920.
- **Thoáng hơn ở bên trong, không chỉ rộng hơn ở bên ngoài**: khoảng cách hai cột 24 → 32px,
  ruột thẻ 24 → 32px, và khung nhật ký cao 320 → 416px (bên phải vốn kết thúc sớm hơn cột
  trái rất nhiều, nên chỗ trống ấy trả về cho phần đáng đọc nhất).
- Mọi thay đổi chỉ chạm màn **rộng hơn 1152px**; điện thoại và tablet không đổi một pixel.
  Prop mới của header mặc định giữ nguyên `max-w-5xl` nên năm trang còn lại không xê dịch —
  đã đo lại `/`, `/profile`, `/chat` (header vẫn đúng 1024px) và kiểm không tràn ngang ở
  390/768/1024/1280/1920.

## 0.23.0 — tab Thường đủ bộ: Tế Lễ và Thí Luyện có flow thật, Mê Cung và Luyện Đan mở cho cả hai hạng

- **Đồng bộ profile schema 45 từ PC** (desktop 1.41.0), sinh bằng lệnh export như mọi lần —
  không chép selector tay.
- **Tế Lễ Tông Môn (thường)** — recording 05/08 trên tài khoản thường thật: hàng hub dẫn tới
  trang thành viên tông môn (`/danh-sach-thanh-vien-tong-mon?nv_embed=1`), bấm `#te-le-button`,
  xác nhận hộp SweetAlert2 「dùng 10 Tinh Thạch tế lễ cho Tông Môn?」bằng `.swal2-confirm`
  (không bao giờ đụng Hủy), rồi CHỜ nút đổi thành 「Đã Tế Lễ」+ disabled — tế lễ TỐN Tinh
  Thạch nên lễ bị từ chối phải kêu to, không nhận vơ là xong. So nguyên cụm 「đã tế lễ」theo
  bài học bỏ-dấu của Điểm Danh.
- **Thí Luyện Tông Môn (thường)** — recording 05/08: dạng Phúc Lợi Đường trên trang đơn giản
  hơn (`/thi-luyen-tong-mon-hh3d/?nv_embed=1`) — cùng cổng `#countdown-timer` (00:00 = sẵn
  sàng, mở xong nhảy 29:59), một điều khiển duy nhất là chính cái rương `#chestImage`
  (ForceClick vì nó glow). Mỗi lượt ghé lấy một trong 3 lượt/ngày rồi báo cooldown ~30 phút;
  「hết ngày」đọc từ hàng hub mất link — tín hiệu đã chứng minh ở Phúc Lợi Đường.
- **Mê Cung và Luyện Đan Đường có twin thường** (`me-cung-thuong`, `luyen-dan-duong-thuong`)
  — cùng cách Hoang Vực/Vấn Đáp đã làm: hub thường dẫn thẳng vào hai trang này (「Vào Ngay」,
  recording 05/08), script đã kiểm chứng phục vụ cả hai hạng nguyên văn. Lớp dịch
  `profileForConfig` áp công tắc VÀ MỌI option cho cả cặp twin — trước đây nó chỉ áp cho bản
  tìm thấy đầu tiên, nghĩa là tài khoản thường sẽ chạy Mê Cung với option mặc định trong khi
  người dùng đã gõ ngưỡng trục xuất 250.000.
- **Hai fieldset Mê Cung / Luyện Đan rời khỏi tab VIP**, đứng thành khối chung hiện ở mọi
  tab: chúng giờ thuộc cả hai hạng, và nhét vào cả hai tab là nhân đôi input cùng name —
  đúng cái bẫy FormData mà comment đầu ConfigForm đã cấm từ 0.20.0. Tab Thường lên 7 mục
  một-công-tắc (thêm Thí Luyện + Tế Lễ).
- Kiểm chứng: smoke Chromium thật chạy nguyên hai flow mới trên DOM dựng theo recording
  (kể cả lần ghé thứ hai của Tế Lễ phải dừng ở 「đã tế lễ hôm nay」và tuyệt đối không đụng
  nút Hủy), bốn cặp twin được so bằng chứng cứ cấu trúc từng cặp; TypeScript + production
  build là cổng phát hành như thường lệ.

## 0.22.1 — nhật ký thôi bị bóp thành sợi chỉ dọc

- **Mỗi dòng nhật ký lại đọc được.** `.log-line` là lưới đúng HAI ô — giờ, rồi nội dung —
  nhưng bản 0.22.0 thêm nhãn tài khoản thành phần tử con thứ BA. Con thứ ba rơi xuống hàng
  dưới, vào ô giờ rộng 4.4rem, nên lời kể bị ép thành một cột chữ dựng đứng một-hai từ mỗi
  dòng (ảnh người dùng gửi 05/08). Nhãn giờ nằm CÙNG một ô với lời kể, lưới trở lại đúng
  hai con như thiết kế ban đầu.
- **Chuỗi dài không chỗ ngắt không đẩy được khung log tràn ngang nữa**: cột nội dung đổi
  sang `minmax(0, 1fr)` kèm `overflow-wrap: anywhere` — một id linh sứ hay URL dài vốn đặt
  sàn min-content cho cột, và sàn ấy thắng cả bề rộng khung.
  Đo bằng Chromium thật trước/sau: ô nội dung từ 70px (khác hàng với giờ) lên 192px (cùng
  hàng), năm kịch bản — có nhãn, không nhãn, nhãn 60 ký tự, URL không dấu cách — đều không
  tràn.
- **Bỏ những câu đối chiếu với bản PC trong giao diện và hướng dẫn.** Người dùng web không
  cần biết bản desktop làm gì để hiểu một ô tick: gợi ý Vấn Đáp nói thẳng là tra danh sách
  đáp án cộng đồng; công tắc chạy song song nói "bỏ tick để làm lần lượt từng nhiệm vụ";
  lời báo lỗi cookie chỉ đúng tên tiện ích Cookie-Editor thay vì "ứng dụng desktop". Lý do
  kỹ thuật trong comment và tài liệu dành cho người phát triển vẫn giữ nguyên — đó là nơi
  đối chiếu hai bản còn có ích.

## 0.22.0 — nhiều tài khoản chạy cùng lúc; nhiệm vụ trong một vòng chạy song song

Bản này đưa web lên ngang bản desktop ở đúng chỗ desktop mạnh nhất: **nhiều tài khoản**. Và
đi xa hơn desktop một bước: các nhiệm vụ trong một vòng có thể chạy **song song**, mỗi nhiệm
vụ một tab.

- **Tài khoản game tách khỏi cấu hình, thành bảng riêng `game_accounts` (migration 0009).**
  Cho tới nay cookie sống lẫn trong `user_configs`, nghĩa là mỗi người đúng một tài khoản.
  Bảng riêng vì ba lẽ: một người nuôi nhiều tài khoản và bật/tắt từng cái độc lập; hạng
  VIP/thường là thuộc tính CỦA COOKIE chứ không phải của người (hai tài khoản cùng chủ có
  thể khác hạng); và job phải biết nó chạy cho tài khoản nào để linh sứ chọn đúng hồ sơ
  Chromium lẫn server vá đúng verdict hạng. Migration tự chuyển cookie đang có thành
  「Tài khoản 1」— phong bì mã hoá đi nguyên vẹn, verdict hạng đã chứng minh đi theo, job
  đang sống được nối vào tài khoản mới, và cookie rời hẳn `user_configs` (một bí mật không
  được phép có hai nhà).
- **Ngọc Giản Cấu Hình có mục quản lý tài khoản:** thêm tài khoản mới (tên gợi nhớ + cookie),
  thay cookie từng tài khoản (verdict hạng bị xoá để linh sứ dò lại), đổi tên, bật/tắt, xoá.
  Tắt một tài khoản đang chạy là đàn của RIÊNG nó được thu — các tài khoản khác không bị vạ
  lây; xoá bị từ chối khi đàn còn sống, để không bỏ một linh sứ bơ vơ với job đã biến mất.
  Hai tài khoản cùng chủ mang cùng một cookie bị chặn ngay lúc lưu: cùng cookie là cùng một
  hồ sơ Chromium (fingerprint băm theo cookie) — hai job đồng thời sẽ giành nhau một profile,
  và cùng một nhân vật bị chạy nhiệm vụ hai lần.
- **Khai Đàn lập một đàn cho MỖI tài khoản đang bật; Thu Đàn thu cả đội.** Mỗi tài khoản một
  job sống dai với cooldown riêng — tài khoản A đang ngủ chờ Phúc Lợi không bắt tài khoản B
  chờ theo. Snapshot của từng job = cấu hình nhiệm vụ chung GHÉP cookie/hạng của đúng tài
  khoản nó phục vụ, ghép lại ở mỗi lần claim để sửa-giữa-chừng vẫn có hiệu lực ở vòng kế.
  Bấm Khai Đàn khi một phần đội đang chạy chỉ bổ sung những tài khoản còn đứng ngoài.
- **Linh sứ chạy nhiều đàn cùng lúc.** Một tiến trình worker giờ cầm tối đa
  `WORKER_MAX_JOBS` job đồng thời (mặc định 2, kẹp 1–8 — mỗi job là một Chromium riêng nên
  trần này là trần RAM). Ghế còn trống thì hỏi việc tiếp ngay, không ngủ giữa hai lần claim.
  Nhịp tim gặp 404/403 (job bị xoá dưới chân, ví dụ tài khoản vừa bị xoá) được hiểu là lệnh
  dừng ở điểm an toàn kế — không ôm browser chạy nốt một vòng không ai nhận.
  **Linh sứ đã cài cần cài đè một lần** để nhận khả năng này; linh sứ cũ vẫn chạy đúng nhưng
  tuần tự từng tài khoản một.
- **Các nhiệm vụ trong một vòng chạy song song, mỗi nhiệm vụ một tab riêng** trong cùng phiên
  đăng nhập — vòng dài bằng nhiệm vụ chậm nhất thay vì tổng cộng dồn, đáng giá nhất khi Mê
  Cung (~35 phút) đứng chung hàng với các nhiệm vụ một phút. Tường thuật vẫn đọc được: log
  của mỗi tab mang tên nhiệm vụ, phần kết quả kể theo đúng thứ tự cũ. Có công tắc「Chạy song
  song các nhiệm vụ」trong Ngọc Giản (mặc định bật) để lui về tuần tự như bản PC nếu site
  trở chứng với nhiều tab; lượt chạy có ngân sách lát (`budgetMs`) luôn đi tuần tự vì "hết
  giờ thì dừng giữa danh sách" chỉ có nghĩa khi danh sách đi từng bước.
- **Lư Khai Đàn hiện trạng thái TỪNG tài khoản** — mỗi tài khoản một dòng chấm màu + trạng
  thái + linh sứ phụ trách. Nhật ký gộp chung, từng dòng mang nhãn「tài khoản」khi đội có
  hơn một người. Hai tab Nhiệm vụ VIP/Thường **không khoá nữa** (đội hình có thể lẫn cả hai
  hạng); mỗi tài khoản vẫn chỉ chạy đúng bộ thuộc hạng của nó, và phần chú thích cho biết
  đội hình hiện tại mấy VIP, mấy thường, mấy chưa dò.
- **Nhật ký chỉ tải phần ĐUÔI và tự đứng ở dòng mới nhất.** Lượt tải đầu lấy 200 dòng mới
  nhất (trước đây là 200 dòng CỔ nhất của một job đã chạy cả tuần — mở trang là đọc chuyện
  tuần trước); khung log mở ra là đứng sẵn ở đáy và bám theo dòng mới, chỉ ngừng bám khi
  người đọc chủ động kéo lên xem lại. Câu mô tả「Khai Đàn một lần, linh sứ tự canh
  cooldown…」rút khỏi mặt Lư — hành vi ấy giờ tự kể qua dòng trạng thái từng tài khoản.
- **Một đợt review đối kháng (5 chiều × phản biện độc lập) chốt thêm một lớp thép** trước
  khi phát hành:
  - Index duy nhất một-phần `jobs_one_active_per_account` — MỖI tài khoản tối đa MỘT đàn
    sống, luật nằm ở database chứ không chỉ ở startJob (vốn là check-then-insert qua nhiều
    round-trip: hai lượt Khai Đàn đồng thời từ hai tab cùng thấy tài khoản rảnh rồi cùng
    insert — hai Chromium sẽ giành một hồ sơ và một nhân vật bị chạy nhiệm vụ đôi). INSERT
    dùng `ON CONFLICT DO NOTHING`, kẻ đến sau lặng lẽ thua.
  - Snapshot drizzle 0009 được SINH bằng chính drizzle-kit rồi mới ghép phần backfill viết
    tay — thiếu snapshot thì lần `db:generate` kế tiếp diff với snapshot 0008 và sinh lại
    nguyên bộ DDL trùng, nổ `relation already exists` giữa chuỗi migration.
  - Nhịp tim linh sứ coi MỌI trạng thái không phải `running` là lệnh dừng — job bị reaper
    kết liễu (`failed`) không còn được ôm chạy nốt cả vòng không ai nhận.
  - Level `"warn"` của engine được cả linh sứ lẫn API dịch về `"warning"` — trước đó mọi
    dòng cảnh báo bị 400 và nuốt lặng lẽ, kể cả với linh sứ đã cài (sửa phía API nên bản cũ
    không phải cài lại vẫn hết mất log).
  - Vòng kết thúc của tài khoản đã tắt chuyển thẳng `stopped` thay vì re-queue thành zombie
    "chờ linh sứ" vĩnh viễn; claim cũng bỏ qua đàn của tài khoản đã tắt (đóng khe đua của
    toggle); reaper chỉ kết liễu job còn `running/stopping`, không giết nhầm job vừa
    re-queue khoẻ mạnh.
  - Nhật ký đọc lùi 50 id dưới con trỏ để vớt dòng commit muộn (hai job ghi đồng thời có
    thể commit ngược thứ tự id); stream chỉ phát frame khi có dòng id thật sự mới nên nhịp
    tim không thành frame thừa. Dọn nhật ký xoá màn hình TRƯỚC khi chờ server để không quét
    oan dòng vừa đến.
  - AccountManager đứng NGOÀI `<form>` cấu hình — React 19 reset uncontrolled input sau mỗi
    form action, một cú Khắc Ngọc Giản không được phép xoá trắng chuỗi cookie đang gõ dở.
    Form cấu hình thêm `noValidate`: input số invalid nằm trong tab đang ẩn từng chặn submit
    mà không hiện nổi một lời; giờ Zod ở server là trọng tài và nó biết nói lỗi ra lời.
  - Cảnh báo "không đọc được danh sách đáp án" của Vấn Đáp tính theo TỪNG job (WeakSet theo
    log) thay vì một lần cho cả tiến trình — job đầu không còn "tiêu" mất cảnh báo của các
    tài khoản sau; nguồn hỏng được nghỉ 60 giây thay vì mỗi câu hỏi lại ôm một timeout 20s.
- **Triển khai:** chạy `npm run db:migrate` TRƯỚC khi deploy bản mới (code mới đọc bảng
  `game_accounts`; migrate xong thì code cũ vẫn chạy được thêm một nhịp vì chỉ mất cookie
  trong config khi ĐỌC — nhưng đừng nấn ná, và đừng rollback code sau khi đã migrate vì bản
  cũ sẽ không thấy cookie nữa).
- Kiểm chứng: TypeScript sạch, production build thành công, smoke Chromium thật **103/103**
  (smoke lái engine trực tiếp nên không đổi số); hai script verify realtime đã cập nhật theo
  payload `jobs[]`/`accounts[]`. Nhịp chạy song song và đa tài khoản chưa có lượt chạy thật
  trên site — cần một lượt Khai Đàn thật để xác nhận, như mọi flow mới trước nay.

---

## 0.21.0 — hạng tài khoản khóa đúng tab; tài khoản thường có thêm Hoang Vực và Vấn Đáp

- **Đồng bộ profile schema 44 từ PC.** Hoang Vực và Vấn Đáp ở tab Thường là bản sao nguyên
  flow trang riêng đã kiểm chứng của VIP, chỉ đổi id `*-thuong` và `requiresVip=false`.
  Engine tiếp tục coi hai tab là hai kế hoạch loại trừ nhau, nên không có chuyện VIP chạy
  thêm bản thường rồi nhận thưởng trùng.
- **Tab đổi theo cookie thật, ngay trong lúc trang đang mở.** Worker dò hạng trên hub, gửi
  verdict có xác thực về API; server vá đúng trường `accountTier` trong JSONB và phát tín hiệu
  SSE. Linh Đài tự chuyển sang tab hợp lệ rồi disable tab đối nghịch, không cần F5.
- **Đổi hoặc xoá cookie xoá luôn verdict cũ.** Hai tab mở lại cho tới khi worker chứng minh
  hạng của cookie mới; việc vá verdict là một câu UPDATE JSONB nguyên tử nên không thể ghi đè
  lựa chọn quest người dùng vừa lưu cùng thời điểm.
- **Probe chập chờn không làm account thường chạy nhầm VIP.** Worker giữ verdict đã chứng minh
  từ vòng trước; cookie chưa từng được dò mới dùng mặc định tương thích VIP.
- Kiểm chứng: TypeScript sạch, production build thành công, smoke Chromium thật **103/103**.

## 0.20.1 — cookie account mới thắng dứt khoát profile VIP cũ

- **Không còn một `browser-profile` dùng chung cho cả tông môn.** Mỗi cặp user + chuỗi cookie
  đã lưu có một hồ sơ Chromium riêng, với tên thư mục chỉ chứa SHA-256 rút gọn. Job của người
  trước không thể để lại phiên đăng nhập cho người sau; cùng một người đổi VIP → thường sẽ đi
  vào profile sạch và tiêm đúng cookie mới.
- **Phiên được site tự refresh vẫn sống bền.** Các vòng dùng cùng chuỗi cookie tiếp tục tái dùng
  đúng profile; chỉ khi người dùng chủ động lưu chuỗi khác fingerprint mới đổi. Không quay lại
  lỗi lấy chuỗi dán-tay cũ đè lên phiên đã được site gia hạn sau mỗi vòng.
- **Snapshot được làm mới ngay lúc worker claim job đang chờ.** Cookie hoặc nhiệm vụ sửa trong
  thời gian `queued` có hiệu lực ở vòng kế, không phải chạy thừa thêm một vòng bằng ngọc giản cũ.
- **Phong bì mã hoá không còn bị nhét qua trần 8.000 ký tự của plaintext.** Base64 làm cookie
  JSON dài nở thêm; schema at-rest riêng nhận tối đa 40.000 ký tự rồi worker mới giải mã và
  soát lại bằng schema plaintext. Không còn cảnh nút báo lưu thành công nhưng lần đọc sau cả
  config rơi về mặc định rỗng.

---

## 0.20.0 — tài khoản thường có ba flow thật; mỗi đạo hữu có email và tự sửa hồ sơ

- **Đồng bộ nguyên profile schema 43 từ PC**, không chép selector bằng tay. Ba flow ghi trên
  tài khoản thường ngày 02/08 chạy thẳng ở trang riêng vì hub của hạng này không có các nút
  nhanh cũ: Điểm Danh dùng `/diem-danh` + `#checkInButton`; Phúc Lợi Đường mở bốn rương theo
  thứ tự và đọc `#countdown-timer` 30 phút; Vòng Quay Phúc Vận dùng `#spinButton`,
  `#userTurns` và tự đóng màn chúc mừng đang che nút.
- **Một công tắc web bật cả cặp flow VIP/Thường, nhưng engine chỉ chọn đúng một hạng.** Vì ba
  nhiệm vụ trùng mục tiêu nhưng khác toàn bộ selector, VIP không chạy lặp flow thường và tài
  khoản thường không chạm nút VIP. Lượt quay thứ tư chỉ xuất hiện sau khi đủ điều kiện ngày;
  job sống dai sẽ quay lại ở vòng sau thay vì giữ browser ngồi chờ.
- **Tab “Nhiệm vụ Thường” không còn là placeholder rỗng.** Nó hiện đúng ba checkbox Điểm
  Danh, Phúc Lợi Đường và Vòng Quay Phúc Vận. Ba công tắc dùng chung state với bản VIP nên
  đổi ở tab nào cũng đồng bộ; FormData chỉ có một input chuẩn cho mỗi key, không thể lưu hai
  giá trị trái nhau vì hai bản checkbox.
- **Email được thêm bằng migration 0008, unique và chuẩn hoá chữ thường.** Cột nullable chỉ để
  giữ nguyên 9 tài khoản cũ; đăng ký mới và tài khoản do admin tạo đều bắt buộc email hợp lệ.
  Không backfill email giả, không làm mất hay khoá tài khoản hiện hữu.
- **Trang Hồ Sơ cho từng người dùng** sửa đúng danh xưng + email của chính mình; đạo hiệu,
  quyền và trạng thái không nằm trong payload cập nhật. Admin cũng thấy/tìm/sửa email trong
  Tông Môn. Email trùng bị database lẫn service chặn, kể cả hai request đến cùng lúc.
- Kiểm chứng: smoke Chromium thật **96/96**, trong đó sáu assert mới chạy nguyên ba flow trên
  DOM giống recording; integration Neon xác nhận legacy `NULL`, đăng ký mới, chuẩn hoá,
  unique, cập nhật nguyên tử và quyền tự sửa. TypeScript + production build đều là cổng phát
  hành.

## 0.19.0 — Linh Đài nhận trạng thái trực tiếp, không chờ hai nhịp poll cộng dồn

- **Gỡ đúng hai nút thắt đã đo được:** nhật ký/job trước đây chỉ được hỏi lại mỗi 3 giây khi
  chạy (12 giây khi nghỉ), sổ linh sứ mỗi 12 giây, còn worker đang bận chỉ heartbeat mỗi 20
  giây. Những cửa sổ ấy cộng dồn làm một trạng thái thật đã có trên server nhưng màn hình vẫn
  đứng yên đủ lâu để người dùng tưởng linh sứ treo.
- **Postgres giờ phát chuông trong chính transaction ghi dữ liệu.** Migration 0007 đặt trigger
  trên lifecycle job, event mới và sổ worker; payload `NOTIFY` chỉ có user/topic, không mang
  cookie hay nội dung log. `/api/dashboard/stream` giữ một `LISTEN` session unpooled rồi đẩy
  snapshot qua SSE tới đúng user ngay khi chuông reo — không quay vòng query database.
- **Một EventSource nuôi cả Lư Khai Đàn lẫn mục Linh Sứ.** Cursor là id `job_events`; reconnect
  dùng `Last-Event-ID`, backlog trên 200 dòng tự chảy tiếp, event trùng được gộp, dọn log reset
  đồng thời ở các tab. Dấu **● Trực tiếp** cho biết kênh đang sống; khi kênh rớt, browser tự
  reconnect và feed một-lần 2 giây làm lưới an toàn, khi ổn chỉ soát lại mỗi 30 giây.
- **Không đánh đổi hiệu năng React để lấy tốc độ.** Job/log và presence có context riêng, nên
  một dòng nhật ký mới không bắt cả panel cài đặt linh sứ render lại. Heartbeat dời `lastSeen`
  nhưng nếu trạng thái vẫn “đang trực” thì server chỉ hẹn lại giờ hết hạn, không gửi frame rác.
- **Thu Đàn nhanh hơn trên gói worker mới:** heartbeat mặc định từ 20 giây xuống 5 giây, có thể
  chỉnh bằng `WORKER_HEARTBEAT_MS`. Realtime trên trang có hiệu lực ngay sau deploy; linh sứ
  cũ vẫn chạy, nhưng nên cài đè v0.19.0 một lần để nhận nhịp dừng 5 giây.
- Kiểm chứng trên Neon thật: trigger `job/event/presence/reset` tới listener trong **56–155ms**;
  qua trọn session cookie → Next route → SSE client, event tới sau **168ms** và reset sau
  **223ms**. Có thêm verifier riêng cho cả tầng DB (`verify:realtime`) và HTTP stream
  (`verify:realtime:sse`).

## 0.18.0 — Vấn Đáp web dùng cùng danh sách tham khảo với PC, không hỏi Gemini

- **Flow trước đây chỉ có tay mà không có đầu.** Hồ sơ web đã biết mở
  `/van-dap-tong-mon`, đọc `#question`, bấm đáp án bằng input thật và nhìn lại marker
  `.correct`; nhưng `runCycle` tạo engine mà không tiêm `quiz`. Gặp câu đầu, nó luôn tự thú
  “bản web chưa có kho đáp án” rồi dừng — dòng UI “Tự trả lời câu đã biết” vì thế chưa đúng.
- **Port nguyên tầng `QuizReferenceDirectory` của PC.** Worker tải toàn bộ bảng tại
  `https://hh3d.phucthienlang.vn/user_search.php`, cache trong tiến trình 12 giờ và dùng chung
  cho mọi vòng/account trên máy. Không gọi endpoint tìm kiếm theo từng câu; câu hỏi đang hiện
  không bị gửi đi đâu.
- **Khớp theo text, không theo số/vị trí.** Parser bỏ `3.` / `3)`, giải HTML entity, bỏ thẻ,
  gộp khoảng trắng và fold dấu tiếng Việt. Đáp án chỉ được dùng khi khớp nguyên vẹn đúng một
  trong các lựa chọn đang hiện; thứ tự bị site xáo không có ý nghĩa. Ghi chú cuối `(…)` được
  thử bỏ như PC. Nếu nguồn tự mâu thuẫn hoặc đáp án không nằm trên màn hình thì không bấm.
- **Không có Gemini đúng theo phạm vi yêu cầu.** Câu không có trong danh sách kết thúc quest
  an toàn để giữ các lượt còn lại cho người dùng. Refresh nguồn hỏng vẫn dùng bản cache cũ;
  lần đầu tải hỏng chỉ cảnh báo, không làm sập cả vòng automation.
- URL có thể đổi bằng `QUIZ_DIRECTORY_URL` trên máy nuôi worker; để trống dùng cùng mặc định
  với PC. Linh sứ đã cài trước v0.18.0 cần **cài lại một lần để cập nhật engine** — cài đè giữ
  nguyên linh phù và `WORKER_ID`.
- Kiểm chứng: smoke **90/90**, gồm Chromium thật xác nhận đáp án đi qua click Playwright và
  câu lạ không bấm đại; nguồn cộng đồng thật trả HTTP 200, parser đọc đúng **255 câu duy nhất**
  và resolver khớp lại được đáp án theo text.

## 0.17.0 — Khai Đàn là một lời hứa sống dai, không phải vé đi đúng một vòng

- **Hết một vòng không còn biến job thành `done`.** Đó là lý do ảnh thực địa hiện “Đi hết
  một vòng — 10 nhiệm vụ thuận lợi”, rồi nút lập tức trở lại **Khai Đàn**: worker gọi
  `complete(done)`, server hiểu chữ “complete” là kết thúc cả ý định. Giờ `done`/`failed`
  chỉ kết thúc một vòng và cùng job được đưa về `queued`; chỉ **Thu Đàn** mới thành terminal.
- **Thức dậy theo cooldown, không quay nóng.** Engine gửi cooldown dương sớm nhất của cả
  vòng, dùng cùng luật với `CooldownPlanner` bên PC: không đồng hồ thì 5 phút; vòng chỉ có
  lỗi thì 30 phút; sàn 30 giây, trần 24 giờ, jitter 0–25 giây. Cột `next_run_at` giữ lịch
  trong Postgres nên Vercel không phải nuôi timer và worker có thể đóng browser lúc nghỉ.
- **Tương thích ngay với linh sứ đã cài.** Worker cũ không biết trường `nextDelaySeconds`
  vẫn gửi `complete` như trước; server tự dùng fallback rồi tái xếp job. Không bắt người dùng
  gỡ/cài lại chỉ để nhận hành vi nhiều vòng. Gói cài mới gửi đồng hồ thật để chạy sát hơn.
- **Thu Đàn không lọt qua khe giữa hai vòng.** Stop và complete đều chuyển trạng thái bằng
  UPDATE nguyên tử: bấm đúng lúc `running → queued` vẫn kết thúc job, không có vòng kế âm thầm
  sống lại. Cấu hình được làm mới ở ranh giới an toàn nên chỉnh giữa vòng chỉ áp dụng từ vòng
  sau, không đổi một cú click đang bay.
- **Hai linh sứ không thể cùng ôm một vòng.** Lệnh claim dùng `FOR UPDATE SKIP LOCKED`; nếu hai
  worker hỏi việc đúng một nhịp thì chỉ một người nhận job, người kia bỏ qua thay vì chạy trùng.
- **Hàng chờ không còn bị reaper giết sau hai phút.** Với job sống dai, `queued` có thể là đang
  ngủ tới `next_run_at` hoặc chờ linh sứ bận làm Mê Cung cho người khác; cả hai đều là trạng
  thái lành. Không có linh sứ thì cảnh báo đã được ghi ngay lúc Khai Đàn, còn ý định tiếp tục
  chờ cho tới khi có người nhận hoặc chủ nhân Thu Đàn.
- **Job sống quanh năm nhưng log không phình quanh năm:** mỗi ranh giới vòng giữ 1.000 dòng
  gần nhất. Dashboard hiện rõ “Đang nghỉ — vòng N lúc …”, nói thẳng “chỉ Thu Đàn mới dừng”,
  và khử trùng theo event id nếu poll định kỳ chạm đúng poll sau một thao tác.
- Kiểm chứng: smoke **75/75**; integration trên database thật xác nhận lịch cooldown, refresh
  cấu hình, khóa đua hai worker, fallback `done→queued (~5m)` / `failed→queued (~30m)` và mọi
  đường Thu Đàn đều đúng; build Next.js production xanh.

## 0.16.0 — cài lại một lần là mọc thêm một cái tên, và sổ điểm danh thì không biết quên

- **Mục Linh Sứ hiện hai linh sứ trên một cái máy.** `desktop-lq9der0-wujq` chấm xanh,
  `desktop-lq9der0-439u` chấm xám "28 phút trước" — cùng một máy, hai lần cài. Không có gì
  hỏng: cổng Khai Đàn dùng `anyWorkerOnlineFor` với cửa sổ 30 giây nên cái xác không giả
  được "có người trực", và việc giành job phân xử bằng scope của token chứ không bằng dòng
  trong sổ. Nhưng màn hình ấy **nói dối bằng hình ảnh**, đúng điều mà chính comment trong
  `install.ps1` đã sợ: *"người dùng nhìn vào tưởng mình đang nuôi cả một đàn."*
- **Hậu tố của WORKER_ID thôi ngẫu nhiên, chuyển thành hàm của cái máy.** Băm SHA-256 từ
  `MachineGuid` + tên tài khoản Windows (Linux/macOS: `machine-id`/`IOPlatformUUID` + uid),
  lấy 6 ký tự hex. Cài lại bao nhiêu lần cũng ra đúng một tên.

  Bản cũ *có* logic giữ ID — đọc lại từ `.env` — nhưng nó chỉ cứu được đường **cài đè**.
  `uninstall` xoá cả thư mục nên `.env` chết theo, và **gỡ-rồi-cài-lại lại đúng là đường ta
  bảo người dùng đi khi cần dọn dẹp**. Nghĩa là quy trình dọn dẹp chính thức là đường duy
  nhất chắc chắn đẻ ra bia mộ. Không phải ai viết sai; khe hở nằm ở chỗ hai tệp gặp nhau.

  Tên tài khoản có mặt trong hạt giống vì thư mục cài là `%LOCALAPPDATA%`/`$HOME` của từng
  người: hai tài khoản trên cùng một máy là hai linh sứ thật, phải mang hai tên khác nhau.
  Đọc registry hỏng thì lùi về ngẫu nhiên — một cái xác trong sổ vẫn hơn một bản cài không
  chạy. Đã đo trên máy thật: ba lần chạy liên tiếp ra cùng `desktop-lq9der0-775e84`.
- **Nút ✕ gỡ tên khỏi danh sách**, cho những cái xác đã sinh ra rồi — và cho máy đã bán, bản
  cài đã bỏ. Chỉ hiện ở dòng đã vắng: linh sứ đang trực mà gỡ thì nó ghi tên lại sau năm
  giây, và một cái nút không giữ được lời hứa còn tệ hơn không có nút. `forgetWorker` chốt
  hai lớp — `userId` trong mệnh đề where, và `lastSeen` phải cũ hơn cửa sổ 30 giây.
- Tên đã bấm gỡ giữ ở một state riêng chứ không cắt thẳng khỏi `presence`: nhịp poll 12 giây
  ghi đè cả object bằng dữ liệu máy chủ, nên một phép cắt tại chỗ sẽ bị nhịp poll kế tiếp
  dựng dòng ấy dậy trong lúc lệnh xoá còn đang bay.

## 0.15.2 — hồ sơ trình duyệt ôm một cái xác cookie, và Luyện Đan chết ở #ld-app

- **Luyện Đan Đường hỏng với "Selector không bao giờ xuất hiện: #ld-app".** Trang lò thì
  không sao — vào thẳng bằng cookie đã lưu là `#ld-app` hiện tức thì. Thủ phạm nằm ở hai
  dòng nhật ký debug của linh sứ, đứng cạnh nhau và mâu thuẫn nhau:

  ```
  [debug] Hồ sơ đã có phiên đăng nhập — giữ nguyên, không tiêm cookie.
  [debug] Không xác nhận được trạng thái đăng nhập — vẫn đi tiếp.
  ```

  Hồ sơ Chromium bền giữ cookie phiên do site tự làm mới, nên lúc mở ta cố ý KHÔNG đè chuỗi
  người dùng dán lên trên — đè là tự tay đăng xuất một phiên đang lành. Nhưng phép kiểm ấy
  chỉ hỏi *"có cookie đăng nhập không"*, không hỏi *"nó còn sống không"*. Một cookie đã chết
  vẫn thoả mãn câu hỏi đó, nên linh sứ ôm cái xác đi tiếp và trang lò render ở dạng chưa
  đăng nhập. Lỗi nổi lên ở tên một selector vô tội, mười bước sau nguyên nhân thật.
- **Sửa: đừng tin, hãy thử.** `ensureReady` giờ hỏi thẳng trang; nếu hồ sơ không đăng nhập
  được thì xoá cookie cũ, tiêm lại chuỗi đã lưu, rồi thử lần nữa. Dùng hồ sơ khi nó còn
  chạy, quay về chuỗi người dùng dán khi nó chết — không cần đoán, vì trang vừa trả lời rồi.
  Đã dựng lại đúng cảnh hỏng (nhét một cookie chết vào hồ sơ bền) và xem nó tự chữa.
- **Chốt phủ sóng engine.** Hồ sơ được SINH RA từ bản desktop, nên một loại bước hay loại
  điều kiện mới có thể theo lệnh `export` trôi sang mà không ai đụng vào mã web — và cả hai
  chỗ đều nuốt cái lạ trong im lặng (`conditionProbe` rơi vào `default: return false`, tức
  một `when` không bao giờ nổ). Smoke giờ đối chiếu mọi loại hồ sơ dùng với thứ engine
  hiện thực. Hôm nay: 10 loại bước, 6 loại điều kiện, đủ cả.
- Đã soát 10 nhiệm vụ ngày: mỗi ô tick nối đúng một quest trong hồ sơ, không ô nào trơ.

## 0.15.1 — chữ chìm vào ảnh nền, và một lời hứa đúng nửa vời

- **Chữ trong mục Linh Sứ không đọc nổi.** Panel ấy tự pha nền `bg-ink-800/40` thay vì dùng
  `.card` như hai thẻ kia, nên ảnh nền trang xuyên thẳng qua. Đo được: tương phản **1.27:1**
  — tức gần như vô hình trên những mảng sáng. Sửa bằng cách cho nó dùng chung `.card`.
  Chỉnh màu chữ theo nền thì CSS không làm nổi (không có cách nào biết cái gì đang nằm
  dưới); cho thẻ một cái nền đủ đục mới là câu trả lời đúng.
- Rồi đo tiếp thì `.card` cũ (0.86) cũng chỉ đạt 4.23:1 — dưới chuẩn AA cho chữ nhỏ. Nâng
  lên 0.93/0.96 **và** làm `--color-mist` sáng thêm một nấc (`#8f89b3` → `#9b96be`). Kết
  quả **4.96:1**, tính theo trường hợp tệ nhất là nền trắng tinh nằm dưới. Chọn sửa cả màu
  chữ thay vì chỉ làm thẻ đục thêm, vì nó cứu cả những dòng nằm NGOÀI thẻ.
- **"Tắt trình duyệt vẫn chạy" là lời hứa đúng một nửa.** Thật, nhưng bỏ lửng ở đó thì
  người ta suy ra "tắt máy chắc cũng thế" — sai, nếu linh sứ đang nằm trên chính máy họ.
  Giờ nói đủ: tắt máy thì linh sứ tông môn không sao, linh sứ máy nhà dừng theo. Cùng một
  đính chính ở mục Linh Sứ và trong HUONG-DAN.md (cả câu mở đầu lẫn mục hỏi đáp).

## 0.15.0 — chữ trên Linh Đài nói tiếng người, và có hướng dẫn cho người mới

- **Viết lại toàn bộ chữ hướng dẫn trên Linh Đài.** Giữ nguyên tên riêng có hồn (Linh Đài,
  Khai Đàn, Ngọc Giản, Linh Sứ) — đó là bản sắc sản phẩm — nhưng phần GIẢI THÍCH thì nói
  thẳng. Bỏ những câu gạch-ngang nối dài kiểu "được niêm phong trước khi cất vào tàng khố
  và chỉ được mở đúng khoảnh khắc linh sứ nhận việc"; thay bằng "lưu xong sẽ được mã hoá và
  không bao giờ hiện lại trên màn hình". Dòng đầu trang giờ nói ngay ba bước phải làm, vì
  người mới mở trang cần biết việc của mình chứ không cần một câu chào hay ho.
- Ba thông báo lỗi lúc Khai Đàn cũng viết lại: mỗi câu nói rõ **phải bấm gì tiếp theo**,
  thay vì chỉ tuyên bố cái sai.
- **Cảnh báo linh sứ vừa bị khai tử.** Phát linh phù mới thì linh sứ đang chạy ngừng nhận
  việc, nhưng nó không chết hẳn — cứ quay vô ích và trên màn hình chỉ lặng lẽ thành "vắng".
  Hộp xác nhận cảnh báo TRƯỚC khi bấm là chưa đủ; giờ có thêm một dòng đỏ hiện NGAY LÚC
  người ta nhìn thấy hậu quả, kèm việc cần làm. Đúng chuyện đã xảy ra ngày 02/08.
- **Thêm [HUONG-DAN.md](HUONG-DAN.md)** — hướng dẫn cho người chơi, không phải cho người
  vận hành: lấy cookie thế nào (kèm cả đường Cookie-Editor), mỗi tuỳ chọn nghĩa là gì, khi
  nào mới phải quan tâm tới "linh sứ", bảng tra lỗi thường gặp, và mấy câu hỏi nhanh.

## 0.14.1 — bật chín nhiệm vụ vẫn bị dội "chưa bật nhiệm vụ nào"

- **Chốt khai đàn chỉ đếm hai nhiệm vụ trong số mười hai.** Nó ra đời khi hồ sơ chỉ có Mê
  Cung và Luyện Đan; mười nhiệm vụ ngày thêm vào ở v0.9.0 mà không ai nhớ tới nó. Hệ quả:
  một đạo hữu tick đủ chín nhiệm vụ ngày vẫn bị dội lại "Chưa bật nhiệm vụ nào — chọn ít
  nhất một nhiệm vụ để khai đàn", mâu thuẫn thẳng với những ô đang sáng trước mắt họ.
  Không có lỗi nào trong log, vì đứng từ phía máy thì mọi thứ diễn ra đúng như đã viết.
  Giờ chốt duyệt `Object.values(quests)` — nhiệm vụ thứ mười ba tự được tính.
- Phát hiện khi rà sổ đăng ký chứ không phải từ báo lỗi: bảy người thật đã vào, và người
  DUY NHẤT lưu cấu hình lại rơi đúng vào cái bẫy này. Một lỗi không ai kêu là một lỗi khiến
  người ta lặng lẽ bỏ đi.

## 0.14.0 — tải bộ cài rồi bấm đúp, cột trái thôi bị bóp, và linh sứ bận thôi bị coi là vắng

- **Linh sứ ĐANG BẬN bị báo "vắng mặt".** Sổ điểm danh chỉ ghi ở `claim`, mà một linh sứ
  đang chạy job thì thôi không claim nữa — nên nó tụt khỏi sổ sau 30 giây. Đo được lúc
  linh sứ thật đang giữa một phiên Mê Cung: sống, 4 tiến trình, đang đánh ải, mà dashboard
  báo vắng; và vì `startJob` đọc cùng cái sổ ấy, lượt kế tiếp sẽ nhận cảnh báo sai "chưa
  thấy linh sứ nào điểm danh". Giờ **nhịp tim 20 giây cũng là điểm danh** — bằng chứng sống
  chính xác hơn, và nó vốn đã có sẵn. `workerId` lấy từ chính dòng job chứ không bắt worker
  khai thêm, nên những linh sứ đã cài từ trước không phải cập nhật gì.

- **Không bắt ai gõ lệnh nữa.** Bấm "Tạo bộ cài" → tải về `cai-linh-su.cmd` → bấm đúp.
  Tệp được dựng NGAY TRONG TRÌNH DUYỆT bằng Blob: linh phù vốn đã nằm ở client (action vừa
  trả về), nên không cần thêm endpoint, và bí mật không bao giờ đi qua một URL để rồi nằm
  lại trong log máy chủ. Cách dán lệnh vẫn còn, thu vào sau một dòng "hoặc cài bằng dòng
  lệnh" cho máy chủ/SSH.
- **Nói trước cái đúng cho hầu hết mọi người.** Khi linh sứ tông môn đang trực, mục Linh Sứ
  mở đầu bằng "đạo hữu không cần cài gì cả" — phần cài đặt chỉ là lối rẽ. Đặt ngược lại là
  bắt mọi người tưởng phải cài gì đó mới dùng được. Khi KHÔNG có linh sứ nào trực thì đổi
  sang cảnh báo vàng, vì lúc ấy khai đàn thật sự sẽ nằm chờ.
- **Lỗi layout: cột trái bị bóp còn một sợi chỉ.** Grid item lẫn flex item đều mặc định
  `min-width: auto` — "không co nhỏ hơn nội dung" — nên một dòng lệnh dài không chỗ ngắt
  trong `<pre>` đẩy cột phải phình ra ngoài phần của nó. `overflow-x-auto` trên chính cái
  `<pre>` không cứu được: nó chỉ có tác dụng khi MỌI tổ tiên được phép co. Sửa bằng
  `minmax(0,…)` trên track + `min-w-0` dọc theo chuỗi cha. Đo lại: 566/514 = 1.10 đúng tỉ lệ
  thiết kế, không tràn ngang, kể cả lúc đang hiện lệnh dài lẫn ở màn hình 375px.
- **Tệp .cmd phải THUẦN ASCII** — phát hiện khi chạy thật, không phải khi đọc code. cmd.exe
  phân giải tệp batch theo codepage ANSI TRƯỚC khi dòng `chcp 65001` kịp có tác dụng, nên
  một ký tự tiếng Việt trong tệp là cmd đếm sai byte rồi resume giữa dòng: đo được
  `powershell` biến thành lệnh `ershell`, `echo.` thành `o.`. Giờ nội dung đi qua bộ lọc
  ASCII (giữ `\n` — quên nó là ép cả tệp thành một dòng). Tiếng Việt người dùng thấy đến từ
  install.ps1 tải qua HTTP; `chcp` có mặt chính là để hiển thị phần chữ ấy.
- Phép đổi LF→CRLF cho `.cmd` được làm cho BẤT BIẾN (chuẩn hoá về LF trước) — bản đầu cho ra
  `\r\r\n` vì nội dung đã viết sẵn CRLF rồi bị thay thêm lần nữa.

Đã kiểm trên máy thật: một `.cmd` thuần ASCII dựng đúng khuôn panel sinh ra, chạy bằng
`cmd /c`, tải được install.ps1 (13.497 byte) và in tiếng Việt từ script ấy ra đúng chữ.

## 0.13.1 — sửa hồi quy 0.13.0: server action của /dashboard sập vì hai realm `URL`

Bản 0.13.0 cho `actions/automation.ts` import `parseCookieString` từ `runCycle.mjs`. Cái
giá không thấy được lúc viết: kéo theo cả engine vào bundle của Next, trong đó `profile.mjs`
đọc `profile.json` bằng `readFileSync(fileURLToPath(new URL(…)))` ngay ở THÂN MODULE.
Turbopack thay `URL` bằng bản của nó, nên `fileURLToPath` của Node từ chối:

```
TypeError: The "path" argument must be of type string or an instance of URL.
           Received an instance of URL
```

Lỗi xảy ra lúc NẠP MODULE, nên nó không giết riêng đường cookie — nó giết **mọi** server
action của /dashboard, kể cả phát/thu hồi linh phù, những thứ chẳng liên quan gì tới cookie.
Và chỉ trên bản production: máy dev không bundle nên `URL` chỉ có một.

- **Tách `cookies.mjs` thành module LÁ** — không import gì, không đụng đĩa. Server action
  import từ đó; `runCycle.mjs` re-export nên mọi nơi khác không phải đổi.
- **Chốt hồi quy trong smoke**: khẳng định `cookies.mjs` không có `import` và không có
  `readFileSync`/`fileURLToPath` (bỏ chú thích trước khi soát — chính tệp ấy kể về lỗi này).
  Ngày nào ai đó nối nó về engine, smoke đỏ trước khi production đỏ.
- Đã kiểm ở **chế độ production thật** (`next build` + `next start`, đúng Turbopack bundle
  đã làm vỡ): đăng nhập → /dashboard → phát linh phù → phát lại → thu hồi. Không trang lỗi
  nào, log sạch bóng `ERR_INVALID_ARG_TYPE`. Smoke 68/68.

Bài học ghi lại cho lần sau: mã đi qua **cả** function của Next lẫn worker phải sạch —
không đĩa, không phụ thuộc. Ranh giới ấy mới là thứ quyết định, không phải cái polyfill.

## 0.13.0 — vụ án #lobby-overview: cookie JSON parse ra số không, và số không im lặng

Lượt Mê Cung thật đầu tiên (job 2d6d4a73, 02/08) chết với "Selector không bao giờ xuất
hiện: #lobby-overview". Điều tra bằng A/B trên site thật cho ra thủ phạm KHÔNG như dự đoán:

- **Gốc rễ: người dùng dán bản xuất JSON của desktop** (`{url, cookies:[…]}`) — hành động
  hợp lý nhất trần đời — nhưng `parseCookieString` chỉ hiểu dạng `a=1; b=2` nên trả MẢNG
  RỖNG, không một lời phàn nàn. Browser đi tay trắng, /me-cung đá về trang chủ, và lỗi nổi
  lên mười bước sau dưới tên một selector vô tội. Ba tầng đều lặng thinh: lúc dán (Zod chỉ
  soát độ dài), lúc chạy (chỉ soát chuỗi khác rỗng), lúc chết (thông điệp nói về selector).
- **Sửa tầng một — parser hiểu mọi định dạng hợp lý:** bản xuất JSON của desktop, mảng JSON
  trần của extension, object phẳng, header `Cookie:` copy nguyên, xuống dòng làm dấu ngăn.
  Cookie thuộc site KHÁC trong bản export "tất cả" bị loại — không tiêm rác vào phiên game.
- **Sửa tầng hai — số không phải kêu to, ở thời điểm trung thực nhất:** lúc DÁN, action từ
  chối lưu chuỗi parse ra 0 cookie và nói rõ định dạng nào được nhận; báo luôn số cookie đã
  nhận và cảnh báo nếu thiếu `wordpress_logged_in_…`. Lúc CHẠY, runCycle từ chối lượt với
  lời chỉ đường về Ngọc Giản thay vì để chết ở selector.
- **Sửa tầng ba — port nốt những lớp desktop có mà web thiếu** (lộ ra trong cùng cuộc điều
  tra, dù không phải thủ phạm hôm nay): UA thật thế chỗ "HeadlessChrome/…" (A/B đo được UA
  cũ tự thú đúng chuỗi ấy), `--disable-blink-features=AutomationControlled` +
  `ignoreDefaultArgs` (navigator.webdriver: true → false), timezone + viewport khớp desktop,
  **hồ sơ Chromium bền trên đĩa** (token cf_clearance sống qua các lượt — mỗi lượt không
  phải trình diện Cloudflare như người lạ; nằm cạnh worker nên gỡ cài là sạch theo), và
  **cổng sẵn sàng** port từ EnsureReadyAsync — `readinessProbe` đã được port sang
  boardScripts.mjs từ trước mà chưa từng có ai gọi. Giờ bị chặn là nói bị chặn, hết phiên
  là nói hết phiên, trước khi quest đầu tiên chạy.
- Installer chạy lại KHÔNG cần linh phù khi máy đã cài: tái dùng token trong .env cũ —
  nâng cấp là một lệnh trần, không bắt ai phát lại linh phù (nó chỉ hiện một lần lúc phát).
- Đã kiểm trên site thật với cookie thật: parser mới ra 5 cookie (có phiên đăng nhập, hạn
  16/08), /me-cung đứng vững, **#lobby-overview render** — đúng selector từng chết.
  Smoke 66/66 (7 ca mới cho parser).

## 0.12.1 — gọi thẳng là "tài khoản", và nhật ký dọn được

- **"Pháp Khí" → "Tài khoản hoathinh3d".** Giọng trong-thế-giới vẫn giữ ở mọi chỗ khác
  (linh sứ, tàng khố, ngọc giản), nhưng riêng ô này thì cái tên bóng bẩy che mất thứ người
  dùng cần biết ngay: đây là tài khoản game của họ. Nút xoá ghi rõ **"Xoá tài khoản đã
  lưu"** chứ không phải "Xoá tài khoản" — trên chính trang này họ cũng có một tài khoản
  Auto HH3D, và một nút trần trụi là câu mời hiểu nhầm thành xoá danh tính của chính mình.
- **Nút "Dọn nhật ký"** trên Lư Khai Đàn. Xoá THẬT ở phía server chứ không ẩn trong state
  của React: con trỏ nhật ký reset về 0 mỗi lần tải lại trang, nên một phép "xoá" chỉ nằm
  trong trình duyệt sẽ sống lại nguyên vẹn sau một lần F5. Chỉ chạm lượt gần nhất của chính
  người bấm — `clearLatestJobEvents` tự tra job qua `getLatestJob(userId)` thay vì nhận
  `jobId` từ ngoài, nên không tồn tại đường nào xoá nhầm nhật ký người khác.
- Con trỏ nhật ký KHÔNG bị reset sau khi dọn: id của `job_events` là bigserial không dùng
  lại, nên dòng mới vẫn chảy về; reset về 0 chỉ tổ kéo lại đúng những dòng vừa xoá nếu câu
  DELETE về chậm hơn nhịp hỏi tin kế tiếp.

## 0.12.0 — linh sứ tự mang Node theo, người dùng không phải cài gì nữa

- **Node "xách tay".** Installer tải bản Node chính thức vào thư mục cài và chỉ dùng bản đó
  — bỏ hẳn winget/apt/brew, bỏ quyền admin, bỏ cả đoạn nạp lại PATH và câu "mở PowerShell
  MỚI rồi chạy lại". Ngoài việc xoá rào cản, nó xoá luôn một lớp lỗi: linh sứ tự chạy lúc
  đăng nhập, mà PATH lúc ấy khác PATH trong cửa sổ đang mở, nên `node` tìm qua PATH là lỗi
  "chạy tay thì được, tự khởi động thì không". Bản tải về được đối chiếu **SHA-256** với
  `SHASUMS256.txt` của nodejs.org — ta sắp chạy thứ này như một runtime, không tin suông.
- **playwright-core đóng sẵn trong gói**, không qua npm: thuần JS, không phụ thuộc gì, nén
  ~3MB. Đổi lại: không cần npm, không cần ra registry, và trình tải Chromium chính là
  `cli.js` của bản đang chạy — lỗi "Executable doesn't exist" (CLI lệch phiên bản đặt sẵn
  revision khác) trở thành **bất khả thi về mặt cấu trúc**, chứ không chỉ được canh chừng.
- **Gọi tar bằng đường dẫn tuyệt đối `System32\tar.exe`.** Máy có Git for Windows trong PATH
  đưa ta tới GNU tar, thứ đọc `C:\Users\...` thành «máy chủ C» rồi bỏ cuộc — và bỏ cuộc IM
  LẶNG, vì PowerShell không ném lỗi khi lệnh ngoài trả mã khác 0. Triệu chứng hiện ra ba
  bước sau dưới dạng `Move-Item: PathNotFound`, không nói gì về nguyên nhân. Giờ mọi lệnh
  tar đi qua một hàm bọc có kiểm `$LASTEXITCODE`.
- **Gỡ và cài lại giết ĐÚNG cả ba tầng** (run.ps1 → cmd → node), vòng nuôi trước tiên. Chỉ
  giết `node` là sai: vòng nuôi dựng lại nó sau 10 giây, nên cài lại kết thúc với HAI vòng
  nuôi cùng đọc một `.env` — hai linh sứ mang cùng một WORKER_ID, cùng giành job, cùng mở
  browser trên một máy; còn gỡ cài thì để lại một tiến trình quay vô tận và thư mục bị khoá.
- **Cài lại giữ nguyên WORKER_ID** đã có: ID là danh tính trong sổ điểm danh, sinh mới mỗi
  lần cập nhật sẽ để lại một xác linh sứ "vắng mặt" sau MỖI lần, người dùng nhìn vào tưởng
  mình đang nuôi cả đàn.
- **Hai lỗi mã hoá tiếng Việt.** (a) Next phục vụ `.ps1` là `application/octet-stream` không
  kèm charset, mà `Invoke-RestMethod` của PowerShell 5.1 khi thiếu charset thì giải mã
  ISO-8859-1 — chữ trong script hỏng NGAY TRƯỚC KHI `iex` chạy nó ("Cài linh sứ" → "CÃ i
  linh sá»©"). Đã khai `text/plain; charset=utf-8` trong `next.config.ts`. (b) Nhật ký ghi
  bằng `*>>` của PowerShell bị ghi lại thành UTF-16 kèm cả stack trace `NativeCommandError`;
  chuyển sang cho `cmd` đổ thẳng byte. Với một script tải runtime về chạy, một màn hình đầy
  ký tự rác là điều tệ nhất có thể xảy ra cho lòng tin.
- Nhật ký tự cắt khi quá 5MB — mất mạng một đêm là vài chục nghìn dòng "claim lỗi".

## 0.11.0 — sandbox về vườn, linh sứ dọn lên VM tông môn, và trang cài một-lệnh

- **Vercel Sandbox bị bỏ hẳn** (`runners/sandbox.ts`, `policy.ts`, hai script snapshot, dep
  `@vercel/sandbox`, `outputFileTracingIncludes`). Nó thua ở hai chỗ không chữa được bằng
  code: gói Hobby không có cron đủ dày để lái một VM phù du, và một microVM có trần thời
  gian không bao giờ ôm nổi phiên Mê Cung 35 phút — trong khi MỘT worker sống dai trên VM
  Always Free làm được cả hai việc, đơn giản hơn, không tính tiền compute theo lát. Enum
  `runner_kind` giữ nguyên giá trị `sandbox` trong Postgres (job lịch sử còn mang nó; rút
  một giá trị enum đã dùng là một cuộc phẫu thuật không đáng), nhưng không dòng code nào
  còn ghi giá trị đó.
- **Linh sứ tông môn trên Oracle Cloud Always Free** — kit dựng trọn ở `deploy/oracle/`:
  chọn A1.Flex + Ubuntu 24.04 aarch64 (Playwright hỗ trợ chính thức, có Chromium arm64;
  con AMD micro 1GB thì Chromium chết ngạt), `setup.sh` idempotent dựng Node 22 + Chromium
  + systemd, cập nhật = chạy lại đúng một lệnh. VM chỉ mở SSH — worker là kẻ chỉ gọi ra.
- **Linh phù: token worker riêng cho từng đạo hữu.** Trang cài đại trà mà phát WORKER_TOKEN
  toàn cục là trao cho mỗi người quyền đọc cookie game của tất cả — nên token toàn cục rút
  về làm chìa của linh sứ tông môn, còn mỗi đạo hữu cầm linh phù riêng (database chỉ giữ
  SHA-256, bản rõ hiện đúng một lần lúc phát). Scope cắm thẳng vào câu SQL claim (linh sứ
  riêng chỉ thấy hàng chờ của chủ mình) và ba op còn lại đi qua `jobBelongsTo` — thiếu nó
  thì một linh phù hợp lệ bất kỳ complete được job người khác chỉ bằng cách đoán jobId.
  Tài khoản bị khoá thì linh phù mất hiệu lực theo, không cần ai nhớ đi thu hồi.
- **Mục Linh Sứ trên dashboard + cài một lệnh.** Người dùng không cần biết npm là gì:
  panel phát lệnh cài cho Windows (PowerShell) và Linux/macOS, lệnh tải gói
  `/linh-su/goi-linh-su.tgz` — được `buildWorkerBundle.mjs` đóng ở MỖI deploy từ đúng
  engine đang chạy, không tồn tại bản thứ hai để lệch — cài Node/Chromium nếu thiếu, ghim
  đúng phiên bản playwright-core đọc từ trong gói (lệch một nấc là "Executable doesn't
  exist"), đăng ký tự chạy cùng máy (HKCU Run + vbs ẩn cửa sổ — không cần admin; systemd
  user unit + linger; launchd), kèm sẵn uninstall.
- **Sổ điểm danh linh sứ** (bảng `workers`, migration 0005): mỗi lần hỏi việc là một lần
  điểm danh. Dashboard nói thật NGAY LÚC khai đàn là có linh sứ trực hay không — trước đây
  sự thật ấy chỉ lộ ra sau sáu phút im lặng, khi reaper kết liễu job với một dòng lỗi. Hạn
  không-ai-nhận rút từ 6 phút về 2 (worker hỏi mỗi 5 giây, không còn lý do gì để đợi VM
  dựng); `/api/cron` chỉ còn là lưới vệ sinh.

## 0.10.0 — đàm đạo dọn về kho NoSQL, tin có hạn sống, Tông Môn chia tab

- **Tin đàm đạo rời Postgres, sống trong kho NoSQL (Upstash Redis).** Hai loại dữ liệu
  khác nhau cả nhịp ghi lẫn vòng đời: Postgres giữ danh tính và cấu hình — thứ sống lâu,
  cần giao dịch; tin đàm đạo là dòng chảy tần suất cao tự hết hạn theo ngày, không JOIN
  với ai. Hình dạng: mỗi tin một document JSON (kèm TÊN người gửi đóng băng lúc gửi —
  NoSQL không JOIN, và tên tại thời điểm nói vốn trung thực hơn tên sau này đổi thành),
  một ZSET làm mục lục thời gian (phân trang + quét hạn đều là một câu score-range), cảm
  xúc là field hash — thêm/rút nguyên tử, không có đọc-rồi-ghi để mà đua. Ba bảng chat
  trong Postgres đã DROP (migration 0003/0004).
- **Kho chưa tạo không phải lỗi**: mọi đường trả `storeClosed`, API nói 503 kèm lời người
  đọc hiểu, sảnh treo biển 🏮 "chưa khai mở" — phần còn lại của web không việc gì. Tông
  chủ tạo kho qua Marketplace là sảnh tự sống dậy, không đổi một dòng code.
- **Tin tự tan sau N ngày** (mặc định 7) — sảnh là dòng chảy, không phải tàng thư. Quét
  chạy ở nhịp cron và "tiện đường" mỗi 10 phút khi có người đọc sảnh, nên không có cron
  ngoài vẫn sạch. Số ngày do tông chủ đặt trong trang Tông Môn.
- **Trang Tông Môn chia tab** — "Môn Đồ" (sổ bộ cũ) và "Đàm Đạo" (hạn lưu tin); khung tab
  nhận nội dung server-render qua slot, thêm khu cấu hình sau này là thêm một mục vào
  mảng. Tab đổi hiển thị chứ không unmount, bảng môn đồ giữ nguyên scroll và ô tìm kiếm
  đang gõ dở.
- Xuống dòng trong khung chat đổi sang **Alt+Enter** (Enter vẫn gửi); nhãn nơi vận hành
  ghi rõ "Linh sứ túc trực (máy nhà)".
- Cấu hình hệ thống có nhà mới: bảng `app_settings` một-document-JSONB, Zod gác hai chiều
  — cùng triết lý với user_configs.

## 0.9.0 — Tụ Nghĩa Sảnh, đủ 12 nhiệm vụ, và hậu trường rút vào cánh gà

- **Tụ Nghĩa Sảnh — sảnh đàm đạo toàn tông môn** (`/chat`). Gửi/sửa/thu hồi, trả lời có
  trích đoạn, thả cảm xúc (bấm lại là rút), emoji + sticker, gửi ảnh và file (kéo-thả,
  dán từ clipboard), "đang chấp bút…", dải ngày, cuộn ngược lật trang cũ, nút về-cuối đếm
  tin mới. NỘI DUNG tin là document JSONB — hình thù tin churns như hình thù config, mỗi
  kiểu mới mà dùng cột là một migration; media thì KHÔNG vào database: bytes lên kho Blob,
  document chỉ giữ URL. Thu hồi là soft-delete có vết — sảnh chung mà tin biến mất không
  dấu tích là chỗ để gaslight nhau. Realtime bằng poll ~2.5s xin NGUYÊN trang mới nhất:
  tin cũ cũng biến động (sửa, thu hồi, cảm xúc) nên cursor chỉ-tiến sẽ mù; ở quy mô một
  tông môn, một trang mỗi 2.5s là giá rẻ cho việc không phải đồng bộ từng phần. Đã kiểm
  đầu-tới-cuối bằng phiên thật: UTF-8 tròn vành, quote, reaction, sửa, thu hồi, typing,
  upload lên kho thật.
- **Đủ 12 nhiệm vụ như bản desktop.** Mười nhiệm vụ một-công-tắc vào form theo một bảng
  dịch hai cột (key config ↔ tên trong hồ sơ) — thêm nhiệm vụ sau này là thêm một dòng ở
  hai bảng, không thêm code. Hồ sơ nâng lên schema 42 và từ nay SINH BẰNG LỆNH
  `export` của bộ fixture desktop, không chép tay: chép tay theo diff C# là hẹn ngày hai
  bản lệch nhau ở đúng một dấu nháy trong script.
- **Mê Cung thêm "trục xuất nếu không sẵn sàng sau N giây"** (0 = tắt) — ghế của người
  không sẵn sàng là ghế người khác không ngồi được. Đồng hồ tính từ lúc linh sứ NHÌN THẤY
  thành viên lần đầu: tool không làm chứng cho những giây nó không quan sát.
- **Luyện Đan kiểm thu đan lần hai ngay trước khai lô** — mẻ có thể chín trong chính những
  giây lượt này đang bận phân giải, và lượt kiểm đầu đã trôi qua từ trước đó.
- **Hậu trường rút vào cánh gà.** Ô "Nơi vận hành đàn pháp" khoá hẳn (một lựa chọn đang
  phụng sự, một "chưa xuất quan"); mọi text giải thích thôi nhắc hạ tầng — người chơi đọc
  chuyện linh sứ và tàng khố, không đọc chuyện máy ảo và mã hoá. Đã quét trang sống: không
  còn một chữ kỹ thuật nào lộ ra.
- Suite: 62/62. Bảng chat migrate bằng file SQL commit như mọi migration khác.

## 0.8.1 — có đường đặt lại mật khẩu, vì seed cố ý không làm việc đó

- **`npm run db:reset-password <tên>` ra đời.** `db:seed` **cố ý** không đổi mật khẩu của
  tài khoản đã tồn tại — một lệnh seed lỡ tay không được phép reset chìa khoá của hệ thống
  đang chạy. Điều đó đúng, nhưng nó để lại một ngõ cụt có thật: khi mật khẩu trưởng môn thất
  lạc, chạy lại seed chỉ in "đã tồn tại — không đổi gì cả" rồi **thoát 0**, trông y hệt như
  đã làm xong việc. Người dùng gõ mật khẩu mới vào `.env`, chạy seed, thấy màu xanh, và vẫn
  không vào được — không một dòng nào nói rằng mật khẩu chưa hề bị đụng tới.
- Script được làm cho **ồn ào** đúng ba chỗ đã từng cắn dự án này: tên tài khoản phải khai
  tường minh (không mặc định, để không lỡ tay), database được **in ra trước khi ghi** (hai
  database trên cùng một host đã một lần bị nhầm), và mật khẩu đi qua biến môi trường chứ
  không qua tham số dòng lệnh — tham số sẽ nằm lại trong lịch sử shell và hiện trong bảng
  tiến trình.

## 0.8.0 — bảo hoa rơi, footer về đúng đáy, và web vừa mọi màn hình

- **Footer hết lơ lửng.** Trang auth chỉ cao 80dvh để căn giữa lá bài, nên dòng ký tên đứng
  chơ vơ ở vạch 80% màn hình. Sticky footer kiểu cột dọc (body flex-column + margin-top:auto)
  đưa nó về đáy khung nhìn khi trang ngắn, sau nội dung khi trang dài — đo trên trang sống:
  khoảng cách tới đáy tài liệu = 0px ở cả ba trang.
- **Login/Register có nút "← Về Trang Chủ".** Hai trang nghi lễ không mang SiteHeader, nên
  trước đó ai lỡ bước vào chỉ còn nút Back của trình duyệt.
- **Bảo hoa rơi trên trang chủ** — cánh hoa hồng phấn ánh tím của Bảo Hoa tiên tử (Phàm Nhân
  Tu Tiên), vị tiên tử ký tên ở chân trang. Mười hai cánh hai lớp (hồng phấn + tím nhạt),
  rơi nghiêng theo hai chu kỳ lệch pha để không bao giờ thành đàn; pointer-events none nên
  hoa chỉ để ngắm, không chắn một cú bấm nào. Chỉ trang chủ có hoa — sảnh đón thì rắc hoa,
  bàn làm việc thì không.
- **Responsive cho mọi thiết bị.** Đệm trang co theo màn hình (px-4 → sm:px-6), header cho
  phép xuống hàng thay vì ép ngang, hero co chữ ba nấc (3xl/4xl/5xl), veil đệm bằng clamp()
  thay vì 2.5rem cứng từng đẩy tràn ngang máy 360px, bảng thành viên admin đã cuộn ngang từ
  trước. Đo ở 375×812: tràn ngang 0px trên cả ba trang công khai.

## 0.7.0 — cái chờ thức dậy đúng lúc sự kiện xảy ra, và chữ thôi chìm vào trăng

- **`waitForCondition` chuyển từ poll sang MutationObserver trong trang.** Vòng cũ lấy mẫu
  mỗi 300ms qua CDP; một trạng thái tồn tại ngắn hơn nhịp đó — hàng roster loé qua sảnh,
  nút mở khoá trong chớp mắt giữa hai lần re-render — đơn giản là vô hình với nó. Giờ cái
  chờ sống trong trang và được mutation đánh thức NGAY tại sự kiện: đo trên lưới, phần tử
  hiện ở t=600ms thì bước xong ở t=605ms, và một trạng thái chỉ loé 150ms được bắt gọn —
  ca mà vòng poll cũ trượt hẳn. Mê Cung dựng gần như toàn bộ bằng những cái chờ này (sảnh
  đầy dần, phản ứng trục xuất, trận kết thúc), nên đây chính là "quan sát liên tục như
  realtime". Cắt lát 2 giây để lệnh dừng và ngân sách bước vẫn cầm quyền từ bên ngoài;
  tick 400ms trong trang làm lưới an toàn cho thay đổi hiếm hoi không kèm mutation. Bản
  desktop đổi cùng cơ chế, cùng lúc.
- **Chữ và nút bị ảnh nền nuốt được trả lại độ tương phản** — và CHỈ những chỗ bị nuốt.
  Khối chữ hero trang chủ nằm đè đúng lõi trăng sáng nên chữ vàng gradient lẫn vào trăng:
  thêm một tấm veil tối mờ (blur 10px) ôm sát khối chữ, ấn phía trên và ba pillar bên dưới
  vẫn đứng thẳng trên ảnh. Nút ghost ("Nhập Môn", "Đã có đạo hiệu") vốn trong suốt 96% nên
  biến mất trên vệt nước sáng và tán lá vàng: giờ tự mang nền tối mờ + viền đậm hơn, vẫn
  là ghost đứng cạnh nút vàng đặc, nhưng không còn chỗ nào trên ảnh nuốt được nó.
- Suite: 59/59 — bốn ca mới ghim đúng ngữ nghĩa realtime: bắt trạng thái loé 150ms, thức
  dậy sát sự kiện (đo bằng đồng hồ), và timeout vẫn ra một câu có tên.

## 0.6.0 — thành Auto HH3D, và artwork thật thay cho bản dựng lại

- **Đổi tên hiển thị: Jarvis HH3D → Auto HH3D** — title, header, chữ trên trang chủ. Tên
  repo và tên gói giữ nguyên: đường link, remote và lịch sử không việc gì phải gãy theo một
  cái tên hiển thị.
- **Nền và ấn giờ là FILE GỐC**, không phải bản dựng lại. Bản 0.5.0 vẽ xấp xỉ cả cảnh đêm
  lẫn con dấu bằng CSS/SVG vì chưa có file; giờ hai tấm gốc nằm trong `public/`
  (`backdrop.png` — Nam Cung Uyển dưới trăng, `seal.png` — ấn thư pháp), nguyên vẹn từng
  pixel, và toàn bộ trăng-lá-núi-chùa giả cùng font Dancing Script đã dọn đi: hai mặt trăng
  trên một bầu trời là thứ không cứu được. Không phủ lớp tối lên ảnh — header và card tự
  mang nền mờ của chúng, nên ảnh được để yên đúng như yêu cầu.
- Ấn hiển thị qua `next/image` với `priority`: con dấu luôn đứng đầu màn hình, để lazy thì
  nó là thứ nhấp nháy vào sau cùng ở đúng chỗ mắt nhìn trước tiên. Optimizer phục vụ bản
  ~120px, không đẩy nguyên tấm 2.3MB xuống trình duyệt.
- Chữ mới trên trang chủ: "Nhật Ký Tu Luyện" nói giọng tu chân ("log bằng ngôn ngữ nhân
  tộc"), khối "Tông Môn Nghiêm Cẩn" thêm dòng "Chỉ dành cho thành viên Lạc Vân Tông", và
  chân trang ký "© 2026 Bảo Hoa tiên tử. All rights reserved."

## 0.5.0 — hai hạng tài khoản, và trang web khoác áo đêm trăng

- **Nhiệm vụ tách hai tab: VIP và Thường** — theo đúng cách site chia tài khoản. Mọi nhiệm
  vụ hiện có đều được ghi trên tài khoản VIP nên nằm cả bên tab VIP; tab Thường thành thật
  là chỗ giữ chỗ, flow cho tài khoản thường sẽ về sau. Tab chỉ đổi hiển thị chứ không
  unmount: các ô nhập phải luôn trong DOM để FormData lúc lưu gom đủ giá trị — unmount tab
  VIP rồi bấm lưu từ tab Thường là lặng lẽ tắt hết nhiệm vụ.
- **Linh sứ tự nhận ra hạng tài khoản**, không bắt người dùng khai. Tín hiệu là thẻ Phúc Lợi
  VIP `#nv-pt-vip-quest` trên hub — site chỉ phục vụ thẻ này cho tài khoản VIP. Probe trả
  ba đáp án và đáp án thứ ba là thứ đắt nhất: `null` khi CHƯA CHỨNG MINH ĐƯỢC sự vắng mặt.
  Hub render làm hai đợt (bốn thẻ đầu tới ngay, đợt chứa thẻ VIP tới sau ~2.5 giây — đo từ
  bản ghi thực địa), nên một probe vội sẽ phán "thường" ngay trong khe hở đó và một tài
  khoản VIP mất trọn chu kỳ. Sự vắng mặt chỉ được tính khi một thẻ CÙNG ĐỢT đã có mặt.
  Chính suite fixture bên desktop bắt được lỗi này trước khi nó kịp chạy thật (ca V6).
- Mọi ngả mù — hub không mở được, probe không trả lời kịp — đều đổ về VIP: đó là hạng duy
  nhất hồ sơ hiện có được viết cho, và đoán nhầm "thường" là lặng lẽ bỏ trống lượt của
  người ta.
- `requiresVip` vắng mặt trong hồ sơ cũ được đọc là TRUE, cùng chiều với bản desktop, cùng
  lý do.
- **Ấn tông môn vẽ lại theo mẫu thư pháp**: "Phàm nhân tu tiên" ba dòng bút lông vàng kim
  (Dancing Script, subset vietnamese — font script thiếu subset sẽ rơi về font hệ thống ở
  đúng những ký tự có dấu), lồng vòng tròn kép chấm-rời-xoay-chậm + nét liền.
- **Nền chuyển thành đêm trăng**: trăng lớn toả quầng ba lớp lệch phải, trời xanh mực, dãy
  núi và thuỷ đình + chùa nhỏ thắp đèn ấm ở chân trời, mặt nước loang vệt trăng, chín chiếc
  lá vàng rơi theo nhịp riêng (hai chu kỳ nguyên tố giữ chúng không bao giờ khoá pha thành
  đàn). Thuần CSS/SVG — không tải một tấm ảnh nào.
- Suite: 55/55 (`npm run smoke`).

## 0.4.1 — tách lịch sử ra khỏi README

- Lịch sử phát hành chuyển sang chính file này. README đã phình tới mức phần hướng dẫn bị
  chôn dưới lịch sử, mà hai thứ đó phục vụ hai lúc khác nhau: README đọc khi đang dựng hệ
  thống, changelog đọc khi đang truy một hành vi lạ về nguồn gốc của nó. Bản desktop tách
  cùng lúc và cùng lý do — README bên đó có 1828 dòng thì 1440 dòng là changelog.

## 0.4.0 — người dùng chọn được nơi chạy, nhưng sandbox còn là cổng hẹp

- **Ô "Nơi vận hành đàn pháp" giờ mặc định linh sứ máy nhà**, và lựa chọn sandbox bị khoá
  với mọi tài khoản trừ tông chủ. Lý do đứng sau cái khoá: mỗi lát sandbox là một máy ảo
  tính tiền trên tài khoản Vercel dùng chung, và chừng nào chưa đo được chi phí theo từng
  người thì mở rộng là mở một vòi không có đồng hồ. Mở lại cho tất cả = trả về `true` trong
  `sandboxAllowedFor()`, một chỗ duy nhất mà cả ba tầng dưới đây đều hỏi.
- **Ràng buộc sống ở ba tầng, không phải ở form.** Form làm mờ lựa chọn và nói vì sao mờ;
  action đọc vai trò từ phiên rồi ép lại lúc lưu, vì `disabled` chỉ là một thuộc tính HTML
  và một POST dựng tay chẳng đi qua form lần nào; `decideRunner` kiểm lại lúc khai đàn, đọc
  quyền từ **dòng user**. Tầng thứ ba mới là tầng cần nhất: `sandbox` từng là giá trị **mặc
  định**, nên mọi document đã nằm trong database đều đang mang đúng chữ đó, và chúng không
  đi qua form lần nào. Nó cũng khiến việc tông chủ hạ quyền ai đó có hiệu lực ngay ở lượt kế
  tiếp, không phải chờ người đó mở form lưu lại.
- Quyền **không** được lấn át hình dạng nhiệm vụ: Mê Cung vẫn về máy nhà kể cả với tông chủ,
  vì mất VM giữa trận là bốn người khác mất lượt oan.
- **Sửa một lỗi hoán chỗ suýt gây mất đồ.** Form ghi "Không phân giải (giữ tất cả)" bằng giá
  trị `5`, trong khi lớp dịch đọc con số là "giữ từ N sao trở lên". Đan chỉ rơi 1–4 sao, nên
  "giữ từ 5" là **phân giải sạch** — người dùng bấm giữ tất cả rồi mất tất cả, không một
  dòng lỗi nào để lần ra. Giá trị đúng là `1`; cả hai mốc giờ có ca kiểm riêng.
- Suite: 51/51 (`npm run smoke`).

## 0.3.0 — engine thật thay cho vòng chờ giả, và nó dùng chung hồ sơ với bản desktop

- **Hai worker thôi là khung.** Trước đó giao thức, nhịp tim, dừng an toàn và tường thuật
  đều chạy được nhưng chưa từng chạm game; giờ chúng chạy bộ thông dịch thật.
- **Điều đáng nói không phải "đã port", mà là port cái gì.** Hồ sơ quest không phải cấu hình
  — nó là *tri thức về site*, mỗi selector là một buổi tối ngồi xem trang thật và vài cái là
  cả một đêm hỏng việc mới rút ra. Nên web không chép lại tri thức ấy: nó đọc thẳng
  `profile.json` schema 41 mà bản desktop đang chạy, và chỉ bộ thông dịch (13 loại bước × 6
  loại điều kiện) được viết lại bằng JS. Site đổi marker thì sửa một chỗ, không phải hai.
- **Ba lỗi port do lưới hồi quy bắt, đều là loại không tự kêu:**
  - Playwright bản .NET tự **gọi** một chuỗi hình dạng `() => {…}`; bản JavaScript đánh giá
    nó ra một function rồi trả `undefined`. Mọi script trong hồ sơ đều viết dạng đó. Để
    nguyên thì mọi bước `evaluateJavaScript` im lặng trả undefined — toàn bộ tường thuật Mê
    Cung, mọi quyết định trục xuất, mọi lần đọc bảng điểm đều mất tiếng, và không có một
    dòng lỗi nào để lần ra.
  - `\b` của JavaScript chỉ biết `[A-Za-z0-9_]`, nên sau chữ "giờ" — kết thúc bằng "ờ" — nó
    không thấy ranh giới nào và "còn 2 giờ 5 phút" đọc ra 5 phút. Bản C# dùng cùng regex mà
    vẫn đúng vì `\w` của .NET nhận cả chữ Unicode. Hậu quả không phải một ngoại lệ mà là một
    lịch sai, lặp lại mỗi lần.
  - Một ngưỡng HP người dùng tự gõ, nếu không có trong danh sách lựa chọn, sẽ rơi về lựa
    chọn đầu tiên — tức "Không trục xuất". Người ta gõ 250.000 rồi ngồi xem cả lượt không
    đuổi ai. Giờ giá trị lạ được nhận nguyên văn qua `allowCustom`, và việc đó được kể lại.
- **Các probe in-page chuyển từ chuỗi sang hàm thật**, vì Playwright bản JS nhận thẳng
  function. Dạng chuỗi bắt mọi `\s`, `\p{L}`, `${` phải escape thêm một tầng, và chỗ nguy
  nhất là bảng phân loại nút popup — regex hỏng ở đó nghĩa là bấm "Huỷ" thay vì "Đồng ý".
- **Ảnh VM chuyển từ agent-browser sang playwright-core + Chromium cùng phiên bản**, cài tại
  thư mục làm việc chứ không `-g`: Node giải bare specifier bằng cách đi ngược cây thư mục,
  một gói global không nằm trên đường đi đó. Kèm `scripts/verifySandboxSnapshot.mts`, vì một
  ảnh hỏng **không kêu lúc chụp** — nó kêu trên production, trong một VM đã tự huỷ, sau khi
  người dùng bấm nút.
- Thêm `npm run smoke`: lưới hồi quy chạy trên Chromium thật, trước một trang thật. Mỗi ca
  là một chuyện đã xảy ra một lần rồi.

## 0.2.0 — ghi lại những cái bẫy của lần deploy đầu tiên

- **Bẫy `DATABASE_URL`.** Integration Neon của Vercel tự tạo biến này trỏ vào database *mặc
  định* của project (`neondb`), không phải `jarvis`. Nguy ở chỗ nó không gãy: `db:migrate`
  chạy trót lọt vào nhầm database, app lên vẫn đăng nhập được bằng dữ liệu sai, nên chẳng có
  gì kêu lên — chỉ có người ngồi tự hỏi sao mật khẩu vừa đặt lại không đúng. Đây chính là
  cách bốn bảng rác trong `neondb` ra đời. README giờ nêu đích danh cái bẫy, kèm câu lệnh hỏi
  thẳng database "mày là ai".
- **`WEB_URL` không hề có trong `.env.example`**, dù thiếu nó thì sandbox từ chối chạy: VM
  sinh ra bên ngoài Vercel nên không có cách nào tự đoán ra tên miền của bạn.
- **README quả quyết `vercel.json` "chạy mỗi phút"**, trong khi file ghi `0 3 * * *` — tàn
  tích từ trước lúc biết gói Hobby chỉ cho cron mỗi ngày một lần. Đọc nhầm chỗ này thì tưởng
  sandbox tự chạy liên tục, mà thật ra sau lát đầu tiên sẽ không ai gõ cửa nữa.
- `createSandboxSnapshot.mts` thôi đòi token cá nhân: sau một lần `vercel env pull`, `.env`
  đã có `VERCEL_OIDC_TOKEN` và SDK tự dùng được.

## 0.1.0 — control plane đầu tiên

- **Web không bao giờ tự mở browser.** Bấm Khai Đàn = ghi một dòng `automation_jobs` trạng
  thái `queued`. Function của Vercel sống theo request và không thể nuôi một phiên Chromium
  35 phút; nên web giữ *ý định* của người dùng trong database, còn việc mở browser thật do
  một linh sứ ở máy khác làm. Trình duyệt của người dùng chỉ là cái điều khiển từ xa — đóng
  nó đi không thay đổi gì.
- **Hai runner sau một giao diện chung, chọn theo hình dạng thời gian của nhiệm vụ.** Luyện
  Đan Đường (mỗi lượt vài phút, nghỉ ~26 phút) hợp một VM phù du; Mê Cung (chờ đủ 5 người
  thật rồi đánh liền 35 phút, một phiên browser không đứt được) **bắt buộc** máy nhà. Chính
  sách phủ quyết lựa chọn của người dùng và **ghi rõ lý do** vào nhật ký, không âm thầm làm
  khác ý.
- **Cookie game mã hoá AES-256-GCM at-rest**, IV mới mỗi lần, phong bì `v1.<iv>.<tag>.<ct>`.
  Cookie đi **một chiều**: không bao giờ trả về trình duyệt — một bí mật đã mã hoá trong
  database mà vẫn render vào HTML mỗi lần mở trang thì coi như chưa mã hoá. UI chỉ hiện
  "đã có / chưa có" cùng một ô thay thế; để trống là giữ nguyên. Giải mã đúng **một lần**,
  tại `/api/worker`, sau khi linh sứ đã xác thực bằng `WORKER_TOKEN`.
- **Sandbox chạy được trên gói Hobby nhờ đảo vai.** Function không chờ VM: nó dựng VM,
  `writeFiles` một worker script, `runCommand({ detached: true })`, rồi trả về trong vài
  giây. VM sống bằng timeout của chính nó và tự gọi `/api/worker` bằng đúng giao thức bốn
  thao tác mà worker máy nhà dùng. Nhờ vậy trần 60 giây của function Hobby thành vô hại, và
  hai runner là hai hiện thân của **một** hợp đồng.
- **Hai giới hạn gói Hobby đụng phải, né bằng thiết kế chứ không bằng cách trả tiền:** cron
  chỉ 1 lần/ngày (nên bấm Khai Đàn thả sandbox ngay, không đợi nhịp) và function chỉ sống 60
  giây (nên không bao giờ `await` sandbox trong route).
- Config người dùng là JSONB trong chính Postgres, Zod validate **cả hai chiều** — document
  viết bởi một bản deploy cũ vẫn trở về đúng hình thù hôm nay, defaults điền đủ. Đó là bản
  sinh đôi của một migration schema, dành cho dữ liệu không có schema.
