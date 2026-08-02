import Image from "next/image";

/**
 * Ấn tông môn — tấm ấn thư pháp "Phàm nhân tu tiên" GỐC (public/seal.png), không phải bản
 * dựng lại bằng font. Bản 0.5.0 từng vẽ xấp xỉ nó bằng Dancing Script vì chưa có file; giờ
 * có rồi thì nét bút thật thay cho nét giả. Ảnh vuông nền than, viền tròn của chính nó nội
 * tiếp hình vuông — nên bo tròn 50% cắt đúng bốn góc nền thừa mà không chạm vào vòng ấn.
 *
 * Thuần trang trí, im lặng với screen reader; phần "động" của logo giờ là quầng vàng thở
 * chậm quanh ấn (CSS .seal) thay cho vòng chấm xoay cũ — ấn thật đã tự mang vòng chấm.
 */
export function SectSeal({ size = "3rem" }: { size?: string }) {
  return (
    <span className="seal" style={{ width: size, height: size }} aria-hidden>
      {/* priority: con dấu luôn đứng đầu màn hình (header, hero, auth) — để lazy thì nó là
          thứ nhấp nháy vào sau cùng ở đúng chỗ mắt nhìn trước tiên. */}
      <Image src="/seal.png" alt="" fill sizes="120px" priority className="seal-img" />
    </span>
  );
}
