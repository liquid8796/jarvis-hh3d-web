import Link from "next/link";
import { AuthCard } from "@/components/AuthCard";
import { getAppSettings } from "@/lib/services/settings";
import { RegisterForm } from "./RegisterForm";

export const metadata = { title: "Bái Sư" };

/**
 * Trang này TỪNG là trang duy nhất được prerender tĩnh trong cả control plane — vì nó là
 * trang duy nhất không đọc gì cả. Nay nó đọc môn quy, nên phải nói rõ là động, và đó không
 * phải chuyện làm cho đẹp: để nguyên thì `next build` đọc công tắc đúng MỘT LẦN rồi đóng
 * băng câu trả lời vào HTML, và trưởng môn gạt công tắc xong sẽ thấy trang bái sư vẫn hứa
 * hẹn cái quy trình cũ cho tới lần deploy kế tiếp. Kèm theo đó, `next build` sẽ cần một
 * database chỉ để dịch xong một trang — đúng thứ mà src/lib/db/client.ts cố tình tránh.
 */
export const dynamic = "force-dynamic";

/**
 * Phụ đề đọc môn quy thật chứ không viết cứng. Dòng chữ này là LỜI HỨA đầu tiên tông môn nói
 * với người lạ: hứa có bước xét duyệt trong khi cổng đang mở toang — hay ngược lại — thì lời
 * hứa đầu tiên ấy đã sai, và người ta phát hiện ra đúng lúc vừa bấm Bái Sư.
 */
export default async function RegisterPage() {
  const { membership } = await getAppSettings();

  return (
    <AuthCard
      backdrop="register"
      title="Bái Sư Nhập Môn"
      subtitle={
        membership.requireApproval
          ? "Lập đạo hiệu để gia nhập. Trưởng môn duyệt xong, đạo hữu mới được khai đàn."
          : "Lập đạo hiệu để gia nhập. Cổng tông môn đang mở — bái sư xong là khai đàn được ngay."
      }
    >
      <RegisterForm />
      <p className="mt-6 text-center text-sm text-[var(--color-mist)]">
        Đã có đạo hiệu?{" "}
        <Link href="/login" className="text-gilded underline-offset-4 hover:underline">
          Nhập môn tại đây
        </Link>
      </p>
    </AuthCard>
  );
}
