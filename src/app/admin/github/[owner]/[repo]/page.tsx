import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { githubStationDetailForAdmin } from "@/app/actions/githubNurture";
import { GithubCompanionDetail } from "./GithubCompanionDetail";

export const metadata = { title: "Kho GitHub · Kho phần mềm phụ" };
export const maxDuration = 300;

export default async function GithubStationPage({ params }: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  // The data action checks github_station.manage before reading any station details.
  const detail = await githubStationDetailForAdmin(`${owner}/${repo}`);
  if (!detail) notFound();
  return (
    <>
      <SiteHeader />
      <main data-backdrop="admin" className="mx-auto w-full max-w-5xl px-4 pb-24 sm:px-6">
        <Link href="/admin" className="mb-5 inline-block text-sm text-[var(--color-gold-300)] hover:underline">← Về Tông Môn</Link>
        <h1 className="h-display text-2xl font-bold break-all text-gilded">{detail.station.slug}</h1>
        <p className="mt-2 mb-6 text-sm text-[var(--color-mist)]">Cấu hình và quản lý các kho phần mềm phụ của kho khôi lỗi này.</p>
        <GithubCompanionDetail detail={detail} />
      </main>
    </>
  );
}
