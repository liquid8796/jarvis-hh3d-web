#!/usr/bin/env node
/**
 * Kiểm chứng luật PHẠM VI của thông báo tông môn — ai nhận được lời nhắn nào.
 *
 * Vì sao đáng một phép thử riêng: cái sai ở đây KHÔNG kêu. Một lời nhắn lọt sang người không
 * thuộc phạm vi thì chẳng ai báo lỗi — người phát tưởng mình vừa nhắn riêng cho ba trưởng lão,
 * còn cả tông môn thì vừa đọc được. Chiều ngược lại cũng im lặng y hệt: phạm vi khớp hụt thì
 * popup đơn giản là không hiện ra, và người ta chỉ biết vào ngày cần biết nhất.
 *
 * Phép thử chạy trên DATABASE THẬT (dự án này không có bản gương — xem
 * scripts/verifyChatPurge.mts cùng lẽ), nên nó tự dọn: mọi dòng nó tạo đều mang tiền tố nhận
 * ra được và bị xoá trong `finally`, kể cả khi một phép so ở giữa ném.
 *
 * Chạy: npm run verify:notices
 */
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db, schema } from "../src/lib/db/client";
import { loadEnv } from "./loadEnv.mjs";
import {
  broadcastNotice,
  countRecipients,
  guestNotices,
  markNoticeSeen,
  unseenNotices,
} from "../src/lib/services/notices";
import {
  addGuestSeen,
  parseGuestSeen,
  serializeGuestSeen,
  GUEST_SEEN_MAX,
} from "../src/lib/validation/guestSeen";

loadEnv();

/** Dấu nhận mặt của phép thử — mọi dòng mang tiền tố này đều là rác của chính nó. */
const TAG = "[verify:notices]";

let passed = 0;
const check = (name: string, condition: boolean, detail = "") => {
  if (!condition) throw new Error(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`✔ ${name}`);
  passed++;
};

