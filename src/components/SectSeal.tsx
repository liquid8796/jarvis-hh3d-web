/** Ấn tông môn — chữ triện trong linh trận xoay. Thuần trang trí, im lặng với screen reader. */
export function SectSeal({ size = "3rem" }: { size?: string }) {
  return (
    <span className="seal" style={{ width: size, height: size }} aria-hidden>
      <span className="h-display text-gilded" style={{ fontSize: `calc(${size} * 0.42)` }}>
        僊
      </span>
    </span>
  );
}
