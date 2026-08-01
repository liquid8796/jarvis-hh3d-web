import Link from "next/link";
import { AuthCard } from "@/components/AuthCard";
import { RegisterForm } from "./RegisterForm";

export const metadata = { title: "Bái Sư" };

export default function RegisterPage() {
  return (
    <AuthCard
      title="Bái Sư Nhập Môn"
      subtitle="Lập đạo hiệu để gia nhập. Trưởng môn duyệt xong, đạo hữu mới được khai đàn."
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
