import Link from "next/link";
import { AuthCard } from "@/components/AuthCard";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Nhập Môn" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <AuthCard title="Nhập Môn" subtitle="Xưng đạo hiệu để trở lại Linh Đài.">
      <LoginForm next={typeof next === "string" ? next : ""} />
      <p className="mt-6 text-center text-sm text-[var(--color-mist)]">
        Chưa gia nhập?{" "}
        <Link href="/register" className="text-gilded underline-offset-4 hover:underline">
          Bái sư tại đây
        </Link>
      </p>
    </AuthCard>
  );
}
