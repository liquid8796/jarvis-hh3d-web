import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/guards";
import { isAdminUser } from "@/lib/auth/permissions";
import {
  BACKDROP_PREFIX,
  deleteObject,
  mediaStoreReady,
  publicUrlOf,
  putBackdropFile,
  sniffImageKind,
  statObject,
} from "@/lib/services/media";
import { getAppSettings, saveAppSettings } from "@/lib/services/settings";
import { BACKDROP_PAGES, DEFAULT_SLOT, isBackdropPageKey } from "@/lib/validation/backdrops";

/**
 * Kho ẢNH NỀN: POST thêm một tấm (multipart — ảnh nền là thứ nặng nhất trong cả hệ thống,
 * vượt xa trần 1MB của server action, cùng lý do /api/admin/tag-frames là route), DELETE gỡ
 * một tấm khỏi kho theo key.
 *
 * KHÔNG có GET, cùng lẽ với sổ khung tag: lưới ảnh đi tới giao diện bằng prop từ
 * `admin/page.tsx` (trang ấy liệt kê kho sẵn), nên một endpoint đọc là một đường thứ hai tới
 * cùng dữ liệu — thứ chỉ chờ ngày trả lời lệch với trang.
 *
 * Guard theo BẬC TRỊ SỰ chứ không riêng Gia chủ: người đổi được tên miền và hạn lưu đàm đạo
 * thì cũng được đổi tấm nền — cùng một tầm với, và không có gì phá được ở đây mà một lượt
 * tải lên khác không sửa lại được.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Tấm nền gốc nặng ~2MB (PNG 1672×941). 8MB là chỗ thở cho một tấm 4K hoặc một tấm PNG chưa
 * nén kỹ, mà vẫn chặn người dán nhầm một tệp RAW từ máy ảnh.
 *
 * Đây KHÔNG phải trần của Vercel — hàm nhận được tới 100MB — mà là trần của lẽ phải: mỗi
 * người xem trang sẽ tải tấm này về, nên một tấm 30MB là một quyết định làm hỏng trang cho
 * tất cả mọi người, do đúng một người bấm nhầm.
 */
const MAX_BYTES = 8 * 1024 * 1024;

/** Tên gợi nhớ đi vào key của object, để người vào console OCI còn phân biệt được tấm nào. */
const MAX_NAME_LENGTH = 48;

const STORE_CLOSED =
  "Tàng khố media chưa mở — tông chủ cần tạo kho OCI Object Storage trước khi thêm ảnh nền.";

/** 401 khi chưa đăng nhập, 403 khi thiếu vai — hai lời từ chối khác nhau cho hai chuyện khác nhau. */
async function requireAdminApi() {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (!isAdminUser(user)) {
    return { error: NextResponse.json({ error: "Việc của bậc trị sự." }, { status: 403 }) };
  }
  return { user };
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
    return NextResponse.json({ error: "Thiếu tệp ảnh nền." }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "Tệp rỗng — không có gì để làm nền." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `Ảnh nền không được quá ${MAX_BYTES / 1024 / 1024}MB.` }, { status: 413 });
  }

  const body = new Uint8Array(await file.arrayBuffer());
  // Soi BYTES, không tin nhãn client khai — cùng lý do đã ghi tại sniffImageKind: URL công
  // khai trên tên miền của kho, nên thứ ta lưu phải đúng là ảnh.
  const kind = sniffImageKind(body);
  if (!kind) {
    return NextResponse.json({ error: "Tệp không phải PNG/JPEG/WebP/GIF — nền phải là ảnh." }, { status: 415 });
  }

  /**
   * Tên gợi nhớ: lấy từ ô nhập nếu có, không thì từ tên tệp. Nó CHỈ đi vào key của object để
   * người còn phân biệt được tấm nào với tấm nào — `backdropObjectKey` rửa lại nó lần nữa, và
   * chuỗi rỗng sau khi rửa vẫn ra một key hợp lệ. Nên chỗ này không cần từ chối ai cả.
   */
  const rawName = String(form?.get("name") ?? "").trim() || file.name;
  const name = rawName.slice(0, MAX_NAME_LENGTH);

  const stored = await putBackdropFile({ name, kind, body });

  // Trang Tông Môn vẽ lưới ảnh từ phép liệt kê kho, nên nó phải dựng lại để thấy tấm mới.
  revalidatePath("/admin");
  return NextResponse.json({ ok: true, image: { key: stored.key, url: stored.url } });
}

/**
 * Gán một tấm nền cho MỘT ô: `slot` là `"default"` hoặc mã trang; `key` là object trong kho,
 * hoặc `null` để trả ô ấy về mặc định.
 *
 * Từng ô một chứ không gửi cả bảng: hai trưởng môn cùng mở tab Giao Diện thì một phép ghi
 * trọn bảng sẽ nuốt mất thay đổi của người kia mà không ai biết. Một ô một lần thì họ chỉ va
 * nhau khi cùng sửa ĐÚNG một trang.
 *
 * Client gửi KEY, server tự dựng URL. Đây là chỗ đáng giá nhất của cửa này: URL rồi sẽ được
 * rót thẳng vào một thẻ `<style>`, nên nếu nhận URL từ client thì `safeBackdropUrl` là hàng
 * rào DUY NHẤT. Nhận key rồi tự dựng thì URL luôn là URL của chính kho, và phép làm sạch kia
 * thành lớp thứ hai chứ không phải lớp duy nhất.
 */
