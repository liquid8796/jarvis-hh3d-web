import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { pingNoticeChannel } from "@/lib/realtime/noticeChannel";
import { NOTICE_WINDOW_DAYS, type NoticeInput } from "@/lib/validation/notices";

/**
 * Thông báo tông môn: phát ra, đọc phần chưa xem, đánh dấu đã xem.
 *
 * Mọi luật về AI NHẬN sống ở đây, không ở route và không ở component — cùng lẽ với queue.ts:
 * ranh giới "ai được thấy gì" mà nằm trong giao diện thì mỗi đường vẽ mới lại phải nhớ lại nó
 * một lần, và có ngày một đường quên.
 */

/** Một lời nhắn đã sẵn sàng cho popup — không mang phạm vi, vì người đọc không cần biết. */
export type NoticeForUser = {
  id: string;
  body: string;
  createdAt: string;
  /** Danh xưng người phát, `null` khi họ đã rời tông môn (`sent_by` khi ấy là null). */
  sender: string | null;
};

/**
 * Những lời nhắn người này CHƯA bấm「Đã hiểu」, cũ nhất trước.
 *
 * Bốn điều kiện, mỗi cái một lý do:
 *   • trong hạn `NOTICE_WINDOW_DAYS` — xem chú thích ở validation/notices.ts;
 *   • phát SAU khi người này nhập môn — người mới vào hôm nay không có lý do gì phải đọc lại
 *     một tuần thông báo cũ của tông môn, và cái popup đầu tiên họ thấy nên là lời chào chứ
 *     không phải bảy cái hộp xếp hàng;
 *   • chưa có dấu đã xem;
 *   • và phạm vi phải khớp — `all`, hoặc id nằm trong danh sách, hoặc mang một trong các vai.
 *
 * `@>` (chứa) chứ không `?` (có khoá): toán tử `?` của jsonb trùng ký tự với placeholder của
 * nhiều driver, và một ngày nào đó ai đó đổi driver thì câu này hỏng theo kiểu khó lần. `@>`
 * nói đúng cùng một điều mà không giẫm lên cú pháp của ai.
 */
export async function unseenNotices(userId: string): Promise<NoticeForUser[]> {
  const rows = await db().execute<{
    id: string;
    body: string;
    created_at: string;
    sender: string | null;
  }>(sql`
    select n.id, n.body, n.created_at, u.display_name as sender
      from notices n
      left join users u on u.id = n.sent_by
     where n.created_at > now() - make_interval(days => ${NOTICE_WINDOW_DAYS})
       and n.created_at > (select created_at from users where id = ${userId})
       and not exists (
             select 1 from notice_reads r
              where r.notice_id = n.id and r.user_id = ${userId}
           )
       and (
             n.audience_kind = 'all'
             or (n.audience_kind = 'users' and n.audience @> to_jsonb(${userId}::text))
             or (
                  n.audience_kind = 'roles'
                  and exists (
                        select 1 from user_roles ur
                         where ur.user_id = ${userId}
                           and n.audience @> to_jsonb(ur.role_code)
                      )
                )
           )
     order by n.created_at asc
     limit 20
  `);

  return rows.rows.map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
    sender: row.sender,
  }));
}

/**
 * Đếm người sẽ nhận. Chỉ đếm người ĐANG hoạt động: người chờ duyệt và người bị đình quyền
 * không vào được trang nào, nên đếm họ vào là hứa hão với người phát.
 *
 * Ba nhánh viết rời chứ không gộp một câu đa hình: mỗi nhánh đọc ra đúng một câu tiếng Việt,
 * và không có nhánh nào phải mang theo tham số của nhánh khác.
 */
