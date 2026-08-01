import { SectSeal } from "./SectSeal";

/** Khung chung cho các trang nghi lễ (đăng nhập / bái sư): ấn trên đỉnh, thân bài giữa trời. */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-[80dvh] w-full max-w-md flex-col items-center justify-center px-6 py-12">
      <div className="card card-hairline rise-in w-full p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <SectSeal size="3.6rem" />
          <h1 className="h-display mt-4 text-2xl font-bold text-gilded">{title}</h1>
          <p className="mt-2 text-sm text-[var(--color-mist)]">{subtitle}</p>
        </div>
        {children}
      </div>
    </main>
  );
}
