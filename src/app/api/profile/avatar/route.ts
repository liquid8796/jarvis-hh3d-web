import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/guards";
import { deleteObject, mediaStoreReady, putAvatarFile, sniffImageKind } from "@/lib/services/media";
import { clearAvatar, setAvatar } from "@/lib/services/users";

/**
 * Ảnh đại diện của chính mình: POST đặt ảnh mới, DELETE bỏ ảnh.
 *
 * Là ROUTE chứ không phải server action, và đó không phải chuyện gu: server action có trần
 * body 1MB (`bodySizeLimit` mặc định của Next), còn một tấm ảnh — dù client đã thu nhỏ — thì
 * không có gì bảo đảm nằm dưới mức ấy. Route handler nhận multipart bình thường như
 * /api/chat/upload đã làm, nên bytes đi cùng một đường đã được chạy thật.
 *
 * MỌI đạo hữu đã đăng nhập đều vào được, kể cả người còn trong hàng chờ hay đang bị đình
 * quyền — cùng một luật với trang Hồ Sơ, nơi họ vẫn sửa được danh xưng và email. Ảnh đại diện
 * là danh tính, không phải một đặc quyền của thành viên đã duyệt. (Khác /api/chat/upload:
 * đính kèm đàm đạo đòi `active`, vì sảnh đàm đạo đòi `active`.)
 */
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Trần cho bytes ĐÃ tới server. Client thu ảnh về cạnh dài 512px trước khi gửi (xem
 * AvatarPicker), nên một tấm bình thường chỉ nặng vài chục KB — 2MB là chỗ rộng rãi cho ảnh
 * GIF động (thứ được gửi nguyên bản vì canvas sẽ giết mất phần động của nó) mà vẫn chặn được
 * người gửi tay một tấm 40MP qua curl.
 */
const MAX_BYTES = 2 * 1024 * 1024;

const STORE_CLOSED =
  "Tàng khố media chưa mở — tông chủ cần tạo kho OCI Object Storage trước khi đặt được ảnh.";

/**
 * Xoá ảnh cũ SAU khi bảng đã trỏ sang ảnh mới, và không để lệnh xoá ấy làm hỏng cả lượt đổi.
 *
 * Thứ tự này là chủ ý, cùng mạch lý lẽ với nút thanh tẩy sảnh: xoá bytes trước rồi ghi bảng
 * ngã ngựa ⇒ mọi nơi treo ảnh vỡ, ai cũng thấy; ghi bảng trước rồi xoá bytes trượt ⇒ một
 * object mồ côi nằm im, không ai thấy, và lần trục xuất sẽ dọn nốt vì `purgeUserAvatars` đi
 * theo tiền tố chứ không theo cột trong bảng. Chọn nửa nào hỏng thì đỡ đau hơn.
 */
async function forgetOldBytes(key: string | null): Promise<void> {
  if (!key) return;
  try {
    await deleteObject(key);
  } catch (err) {
    // Nói ra trong log server — người vận hành cần biết kho đang từ chối lệnh xoá — nhưng
    // KHÔNG dội lên mặt đạo hữu: với họ việc đổi ảnh đã xong và đúng.
    console.error(`Không xoá được ảnh đại diện cũ (${key}):`, err);
  }
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!mediaStoreReady()) {
    return NextResponse.json({ error: STORE_CLOSED }, { status: 503 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Thiếu ảnh." }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "Tệp rỗng — không có gì để đặt làm ảnh." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Ảnh không được quá ${MAX_BYTES / 1024 / 1024}MB.` },
      { status: 413 },
    );
  }

  // An toàn đọc hết vào bộ nhớ: `file.size` là số byte runtime ĐẾM ĐƯỢC khi bóc multipart, đã
  // bị trần ở trên chặn — không phải con số client tự khai.
  const body = new Uint8Array(await file.arrayBuffer());

  // Kiểu nội dung suy từ BYTES, không từ `file.type`. Xem `sniffImageKind` cho lý do đầy đủ:
  // bucket này công khai đọc, nên nhãn ta ghi lên object là nhãn cả thế giới nhận được.
  const kind = sniffImageKind(body);
  if (!kind) {
    return NextResponse.json(
      { error: "Chỉ nhận ảnh PNG, JPEG, WebP hoặc GIF." },
      { status: 415 },
    );
  }

  const stored = await putAvatarFile({ userId: user.id, kind, body });

  const swap = await setAvatar(user.id, stored);
  if (!swap.matched) {
    // Dòng users biến mất giữa lúc đang tải ảnh lên (bị trục xuất chẳng hạn). Ảnh vừa ghi
    // không còn ai trỏ tới, nên dọn ngay thay vì để nó nằm lại làm rác vĩnh viễn.
    await forgetOldBytes(stored.key);
    return NextResponse.json({ error: "Không tìm thấy đạo hữu này." }, { status: 404 });
  }

  await forgetOldBytes(swap.previousKey);

  revalidatePath("/profile");
  return NextResponse.json({ url: stored.url });
}

export async function DELETE() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const swap = await clearAvatar(user.id);
  if (!swap.matched) {
    return NextResponse.json({ error: "Không tìm thấy đạo hữu này." }, { status: 404 });
  }

  // KHÔNG hỏi `mediaStoreReady()` ở đây, dù nghe có lý. Hàm ấy NÉM khi bộ biến OCI đặt nửa vời
  // (chủ ý của services/media.ts), và ném ở chỗ này là biến một lượt bỏ ảnh ĐÃ THÀNH CÔNG
  // trong bảng thành một lỗi 500 trước mắt đạo hữu. `forgetOldBytes` tự nuốt và ghi log mọi
  // trục trặc của kho — kể cả "kho chưa khai mở" — nên để nó phân xử là đúng chỗ.
  await forgetOldBytes(swap.previousKey);

  revalidatePath("/profile");
  return NextResponse.json({ ok: true });
}
