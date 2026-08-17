# Vỏ proxy Vercel — thứ DUY NHẤT còn deploy lên các trạm từ 16/08/2026

Backend (app Next.js + Postgres + MongoDB) sống trọn trên VM OCI `jarvis-oci-01`
(`https://158.180.59.36.sslip.io`). Mỗi trạm Vercel nay chỉ là **một tấm rewrite**: mọi
request tới `auto-hh3d*.vercel.app` được Vercel chuyển nguyên vẹn (method, body, cookie)
về backend, và trả nguyên vẹn câu trả lời. Người dùng giữ đúng URL cũ; cookie phiên vẫn
same-origin vì trình duyệt chưa bao giờ thấy địa chỉ VM.

Deploy một trạm = `npx vercel deploy deploy/vercel-proxy --prod` với token + project của
trạm ấy — `deploy:all` đã làm sẵn việc này cho MỌI trạm. Không build, không env, không
database: hết luôn hai bệnh cũ là git-author BLOCKED và lệch env giữa các trạm.

`__proxy.txt` là vật đánh dấu: tệp tĩnh DUY NHẤT của shell, dùng để nhận diện một trạm
đã lật sang vỏ proxy (`curl <trạm>/__proxy.txt` trả 200 kèm số hiệu). Đừng thêm tệp tĩnh
nào khác — tệp tĩnh trong shell CHE đường dẫn cùng tên của app thật phía sau.