export async function countRecipients(
  audienceKind: NoticeInput["audienceKind"],
  audience: readonly string[],
): Promise<number> {
  if (audienceKind === "all") {
    const rows = await db()
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.status, "active"));
    return rows.length;
  }

  if (audienceKind === "users") {
    // Lọc lấy những chuỗi CÓ HÌNH DẠNG uuid trước khi hỏi database. Không phải để làm sạch —
    // `inArray` đã tham số hoá — mà vì cột `id` là uuid: một chuỗi không phải uuid làm cả câu
    // truy vấn NÉM ("invalid input syntax"), tức một id gõ sai biến thành lỗi 500 thay vì
    // thành "người này không tồn tại".
    const ids = audience.filter((value) => UUID_SHAPE.test(value));
    if (ids.length === 0) return 0;
    const rows = await db()
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.status, "active"), inArray(schema.users.id, ids)));
    return rows.length;
  }

  if (audience.length === 0) return 0;
  const rows = await db()
    .selectDistinct({ id: schema.users.id })
    .from(schema.users)
    .innerJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
    .where(
      and(eq(schema.users.status, "active"), inArray(schema.userRoles.roleCode, [...audience])),
    );
  return rows.length;
}

/** Đúng hình dạng uuid v4 mà `gen_random_uuid()` sinh ra — chỉ dùng để KHỎI ném, không phải để tin. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Phát một lời nhắn.
 *
 * Trả về số người nhận để nơi gọi nói lại được「đã tới tay bao nhiêu」— một cái nút "đã gửi"
 * không kèm con số thì người phát không có cách nào biết mình vừa chọn nhầm một nhóm rỗng.
 *
 * Thứ tự CỐ Ý: ghi xuống database TRƯỚC, gõ cửa realtime SAU. Ngược lại thì tiếng gõ cửa có
 * thể tới trước lúc dòng kịp commit, và mọi trang sẽ hỏi "có gì mới không" đúng một nhịp
 * trước khi có gì để thấy — rồi im lặng cho tới lần tải trang sau.
 */
export async function broadcastNotice(
  input: NoticeInput,
  sentBy: string,
): Promise<{ id: string; recipients: number }> {
  const recipients = await countRecipients(input.audienceKind, input.audience);

  const [row] = await db()
    .insert(schema.notices)
    .values({
      body: input.body,
      audienceKind: input.audienceKind,
      audience: input.audienceKind === "all" ? [] : [...input.audience],
      sentBy,
    })
    .returning({ id: schema.notices.id });

  await pingNoticeChannel();
  return { id: row.id, recipients };
}

/**
 * Đánh dấu đã xem. Idempotent: hai tab cùng mở, bấm ở tab nào cũng được, và tab kia bấm lại
 * cũng không thành lỗi — `on conflict do nothing`.
 *
 * KHÔNG kiểm phạm vi ở đây: đánh dấu đã xem một lời nhắn không dành cho mình là vô hại (nó
 * vốn đã không hiện ra), còn thêm một phép kiểm nữa thì thêm một chỗ để sai. Điều PHẢI đúng
 * là dấu ấy gắn với `userId` của phiên đang đăng nhập — và đó là việc của nơi gọi.
 */
export async function markNoticeSeen(noticeId: string, userId: string): Promise<void> {
  await db()
    .insert(schema.noticeReads)
    .values({ noticeId, userId })
    .onConflictDoNothing({ target: [schema.noticeReads.noticeId, schema.noticeReads.userId] });
}

/** Lời nhắn gần đây, cho bảng điều khiển xem lại mình vừa phát gì. */
export async function recentNotices(limit = 5): Promise<
  Array<{ id: string; body: string; audienceKind: string; audience: string[]; createdAt: string; sender: string | null }>
> {
  const rows = await db().execute<{
    id: string;
    body: string;
    audience_kind: string;
    audience: string[];
    created_at: string;
    sender: string | null;
  }>(sql`
    select n.id, n.body, n.audience_kind, n.audience, n.created_at, u.display_name as sender
      from notices n
      left join users u on u.id = n.sent_by
     order by n.created_at desc
     limit ${limit}
  `);

  return rows.rows.map((row) => ({
    id: row.id,
    body: row.body,
    audienceKind: row.audience_kind,
    audience: Array.isArray(row.audience) ? row.audience : [],
    createdAt: new Date(row.created_at).toISOString(),
    sender: row.sender,
  }));
}
