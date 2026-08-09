import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/guards";
import { isAdminUser } from "@/lib/auth/permissions";
import { deleteObject, mediaStoreReady, putTagFrameFile, sniffImageKind } from "@/lib/services/media";
import { getAppSettings, saveAppSettings } from "@/lib/services/settings";
import { MAX_TAG_LENGTH, frameByLabel, normalizeTagLabel } from "@/lib/validation/tags";

/**
 * Sổ khung tag: POST thêm một khung (multipart — bài vị nặng vài MB, vượt xa trần 1MB của
 * server action, cùng lý do /api/profile/avatar là route), DELETE gỡ một khung theo id.
 *
 * Guard theo BẬC TRỊ SỰ chứ không riêng Gia chủ: người đặt được tag cho môn đồ (adminUpdate)
 * thì cũng được quản kho khung mà tag ấy đeo — hai việc cùng một tầm với.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Bộ khung gốc nặng ~2.8MB mỗi tấm (webp động 919×300) — 4MB là chỗ thở cho khung sau này
 * cùng cỡ, mà vẫn chặn người dán nhầm một tấm ảnh chụp màn hình 4K.
 */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Trần SỐ khung trong sổ. Sổ sống trong app_settings — một document JSONB đọc ở mỗi lượt vẽ
 * trang chat — nên nó không được phép phình vô hạn; và một sảnh có nổi hai chục kiểu bài vị
 * thì vấn đề nằm ở chỗ khác rồi.
 */
const MAX_FRAMES = 24;

const STORE_CLOSED =
  "Tàng khố media chưa mở — tông chủ cần tạo kho OCI Object Storage trước khi thêm khung.";

/** 401 khi chưa đăng nhập, 403 khi thiếu vai — hai lời từ chối khác nhau cho hai chuyện khác nhau. */
async function requireAdminApi() {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (!isAdminUser(user)) {
    return { error: NextResponse.json({ error: "Việc của bậc trị sự." }, { status: 403 }) };
  }
  return { user };
}

/**
 * Sổ khung cho trang Tông Môn. Tồn tại để thẻ quản khung TỰ nuôi dữ liệu của nó — trang
 * admin (server component) đang là chỗ nhiều phiên cùng sửa, một thẻ client tự lo lấy sổ
 * thì không phải chen thêm prop nào vào đó.
 */
export async function GET() {
  const guard = await requireAdminApi();
  if (guard.error) return guard.error;

  const settings = await getAppSettings();
  return NextResponse.json({ frames: settings.chat.tagFrames });
}

export async function POST(request: Request) {
  const guard = await requireAdminApi();
  if (guard.error) return guard.error;

  if (!mediaStoreReady()) {
    return NextResponse.json({ error: STORE_CLOSED }, { status: 503 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Thiếu tệp khung." }, { status: 400 });
  }

  // Nhãn đi qua ĐÚNG luật của một tag đơn — nhãn chính là chuỗi tag mà khung đại diện.
  const label = String(form?.get("label") ?? "").trim().replace(/\s+/g, " ");
  if (!label) {
    return NextResponse.json({ error: "Khung phải mang một nhãn — đó chính là tag nó đại diện." }, { status: 400 });
  }
  if (label.length > MAX_TAG_LENGTH) {
    return NextResponse.json({ error: `Nhãn tối đa ${MAX_TAG_LENGTH} ký tự.` }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "Tệp rỗng — không có gì để làm khung." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `Khung không được quá ${MAX_BYTES / 1024 / 1024}MB.` }, { status: 413 });
  }

  const body = new Uint8Array(await file.arrayBuffer());
  // Soi BYTES, không tin nhãn client khai — cùng lý do đã ghi tại sniffImageKind: URL công
  // khai trên tên miền của kho, nên thứ ta lưu phải đúng là ảnh.
  const kind = sniffImageKind(body);
  if (!kind) {
    return NextResponse.json({ error: "Tệp không phải PNG/JPEG/WebP/GIF — khung phải là ảnh." }, { status: 415 });
  }

  const settings = await getAppSettings();
  const frames = settings.chat.tagFrames;

  if (frames.length >= MAX_FRAMES) {
    return NextResponse.json({ error: `Sổ khung đã đủ ${MAX_FRAMES} — gỡ bớt trước khi thêm.` }, { status: 409 });
  }
  // Một nhãn một khung: cho hai khung cùng nhãn thì phép so khớp phải chọn hộ, và nó sẽ chọn
  // sai với một nửa số người nhìn. Muốn thay khung là gỡ khung cũ trước — một bước, nhưng rõ.
  if (frameByLabel(label, frames)) {
    return NextResponse.json({ error: `Nhãn「${label}」đã có khung — gỡ khung cũ trước nếu muốn thay.` }, { status: 409 });
  }

  const stored = await putTagFrameFile({ label, kind, body });

  // Cờ mặc định là ĐƠN NHẤT: đặt khung này làm mặc định thì khung đang giữ cờ phải buông —
  // hai khung "mặc định" là phép so khớp lại phải chọn hộ lần nữa.
  const isDefault = form?.get("isDefault") !== null;
  settings.chat.tagFrames = [
    ...(isDefault ? frames.map((frame) => ({ ...frame, isDefault: false })) : frames),
    { id: crypto.randomUUID(), label, url: stored.url, key: stored.key, isDefault },
  ];
  await saveAppSettings(settings);

  revalidatePath("/admin");
  revalidatePath("/chat");
  return NextResponse.json({ ok: true, frame: settings.chat.tagFrames.at(-1) });
}

export async function DELETE(request: Request) {
  const guard = await requireAdminApi();
  if (guard.error) return guard.error;

  const payload = await request.json().catch(() => null);
  const id = String(payload?.id ?? "");
  if (!id) {
    return NextResponse.json({ error: "Thiếu định danh khung." }, { status: 400 });
  }

  const settings = await getAppSettings();
  const target = settings.chat.tagFrames.find((frame) => frame.id === id);
  if (!target) {
    return NextResponse.json({ error: "Không tìm thấy khung này — có thể ai đó vừa gỡ rồi." }, { status: 404 });
  }

  // Sổ trước, bytes sau — cùng thứ tự với đổi ảnh đại diện và cùng lý do: sổ đã buông thì một
  // lệnh xoá bytes trượt chỉ để lại object mồ côi không ai trỏ tới, thay vì một khung trong
  // sổ trỏ vào bytes đã chết và vẽ ô vỡ cạnh tên người ta.
  settings.chat.tagFrames = settings.chat.tagFrames.filter((frame) => frame.id !== id);
  await saveAppSettings(settings);

  try {
    await deleteObject(target.key);
  } catch (err) {
    console.error(`Không xoá được bytes của khung「${target.label}」(${target.key}):`, err);
  }

  revalidatePath("/admin");
  revalidatePath("/chat");
  return NextResponse.json({ ok: true });
}
