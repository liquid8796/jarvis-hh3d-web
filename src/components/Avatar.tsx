/**
 * Vòng tròn danh tính — ảnh đại diện nếu đạo hữu đã đặt, còn không thì chữ đầu của danh xưng
 * trên một nền màu suy từ chính cái tên.
 *
 * MỘT bản cho cả app, và đó là điểm chính: thanh đầu trang (server component), trang Hồ Sơ
 * (server) và sảnh đàm đạo (client) đều vẽ cùng một vòng tròn. Trước bản này chỉ sảnh đàm đạo
 * có nó, với `initialOf`/`hueOf` nằm riêng trong ChatRoom.tsx — chép thêm một bản nữa ở chỗ
 * khác là cách êm ái nhất để hai chỗ cùng vẽ một người thành hai màu khác nhau.
 *
 * Không có `"use client"`: component này không giữ trạng thái nào, nên nó chạy được ở cả hai
 * phía — server render ra HTML, còn ChatRoom gói nó vào bundle client.
 */

/** Chữ đầu của danh xưng. Tên rỗng hay toàn dấu cách thì rơi về「?」chứ không ra ô trống. */
function initialOf(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

/**
 * Màu nền suy từ tên — ổn định giữa các lần tải, không cần lưu đâu cả. Nhờ vậy một người chưa
 * đặt ảnh vẫn luôn xuất hiện với cùng một sắc, và mắt nhận ra họ trong sảnh trước cả khi đọc tên.
 */
function hueOf(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function Avatar({
  name,
  url,
  size,
  className = "",
}: {
  name: string;
  /** URL ảnh trong tàng khố media, hoặc null/undefined khi đạo hữu chưa đặt ảnh. */
  url?: string | null;
  /** Đường kính, đơn vị pixel. Cỡ chữ của chữ-đầu suy theo nó nên mọi cỡ đều cân. */
  size: number;
  className?: string;
}) {
  return (
    <span
      className={`avatar ${className}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        fontSize: `${Math.round(size * 0.42)}px`,
        background: `hsl(${hueOf(name)} 45% 32%)`,
      }}
      // Trang trí: vòng tròn này luôn đi kèm danh xưng dạng CHỮ ở ngay bên cạnh, nên đọc thêm
      // một chữ「N」lơ lửng chỉ làm rối. Vì vậy ảnh bên trong cũng mang `alt` rỗng.
      aria-hidden="true"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" decoding="async" />
      ) : (
        initialOf(name)
      )}
    </span>
  );
}
