"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { isAnimatedImage } from "@/lib/media/animatedImage";

/**
 * Đổi ảnh đại diện — chọn tệp, thu nhỏ NGAY TRÊN MÁY, rồi gửi lên /api/profile/avatar.
 *
 * Vì sao thu nhỏ ở client mà không để server làm: một tấm ảnh từ điện thoại nặng 3–8MB và
 * rộng 4000px, trong khi vòng tròn nó sẽ nằm trong rộng 34px. Gửi nguyên bản lên rồi thu ở
 * server nghĩa là trả tiền đường truyền cho 8MB, trả tiền lưu trữ cho phần không ai thấy, và
 * nhét một thư viện xử lý ảnh vào function — trong khi `canvas` đã có sẵn trong mọi trình
 * duyệt và làm đúng việc ấy trước khi byte đầu tiên rời khỏi máy.
 *
 * Server vẫn KHÔNG tin gì ở đây cả: nó soi lại bytes và chặn lại theo trần của nó. Phần thu
 * nhỏ này là để đường truyền nhẹ và ảnh đẹp, không phải một lớp bảo vệ.
 */

/** Cạnh dài nhất sau khi thu. 512 đủ cho màn Retina vẽ vòng tròn 96px của trang này gấp đôi. */
const MAX_EDGE = 512;

/** Trần của server. Nhắc lại ở đây để lời báo lỗi nói được con số trước khi phải đi một vòng mạng. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/**
 * Trần cho tệp GỐC, trước khi thu. Không phải luật của server — chỉ là lằn ranh của sự tỉnh
 * táo: giải mã một tệp 80MB trong tab của người ta là cách làm treo máy họ, và không tấm ảnh
 * đại diện nào cần tới thế.
 */
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

/**
 * Bộ lọc của hộp chọn tệp.
 *
 * `image/apng` và `.apng` có mặt vì APNG: trình duyệt tra bộ lọc theo ĐUÔI tệp, và một tệp tên
 * `mat-cua-toi.apng` được tra ra `image/apng` — không có mục ấy thì nó bị làm mờ ngay trong hộp
 * chọn, tức tính năng ảnh động APNG chết ngay ở bước đầu tiên mà không có lời báo nào. Bytes bên
 * trong vẫn là PNG hợp lệ nên server soi ra `image/png` như thường.
 *
 * Bộ lọc này chỉ là tiện cho người chọn, KHÔNG phải hàng rào: ai cũng đổi được sang "All files".
 * Luật thật nằm ở phép soi bytes phía server.
 */
const ACCEPT = "image/png,image/apng,image/jpeg,image/webp,image/gif,.apng";

/**
 * Tên gửi kèm trong multipart. CỐ Ý là một hằng số, không phải tên tệp gốc và cũng không mang
 * đuôi: route ảnh đại diện không đọc `file.name` một lần nào — nó suy đuôi thật từ bytes rồi tự
 * đặt tên object (xem `avatarObjectKey`). Một cái tên "đúng đuôi" ở đây chỉ tạo ảo giác rằng nó
 * quyết định điều gì.
 */
const UPLOAD_FILENAME = "avatar";

/** Chất lượng WebP. 0.9 gần như không phân biệt được bằng mắt ở cỡ này, mà nhẹ hơn PNG nhiều lần. */
const WEBP_QUALITY = 0.9;

const fmtMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)}MB`;

/** Hứa hẹn hoá `toBlob`, và coi `null` là một thất bại có tên chứ không phải một blob rỗng. */
function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Thu ảnh về một hình VUÔNG cạnh tối đa `MAX_EDGE`, cắt giữa.
 *
 * Cắt vuông vì mọi chỗ hiển thị đều là vòng tròn với `object-fit: cover` — tức trình duyệt sẽ
 * cắt giữa đúng như thế lúc vẽ. Cắt sẵn thì phần bị cắt không phải nằm trong kho trả tiền lưu
 * trữ cho một vùng ảnh không ai từng thấy.
 *
 * WebP trước, PNG dự bị: cả hai giữ được phần trong suốt (ảnh đại diện nền trong suốt là
 * chuyện thường), còn JPEG thì biến nó thành một vùng đen.
 */
async function shrink(file: File): Promise<{ blob: Blob; type: string }> {
  // `from-image` để ảnh dựng đứng từ điện thoại không bị quay ngang: máy ảnh ghi hướng vào
  // EXIF chứ không quay pixel, và mặc định của createImageBitmap là bỏ qua thẻ ấy.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

  try {
    const edge = Math.min(bitmap.width, bitmap.height, MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = edge;
    canvas.height = edge;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Trình duyệt không cho vẽ canvas 2d.");

    // Vùng vuông lớn nhất ở GIỮA ảnh gốc, rồi kéo về đúng ô vuông đích.
    const side = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      edge,
      edge,
    );

    const webp = await encode(canvas, "image/webp", WEBP_QUALITY);
    // Trình duyệt không mã hoá được WebP thì `toBlob` trả về null HOẶC trả về một blob mang
    // kiểu khác (hành vi cũ của Safari) — cả hai đều là "không có WebP", nên kiểm cả hai.
    if (webp && webp.type === "image/webp") return { blob: webp, type: webp.type };

    const png = await encode(canvas, "image/png");
    if (png) return { blob: png, type: "image/png" };

    throw new Error("Trình duyệt không mã hoá được ảnh đã thu nhỏ.");
  } finally {
    bitmap.close();
  }
}

export function AvatarPicker({ name, url }: { name: string; url: string | null }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"" | "upload" | "remove">("");
  const [error, setError] = useState("");
  /**
   * Ảnh vừa đặt/vừa bỏ, đè lên prop cho tới lượt vẽ lại kế tiếp. `null` ở NGOÀI nghĩa là
   * "chưa có gì để đè, cứ theo prop"; `{ url: null }` nghĩa là "vừa bỏ ảnh, đừng vẽ gì".
   * Cần cả hai vì `router.refresh()` không trả về lời hứa nào để đợi — không có bản đè này
   * thì vòng tròn đứng im mấy trăm mili-giây sau khi người ta bấm xong.
   */
  const [override, setOverride] = useState<{ url: string | null } | null>(null);
  const shown = override ? override.url : url;

  /** Lời báo lỗi của server nếu có, không thì một câu nói rõ mã HTTP để còn lần ra được. */
  const failureOf = async (res: Response): Promise<string> => {
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    if (typeof data?.error === "string" && data.error.trim()) return data.error;
    return `Không đặt được ảnh (HTTP ${res.status}).`;
  };

  const pick = async (file: File) => {
    setError("");

    if (file.size > MAX_SOURCE_BYTES) {
      setError(`Tệp quá lớn (${fmtMb(file.size)}) — hãy chọn ảnh dưới ${fmtMb(MAX_SOURCE_BYTES)}.`);
      return;
    }

    setBusy("upload");
    try {
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch {
        setError("Không đọc được tệp này — có thể nó vừa bị di chuyển hoặc đổi tên.");
        return;
      }

      let upload: Blob = file;

      if (isAnimatedImage(bytes)) {
        /**
         * Ảnh ĐỘNG đi NGUYÊN BẢN — GIF, WebP động và APNG như nhau. Canvas chỉ vẽ được khung
         * đầu, nên thu nhỏ một tệp nhiều khung là lặng lẽ giết phần động của nó.
         *
         * Xét theo BYTES chứ không theo `file.type`, và đó là điểm chính: một tấm WebP tĩnh và
         * một tấm WebP động mang đúng cùng một kiểu MIME, nên `file.type` không bao giờ phân
         * biệt được hai thứ ấy. Nhờ đọc container, GIF TĨNH giờ cũng được thu nhỏ như mọi ảnh
         * tĩnh khác — trước đây mọi GIF đều đi nguyên bản, nên một tấm GIF tĩnh 5MB bị từ chối
         * dù chẳng có phần động nào để mà giữ.
         */
        if (file.size > MAX_UPLOAD_BYTES) {
          setError(
            `Ảnh động phải dưới ${fmtMb(MAX_UPLOAD_BYTES)} vì nó được giữ nguyên để không mất phần ` +
              "động — ảnh tĩnh thì được tự thu nhỏ nên nặng bao nhiêu cũng được.",
          );
          return;
        }
      } else {
        let shrunk: { blob: Blob; type: string };
        try {
          shrunk = await shrink(file);
        } catch {
          setError("Không đọc được ảnh này — hãy thử một tệp PNG, JPEG hoặc WebP.");
          return;
        }
        upload = shrunk.blob;

        // Gần như không xảy ra ở cạnh 512px, nhưng nói ra thì hơn là để server trả 413 với một
        // con số mà người dùng không biết từ đâu ra.
        if (upload.size > MAX_UPLOAD_BYTES) {
          setError(`Ảnh sau khi thu nhỏ vẫn nặng ${fmtMb(upload.size)} — hãy chọn tấm khác.`);
          return;
        }
      }

      const form = new FormData();
      form.append("file", upload, UPLOAD_FILENAME);
      const res = await fetch("/api/profile/avatar", { method: "POST", body: form });
      if (!res.ok) {
        setError(await failureOf(res));
        return;
      }

      const data = (await res.json()) as { url: string };
      setOverride({ url: data.url });
      router.refresh();
    } catch {
      setError("Mạng có trắc trở — thử lại một lượt.");
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    setError("");
    setBusy("remove");
    try {
      const res = await fetch("/api/profile/avatar", { method: "DELETE" });
      if (!res.ok) {
        setError(await failureOf(res));
        return;
      }
      setOverride({ url: null });
      router.refresh();
    } catch {
      setError("Mạng có trắc trở — thử lại một lượt.");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="card card-hairline mt-6 p-6 sm:p-8">
      <span className="label">Ảnh đại diện</span>

      <div className="avatar-editor mt-3">
        <Avatar name={name} url={shown} size={96} />

        <div className="avatar-editor-side">
          <p className="text-xs leading-relaxed text-[var(--color-mist)]">
            Ảnh hiện cạnh tên bạn trong Phòng Chat và trên thanh đầu trang. Chưa đặt thì hệ
            thống vẽ chữ đầu của danh xưng. Ảnh tĩnh được tự thu nhỏ về 512px và cắt vuông
            giữa; ảnh động (GIF, WebP, APNG) giữ nguyên để không mất phần động, nên phải dưới{" "}
            {fmtMb(MAX_UPLOAD_BYTES)}.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-gold"
              disabled={busy !== ""}
              onClick={() => fileRef.current?.click()}
            >
              {busy === "upload" ? "Đang tải lên…" : shown ? "Đổi ảnh" : "Chọn ảnh"}
            </button>
            {shown && (
              <button type="button" className="btn btn-ghost" disabled={busy !== ""} onClick={() => void remove()}>
                {busy === "remove" ? "Đang bỏ…" : "Bỏ ảnh"}
              </button>
            )}
          </div>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Dọn ô input NGAY, trước cả khi tải lên: không dọn thì chọn lại đúng tệp ấy lần thứ
          // hai (sau một lần lỗi) sẽ không sinh ra `change` nào để mà chạy lại.
          e.target.value = "";
          if (file) void pick(file);
        }}
      />

      {error && (
        <p role="status" className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
