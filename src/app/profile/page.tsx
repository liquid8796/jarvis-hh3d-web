import { SiteHeader } from "@/components/SiteHeader";
import { requireUser } from "@/lib/auth/guards";
import { AvatarPicker } from "./AvatarPicker";
import { ProfileForm } from "./ProfileForm";

export const metadata = { title: "Hồ Sơ" };

export default async function ProfilePage() {
  const user = await requireUser();

  return (
    <>
      <SiteHeader />
      <main data-backdrop="profile" className="mx-auto w-full max-w-xl px-4 pb-24 sm:px-6">
        <div className="rise-in mt-6">
          <h1 className="h-display text-3xl font-bold text-gilded">Hồ Sơ Đạo Hữu</h1>
          <AvatarPicker name={user.displayName} url={user.avatarUrl} />
          <ProfileForm
            username={user.username}
            displayName={user.displayName}
            email={user.email}
          />
        </div>
      </main>
    </>
  );
}
