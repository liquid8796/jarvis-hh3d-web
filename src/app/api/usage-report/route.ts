import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeCronRequest } from "@/lib/auth/cronSecret";
import { getAppSettings, saveAppSettings } from "@/lib/services/settings";

/**
 * CỬA NHẬN BẢNG USAGE do bên ngoài đẩy lên — nửa còn lại của `npm run usage:full -- --push`.
 *
 * VÌ SAO PHẢI ĐẨY VÀO chứ không để web tự đi lấy: bảng đầy đủ (gồm Fluid Active CPU và Fluid
 * Provisioned Memory, hai meter siết nhất một tài khoản Hobby) chỉ đọc được bằng cách dựng
 * trang Usage trong một trình duyệt THẬT rồi cuộn cho nó render — đo ngày 11/08/2026: `fetch`
 * thuần chỉ đúng 1/8 lượt và thiếu đúng mấy cột ấy. Function trên Vercel không mở nổi Chromium
 * và không sống nổi 90 giây, nên chỗ có Chromium (GitHub Actions theo lịch) cào rồi gõ cửa đây.
 *
 * KHÔNG CREDENTIAL NÀO ĐI QUA CỬA NÀY. Cookie phiên Vercel ở lại trong secret của GitHub; thứ
 * đi trên dây chỉ là tên meter và hai con số đã format. Đó là toàn bộ lý do thiết kế đảo chiều.
 *
 * Gác bằng `CRON_SECRET` y như `/api/cron` — cùng bí mật, cùng phép so không rò thời gian, cùng
 * luật FAIL CLOSED khi chưa đặt biến. Thà bảng usage không cập nhật còn hơn để ngỏ một cửa ghi
 * vào `app_settings` cho cả Internet.
 */

const bodySchema = z.object({
  /** Trùng `id` trong sổ gương trạm (cũng là SITE_ID của deploy bên kia). */
  siteId: z.string().min(1).max(64),
  readAt: z.string().datetime(),
  meters: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(80),
        used: z.string().trim().max(40),
        limit: z.string().trim().max(40).nullable().default(null),
      }),
    )
    // Trần 200: bảng thật có ~60 dòng. Đây là dữ liệu do một tiến trình NGOÀI đẩy vào một
    // document JSONB — không có trần thì một lần gõ nhầm là `app_settings` phình vô hạn.
    .min(1)
    .max(200),
});

export async function POST(request: Request) {
  if (!authorizeCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }
  const { siteId, readAt, meters } = parsed.data;

  const settings = await getAppSettings();
  const entry = settings.mirrors.find((mirror) => mirror.id === siteId);
  if (!entry) {
    // Nói rõ tên trạm: lỗi thường gặp nhất của lượt dựng workflow là gõ lệch `siteId` với mã
    // trạm trong sổ, và một câu 404 trần trụi thì không chỉ ra điều đó.
    return NextResponse.json(
      { error: `Không có trạm「${siteId}」trong sổ gương trạm.` },
      { status: 404 },
    );
  }

  entry.usageReport = { readAt, meters };
  await saveAppSettings(settings);

  return NextResponse.json({ ok: true, siteId, meters: meters.length });
}
