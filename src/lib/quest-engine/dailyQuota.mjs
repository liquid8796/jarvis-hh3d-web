/**
 * NHIỆM VỤ NGÀY CÓ TRẦN LƯỢT — danh sách quyết định cái gì được phép nhớ「hôm nay xong rồi」.
 *
 * Vì sao phải có một danh sách thay vì tin thẳng vào kết cục `alreadyDone`: `alreadyDone` chỉ
 * nói「trang không còn gì để bấm và cũng không có đồng hồ nào đang chạy」. Với chín nhiệm vụ
 * dưới đây câu ấy đồng nghĩa với「hết lượt của ngày hôm nay」, vì trần của chúng là trần NGÀY
 * và chỉ mốc sang ngày mới mở lại. Nhưng cùng một kết cục ấy, ở Mê Cung hay Luyện Đan Đường,
 * lại có thể chỉ là một trạng thái thoáng qua của cái lò — nhớ nhầm nó là tắt mất nhiệm vụ
 * đáng giá nhất trong ngày mà không ai được báo. Nên phạm vi được KHAI RÕ, không suy đoán.
 *
 * Khoá theo ID chứ không theo TÊN: cặp twin VIP/thường cố ý trùng tên nhau (xem
 * `questsForAccount`), còn ID mới là khoá chính của hồ sơ. Cả hai bản của một nhiệm vụ đều có
 * mặt ở đây vì trần lượt là của TÀI KHOẢN, không phải của cái flow chạy nó.
 *
 * Đổi ID trong hồ sơ mà quên chỗ này thì tính năng lặng lẽ ngừng hoạt động — nên `npm run
 * smoke` đối chiếu từng ID dưới đây với hồ sơ thật và ĐỎ khi có cái không còn tồn tại.
 */
export const DAILY_QUOTA_QUEST_IDS = new Set([
  "diem-danh",
  "diem-danh-thuong",
  "phuc-loi-duong",
  "phuc-loi-duong-thuong",
  "hoang-vuc",
  "hoang-vuc-thuong",
  "thi-luyen-tong-mon",
  "thi-luyen-tong-mon-thuong",
  "te-le-tong-mon",
  "te-le-tong-mon-thuong",
  "phuc-loi-vip-khac-tran-van",
  "vong-quay-phuc-van",
  "vong-quay-phuc-van-thuong",
  "van-dap",
  "van-dap-thuong",
  "bi-canh-tong-mon",
]);

/** Nhiệm vụ này có trần lượt theo ngày không. */
export function isDailyQuotaQuest(quest) {
  return quest != null && DAILY_QUOTA_QUEST_IDS.has(quest.id);
}

/**
 * Kết quả vừa rồi có phải lời khai「hôm nay hết lượt」không.
 *
 * Ba điều kiện phải cùng đúng, và điều kiện thứ ba là điều kiện đắt nhất: `dailyCapReached`
 * chỉ được engine gắn khi lượt dừng đến từ một bước `stopIf` — tức chính TRANG GAME nói không
 * còn gì để làm. Vấn Đáp dừng vì khôi lỗi chưa biết đáp án cũng ra `alreadyDone`, nhưng đó là
 * giới hạn của ta chứ không phải của tài khoản: nhớ nó thành「đã đủ lượt」là khoá cứng nhiệm
 * vụ cả ngày đúng vào lúc kho đáp án có thể vừa học thêm được câu ấy.
 */
export function reachedDailyQuota(quest, outcome) {
  return (
    isDailyQuotaQuest(quest) &&
    outcome?.outcome === "alreadyDone" &&
    outcome?.dailyCapReached === true
  );
}
