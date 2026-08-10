import { neon } from "@neondatabase/serverless";
import type { AppSettings } from "@/lib/services/settings";

/**
 * Dọn trạm SẮP LÊN THAY — một luật, dùng chung cho cả hai đường lật.
 *
 * Có ĐÚNG hai đường lật bảng điều phối, và chúng phải để lại trạm đích ở cùng một trạng thái:
 *   • `flipSwitchAction` — nút「Lật sang trạm mới」trên trang admin, đường thường ngày;
 *   • `mirror:control set` — dòng lệnh, ĐƯỜNG THOÁT HIỂM khi trạm chính chết hẳn và không còn
 *     trang admin nào để bấm.
 *
 * Trước 10/08/2026 chỉ đường thứ nhất dọn, và đó là một cái bẫy đặt đúng vào lúc tệ nhất:
 * `set` chỉ ghi bảng, nên trạm được cất nhắc bằng dòng lệnh sẽ lên ngôi mang theo nguyên trạng
 * thái bế quan của lượt chuyển trước — không phục vụ ai, giữa lúc trạm chính vừa chết.
 *
 * Hai thứ phải đặt lại, vì cả hai đều đi theo dữ liệu được chép sang:
 *   • `maintenance` — tắt, nếu không trạm mới lên ngôi trong bảng bế quan;
 *   • `mirrorSwitch` — về `idle`, nếu không trạm mới không mở nổi lượt chuyển kế
 *     (`beginSwitchAction` chỉ nhận `idle`/`failed`) và nút「Lật」lại hiện ra trỏ vào chính nó.
 */

type Sql = ReturnType<typeof neon>;

/**
 * Phần THUẦN — hình thù hai khoá sẽ ghi đè. Tách ra để `verify:mirror-sync` kiểm được rằng nó
 * vẫn khớp schema Zod của `app_settings`: một trường bị đổi tên ở settings.ts mà quên nơi này
 * thì trạm mới lên ngôi với bản ghi hỏng, và `.catch()` của Zod sẽ nuốt nó thành mặc định —
 * hỏng lặng lẽ, đúng loại đã trả giá cả ngày hôm nay.
 */
export function promotedStationPatch(
  fromSiteId: string,
  at: Date = new Date(),
): { maintenance: AppSettings["maintenance"]; mirrorSwitch: AppSettings["mirrorSwitch"] } {
  const stamp = at.toISOString();
  return {
    maintenance: { active: false, startedAt: null, expectedEndAt: null, note: "" },
    mirrorSwitch: {
      phase: "idle",
      targetId: "",
      startedAt: null,
      updatedAt: stamp,
      note: `Trạm này vừa được cất nhắc từ「${fromSiteId}」lúc ${stamp}. Sẵn sàng cho lượt chuyển kế.`,
      tableIndex: 0,
      rowOffset: 0,
      copiedRows: 0,
    },
  };
}

/**
 * Ghi hai khoá ấy vào `app_settings` của trạm đích.
 *
 * MỘT câu lệnh, hai `jsonb_set` lồng nhau: trạm mới không được phép tồn tại trong khoảnh khắc
 * đã tắt bế quan mà mirrorSwitch còn dở, hay ngược lại.
 */
export async function resetPromotedStation(dest: Sql, fromSiteId: string, at: Date = new Date()): Promise<void> {
  const patch = promotedStationPatch(fromSiteId, at);
  await dest.query(
    `update app_settings
        set value = jsonb_set(jsonb_set(value, '{maintenance}', $1::jsonb, true), '{mirrorSwitch}', $2::jsonb, true)`,
    [JSON.stringify(patch.maintenance), JSON.stringify(patch.mirrorSwitch)],
  );
}