async function main() {
  // Người thật, đọc từ database: phép thử này nói về QUAN HỆ giữa người và vai, nên nó phải
  // đứng trên dữ liệu thật chứ không phải trên một cặp id bịa ra.
  const actives = await db()
    .select({ id: schema.users.id, username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.status, "active"))
    .limit(3);
  check("có ít nhất 2 đạo hữu đang hoạt động để thử", actives.length >= 2, `thấy ${actives.length}`);

  const [alice, bob] = actives;
  const roleRows = await db()
    .select({ code: schema.userRoles.roleCode })
    .from(schema.userRoles)
    .where(eq(schema.userRoles.userId, alice.id));
  const aliceRoles = roleRows.map((r) => r.code);
  check(`đạo hữu thử nghiệm '${alice.username}' có vai để thử`, aliceRoles.length > 0, aliceRoles.join(","));

  // Vai mà alice KHÔNG mang — để thử chiều "không thuộc phạm vi thì không thấy".
  const allRoles = await db().select({ code: schema.roles.code }).from(schema.roles);
  const foreignRole = allRoles.map((r) => r.code).find((code) => !aliceRoles.includes(code));
  check("tìm được một vai mà đạo hữu ấy KHÔNG mang", Boolean(foreignRole), String(foreignRole));

  const beforeAlice = (await unseenNotices(alice.id)).length;
  const beforeBob = (await unseenNotices(bob.id)).length;

  // ---- 1. Phạm vi "đúng người này" -------------------------------------------------------
  const direct = await broadcastNotice(
    { body: `${TAG} gửi riêng`, audienceKind: "users", audience: [alice.id] },
    alice.id,
  );
  check("phát riêng: đếm đúng 1 người nhận", direct.recipients === 1, String(direct.recipients));

  let mine = await unseenNotices(alice.id);
  check("người trong phạm vi THẤY", mine.some((n) => n.id === direct.id));
  let theirs = await unseenNotices(bob.id);
  check("người ngoài phạm vi KHÔNG thấy", !theirs.some((n) => n.id === direct.id));

  // ---- 2. Dấu đã xem ---------------------------------------------------------------------
  await markNoticeSeen(direct.id, alice.id);
  mine = await unseenNotices(alice.id);
  check("bấm「Đã hiểu」rồi thì lời nhắn không hiện lại", !mine.some((n) => n.id === direct.id));
  await markNoticeSeen(direct.id, alice.id);
  check("đánh dấu lần hai không ném (idempotent)", true);

  // ---- 3. Phạm vi theo VAI ---------------------------------------------------------------
  const byRole = await broadcastNotice(
    { body: `${TAG} gửi theo vai`, audienceKind: "roles", audience: [aliceRoles[0]] },
    alice.id,
  );
  const expected = await countRecipients("roles", [aliceRoles[0]]);
  check("phát theo vai: số người nhận khớp phép đếm", byRole.recipients === expected, `${byRole.recipients} vs ${expected}`);
  mine = await unseenNotices(alice.id);
  check("người MANG vai ấy thấy", mine.some((n) => n.id === byRole.id));

  const byForeignRole = await broadcastNotice(
    { body: `${TAG} gửi vai khác`, audienceKind: "roles", audience: [String(foreignRole)] },
    alice.id,
  );
  mine = await unseenNotices(alice.id);
  check("vai mình KHÔNG mang thì không thấy", !mine.some((n) => n.id === byForeignRole.id));

  // ---- 4. Phạm vi cả tông môn ------------------------------------------------------------
  const toAll = await broadcastNotice({ body: `${TAG} gửi tất cả`, audienceKind: "all", audience: [] }, alice.id);
  const activeCount = await countRecipients("all", []);
  check("phát tất cả: đếm bằng số đạo hữu đang hoạt động", toAll.recipients === activeCount, `${toAll.recipients} vs ${activeCount}`);
  mine = await unseenNotices(alice.id);
  theirs = await unseenNotices(bob.id);
  check("cả hai người đều thấy lời nhắn chung", mine.some((n) => n.id === toAll.id) && theirs.some((n) => n.id === toAll.id));

  // ---- 5. Phạm vi rỗng và mã lạ ----------------------------------------------------------
  check("đếm người cho danh sách rỗng = 0", (await countRecipients("users", [])) === 0);
  check("đếm người cho id không đúng dạng uuid = 0 (không ném)", (await countRecipients("users", ["khong-phai-uuid"])) === 0);
  check(
    "đếm người cho uuid không tồn tại = 0",
    (await countRecipients("users", ["00000000-0000-4000-8000-000000000000"])) === 0,
  );

  // ---- 6. Không rò sang chuyện của người khác --------------------------------------------
  const aliceNow = await unseenNotices(alice.id);
  const bobNow = await unseenNotices(bob.id);
  check(
    "lời nhắn riêng của người này không lọt vào danh sách người kia",
    !bobNow.some((n) => n.body === `${TAG} gửi riêng`),
  );

  /**
   * Danh sách của bob phải khớp ĐÚNG những gì suy ra được từ dữ liệu, không phải một con số
   * đoán trước: bản đầu của phép thử này viết `beforeBob + 1` vì tưởng bob chỉ nhận lời nhắn
   * chung — nhưng bob CÓ THỂ mang cùng vai với alice, và khi ấy anh ta nhận hai. Phép thử sai
   * kiểu ấy còn tệ hơn không có: nó đỏ vì chính nó, và lần sau người ta sẽ nới nó ra cho xanh.
   */
  const bobRoleRows = await db()
    .select({ code: schema.userRoles.roleCode })
    .from(schema.userRoles)
    .where(eq(schema.userRoles.userId, bob.id));
  const bobHasRole = bobRoleRows.some((r) => r.code === aliceRoles[0]);
  const bobExpected = new Set([toAll.id, ...(bobHasRole ? [byRole.id] : [])]);
  const bobGotOurs = bobNow.filter((n) => n.body.startsWith(TAG)).map((n) => n.id);
  check(
    "bob nhận ĐÚNG những lời nhắn phạm vi của anh ta khớp",
    bobGotOurs.length === bobExpected.size && bobGotOurs.every((id) => bobExpected.has(id)),
    `nhận ${bobGotOurs.length}, chờ ${bobExpected.size} (cùng vai: ${bobHasRole})`,
  );

  const aliceExpected = new Set([byRole.id, toAll.id]);
  const aliceGotOurs = aliceNow.filter((n) => n.body.startsWith(TAG)).map((n) => n.id);
  check(
    "alice nhận đúng hai lời nhắn còn lại (đã xem thì thôi, vai lạ thì không)",
    aliceGotOurs.length === aliceExpected.size && aliceGotOurs.every((id) => aliceExpected.has(id)),
    `nhận ${aliceGotOurs.length}, chờ ${aliceExpected.size}`,
  );
  check(
    "và trước lượt thử, cả hai không có lời nhắn nào của phép thử này",
    beforeAlice === aliceNow.length - aliceExpected.size && beforeBob === bobNow.length - bobExpected.size,
    `alice ${beforeAlice}→${aliceNow.length}, bob ${beforeBob}→${bobNow.length}`,
  );

  // ---- 7. Phạm vi KHÁCH CHƯA ĐĂNG NHẬP ----------------------------------------------------
  //
  // Hai chiều rò rỉ, và cả hai đều im lặng khi hỏng: lời nhắn cho khách lọt vào popup của thành
  // viên, hoặc lời nhắn nội bộ của tông môn lọt ra cho người lạ đọc. Chiều sau mới là chiều
  // đắt — nó là một lượt rò rỉ ra ngoài Internet, không phải một cái popup thừa.
  const toGuests = await broadcastNotice(
    { body: `${TAG} gửi khách`, audienceKind: "guests", audience: [] },
    alice.id,
  );

  check(
    "đếm người cho phạm vi khách trả null, KHÔNG phải 0",
    toGuests.recipients === null && (await countRecipients("guests", [])) === null,
    `nhận ${JSON.stringify(toGuests.recipients)}`,
  );

  const forGuests = await guestNotices();
  check("khách thấy lời nhắn dành cho khách", forGuests.some((n) => n.id === toGuests.id));

  // Chiều 1: thành viên KHÔNG thấy lời nhắn của khách.
  const aliceAfterGuest = await unseenNotices(alice.id);
  const bobAfterGuest = await unseenNotices(bob.id);
  check(
    "lời nhắn cho khách KHÔNG lọt vào popup của thành viên",
    !aliceAfterGuest.some((n) => n.id === toGuests.id) && !bobAfterGuest.some((n) => n.id === toGuests.id),
  );

  // Chiều 2: người lạ KHÔNG đọc được lời nhắn nội bộ — kể cả cái gửi「cả tông môn」.
  check(
    "khách KHÔNG đọc được lời nhắn của tông môn (kể cả phạm vi「cả tông môn」)",
    !forGuests.some((n) => n.id === toAll.id) &&
      !forGuests.some((n) => n.id === byRole.id) &&
      !forGuests.some((n) => n.id === direct.id),
  );

  // ---- 8. Dấu「đã xem」của khách: thuần, và là thứ thay cho notice_reads -------------------
  {
    const A = "11111111-1111-4111-8111-111111111111";
    const B = "22222222-2222-4222-8222-222222222222";

    check("cookie rỗng → chưa xem gì", parseGuestSeen("").length === 0 && parseGuestSeen(undefined).length === 0);
    check("đọc lại đúng thứ đã ghi", parseGuestSeen(serializeGuestSeen([A, B])).join(",") === `${A},${B}`);
    check("mới nhất đứng đầu", addGuestSeen([A], B).join(",") === `${B},${A}`);
    check("bấm lại cùng một lời nhắn không đẻ thêm dòng", addGuestSeen([A], A).length === 1);

    // Cookie là thứ ngoài Internet gõ vào được, và mấy id này đi thẳng vào một cột uuid.
    check("chuỗi rác trong cookie bị vứt, không ném", parseGuestSeen("khong-phai-uuid,,;drop table").length === 0);
    check("id rác không vào được danh sách", addGuestSeen([A], "'; drop table notices; --").join(",") === A);

    const qua = Array.from({ length: GUEST_SEEN_MAX + 5 }, (_, i) =>
      `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
    );
    check("danh sách bị cắt về đúng trần", parseGuestSeen(qua.join(",")).length === GUEST_SEEN_MAX);
    check(
      "và phép thêm cũng cắt, giữ cái mới nhất",
      addGuestSeen(qua, B).length === GUEST_SEEN_MAX && addGuestSeen(qua, B)[0] === B,
    );
  }
}

async function cleanup() {
  const rows = await db()
    .select({ id: schema.notices.id })
    .from(schema.notices)
    .where(like(schema.notices.body, `${TAG}%`));
  if (rows.length === 0) return;
  const ids = rows.map((r) => r.id);
  // Dấu đã xem đi theo `on delete cascade`, nhưng xoá tay cho chắc: một ngày nào đó ai đó gỡ
  // ràng buộc ấy thì phép dọn này vẫn phải sạch.
  await db().delete(schema.noticeReads).where(inArray(schema.noticeReads.noticeId, ids));
  await db().delete(schema.notices).where(inArray(schema.notices.id, ids));
  console.log(`• Đã dọn ${ids.length} lời nhắn thử.`);
}

try {
  await main();
  console.log(`\n${passed} phép thử qua.`);
} finally {
  await cleanup();
}
