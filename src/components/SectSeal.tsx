/**
 * Ấn tông môn — "Phàm nhân tu tiên" viết tay ba dòng vàng kim, lồng trong vòng tròn kép
 * (ngoài chấm rời xoay chậm, trong nét liền), phỏng theo mẫu ấn thư pháp làm chuẩn.
 *
 * Thuần trang trí, im lặng với screen reader. Chữ co giãn theo `size` nên cùng một con dấu
 * dùng được từ header 2.6rem tới hero 5.5rem — ở cỡ nhỏ nó là hoạ tiết, không cần đọc được;
 * đó là lý do aria-hidden chứ không phải alt text.
 */
export function SectSeal({ size = "3rem" }: { size?: string }) {
  return (
    <span className="seal" style={{ width: size, height: size }} aria-hidden>
      <span className="seal-script" style={{ fontSize: `calc(${size} * 0.185)` }}>
        Phàm
        <br />
        nhân
        <br />
        tu tiên
      </span>
    </span>
  );
}
