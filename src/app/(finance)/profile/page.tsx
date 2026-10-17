import { readProfile } from '@/modules/identity/application/registration';
import { authenticatedRead } from '@/modules/identity/presentation/session';
import { IdentityForm } from '@/modules/identity/presentation/identity-form';
import { profileAction } from '@/modules/identity/presentation/profile-actions';
export default async function Page() {
  const profile = await authenticatedRead(readProfile);
  return (
    <div className="grid max-w-lg gap-6">
      <h1 className="text-3xl font-semibold">Профиль</h1>
      <p className="break-all text-muted-foreground">{profile.email}</p>
      <IdentityForm
        mode="profile"
        action={profileAction}
        initial={{
          name: profile.name,
          locale: profile.locale,
          timezone: profile.timezone,
          expectedVersion: profile.version,
        }}
      />
    </div>
  );
}
