"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Menu } from "@/components/ui/Menu";
import { SetPasswordDialog } from "./SetPasswordDialog";

function initials(name: string | null | undefined, email: string): string {
  const source = name?.trim() || email.split("@")[0];
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

/** Signed in: an initials avatar with a menu. Signed out: "Sign in". */
export function AccountMenu() {
  const { data, isPending } = authClient.useSession();
  const router = useRouter();
  const [settingPassword, setSettingPassword] = useState(false);
  const user = data?.user;

  if (isPending) {
    // Hold the avatar's space so the bar does not shift when the session lands.
    return <span className="shell-avatar shell-avatar--placeholder" aria-hidden="true" />;
  }
  if (!user) {
    return (
      <Link href="/auth" className="ui-btn ui-btn--quiet ui-btn--sm shell-signin" data-ui="">
        Sign in
      </Link>
    );
  }
  return (
    <>
      <Menu
        label="Account"
        align="end"
        header={<span className="shell-account-email">{user.email}</span>}
        items={[
          { id: "library", label: "Plan library", href: "/plans" },
          { id: "set-password", label: "Set a password", onSelect: () => setSettingPassword(true) },
          {
            id: "sign-out",
            label: "Sign out",
            onSelect: async () => {
              await authClient.signOut();
              router.push("/");
            },
          },
        ]}
        trigger={(props) => (
          <button {...props} type="button" className="shell-avatar" aria-label={`Account: ${user.email}`}>
            {initials(user.name, user.email)}
          </button>
        )}
      />
      <SetPasswordDialog open={settingPassword} onOpenChange={setSettingPassword} />
    </>
  );
}