export async function PUT(request: Request) {
  const guard = await requireAdminApi();
  if (guard.error) return guard.error;

  const payload = await request.json().catch(() => null);
  const slot = String(payload?.slot ?? "");
  if (slot !== DEFAULT_SLOT && !isBackdropPageKey(slot)) {
    return NextResponse.json({ error: "Không có ô nền nào tên như vậy." }, { status: 400 });
  }

  const rawKey = payload?.key;
  if (rawKey !== null && typeof rawKey !== "string") {
    return NextResponse.json({ error: "Thiếu định danh ảnh." }, { status: 400 });
  }

  const settings = await getAppSettings();

  if (rawKey === null) {
    // Trả ô về mặc định. Ô mặc định thì "về mặc định" nghĩa là về tấm cứu hộ trong repo.
    if (slot === DEFAULT_SLOT) {
      settings.appearance.defaultBackdrop = null;
    } else {
      delete settings.appearance.pageBackdrops[slot];
    }
    await saveAppSettings(settings);
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true, image: null });
  }

  if (!rawKey.startsWith(`${BACKDROP_PREFIX}/`)) {
    return NextResponse.json({ error: "Key không thuộc kho ảnh nền." }, { status: 400 });
  }
  if (!mediaStoreReady()) {
    return NextResponse.json({ error: STORE_CLOSED }, { status: 503 });
  }
  // Ảnh phải CÒN trong kho. Không kiểm thì một tấm vừa bị xoá ở tab khác sẽ được gán vào
  // trang, và trang ấy treo một URL chết — thứ chỉ lộ ra khi có người mở trang.
  const found = await statObject(rawKey);
  if (!found) {
    return NextResponse.json({ error: "Ảnh này không còn trong tàng khố — tải lại trang xem lưới mới." }, { status: 404 });
  }

  const image = { key: rawKey, url: publicUrlOf(rawKey) };
  if (slot === DEFAULT_SLOT) {
    settings.appearance.defaultBackdrop = image;
  } else {
    settings.appearance.pageBackdrops[slot] = image;
  }
  await saveAppSettings(settings);

  /**
   * `revalidatePath("/", "layout")` chứ không phải `revalidatePath("/admin")`: tấm nền được
   * dựng ở LAYOUT GỐC, nên mọi trang đang nằm trong cache đều mang luật CSS cũ. Dọn đúng
   * trang admin là đổi nền ở mỗi trang trừ chính trang vừa được đổi nền.
   */
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, image });
}

export async function DELETE(request: Request) {
  const guard = await requireAdminApi();
  if (guard.error) return guard.error;

  const payload = await request.json().catch(() => null);
  const key = String(payload?.key ?? "");
  if (!key) {
    return NextResponse.json({ error: "Thiếu định danh ảnh." }, { status: 400 });
  }
  /**
   * Key phải nằm dưới ĐÚNG tiền tố của ảnh nền. Không có dòng này thì đây là một cửa xoá
   * object BẤT KỲ trong bucket, mở cho mọi bậc trị sự — ảnh đại diện của người khác, khung
   * tag, file đính kèm đàm đạo. Client gửi gì cũng được, nên chỗ chặn phải ở đây.
   */
  if (!key.startsWith(`${BACKDROP_PREFIX}/`)) {
    return NextResponse.json({ error: "Key không thuộc kho ảnh nền." }, { status: 400 });
  }

  /**
   * ĐANG DÙNG thì không xoá. Xoá một tấm đang treo trên một trang sẽ để lại một URL chết
   * trong app_settings, và trang ấy rơi xuống nền mặc định mà không ai hiểu vì sao — một
   * lời từ chối kèm tên trang thì sửa được ngay.
   */
  const settings = await getAppSettings();
  const usedBy: string[] = [];
  if (settings.appearance.defaultBackdrop?.key === key) {
    usedBy.push("Nền mặc định");
  }
  for (const page of BACKDROP_PAGES) {
    if (settings.appearance.pageBackdrops[page.key]?.key === key) {
      usedBy.push(page.label);
    }
  }
  if (usedBy.length > 0) {
    return NextResponse.json(
      { error: `Ảnh này đang được dùng cho ${usedBy.join(", ")} — đổi nền của những chỗ ấy trước đã.` },
      { status: 409 },
    );
  }

  try {
    await deleteObject(key);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Không xoá được ảnh khỏi tàng khố: ${reason}` }, { status: 502 });
  }

  revalidatePath("/admin");
  return NextResponse.json({ ok: true });
}
