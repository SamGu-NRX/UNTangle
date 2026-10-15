"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearPlannerIdentity } from "@/lib/planner-store";
import { clearSavedPlansIdentity } from "@/lib/saved-plans/store";
import { useState } from "react";
import { openSignIn } from "@/components/auth-shell";
import { authClient } from "@/lib/auth-client";
import { useConfirmedAccount, usePlanner } from "@/components/planner-provider";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { UserGlyph } from "@/components/ui/icons";
import { Menu } from "@/components/ui/Menu";
import { toast } from "@/components/ui/Toast";
import { SCHEDULES_HREF } from "./routes";
import { SetPasswordDialog } from "./SetPasswordDialog";

function initials(name: string | null | undefined, email: string): string {
  const source = name?.trim() || email.split("@")[0];
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * Signed in: an initials avatar with a menu. Signed out: "Sign in", as text
 * on desktop and as a person glyph in the phone header; it opens the sign-in
 * form over the current page (SignInHost), and /auth is its fallback.
 *
 * It shows the account the planner confirmed, not the raw session lookup, so
 * a lookup that fails for a moment does not show "Sign in" while that
 * account's schedule is still on screen.
 */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const account = useConfirmedAccount();
  const router = useRouter();
  const [settingPassword, setSettingPassword] = useState(false);
  const { prepareSignOut } = usePlanner();
  // Open while waiting writes need the student's choice before signing out.
  const [unsyncedAsk, setUnsyncedAsk] = useState(false);
  const [syncing, setSyncing] = useState(false);

  if (account.status === "checking") {
    // Hold the avatar's space so the bar does not shift when the session lands.
    return <span className="shell-avatar shell-avatar--placeholder" aria-hidden="true" />;
  }
  if (account.status === "signed-out") {
    return compact ? (
      <Link href="/auth" onClick={openSignIn} className="ui-btn ui-btn--ink ui-btn--icon shell-signin" aria-label="Sign in" data-ui="">
        <UserGlyph size={22} />
      </Link>
    ) : (
      <Link href="/auth" onClick={openSignIn} className="ui-btn ui-btn--quiet ui-btn--sm shell-signin" data-ui="">
        Sign in
      </Link>
    );
  }
  const { user } = account;
  /**
   * Signing out deletes this account's documents from the browser, so a
   * write still waiting for the server is never dropped without the
   * student's choice (docs/architecture/README.md, "Local data belongs to one identity").
   */
  const signOut = async ({ discard = false }: { discard?: boolean } = {}) => {
    const prepared = await prepareSignOut();
    if (prepared.unsynced && !discard) {
      setUnsyncedAsk(true);
      return false;
    }
    let failed: boolean;
    try {
      failed = Boolean((await authClient.signOut()).error);
    } catch {
      failed = true;
    }
    if (failed) {
      // The session may still be live, so this account's local data stays.
      toast({
        message: "Couldn't sign out. You're still signed in on this device.",
        tone: "error",
        action: { label: "Try again", onClick: () => void signOut({ discard }) },
      });
      return false;
    }
    setUnsyncedAsk(false);
    await prepared.forget(discard).catch((error: unknown) => console.error("Couldn't clear this account's documents from the browser", error));
    clearPlannerIdentity(user.id);
    clearSavedPlansIdentity(user.id);
    clearPlannerIdentity(null);
    clearSavedPlansIdentity(null);
    router.push("/");
    return true;
  };
  const syncThenSignOut = async () => {
    setSyncing(true);
    try {
      if ((await prepareSignOut()).unsynced) {
        toast({ message: "Couldn't sync. Check your connection and try again.", tone: "error" });
        return;
      }
      await signOut();
    } finally {
      setSyncing(false);
    }
  };
  return (
    <>
      <Menu
        label="Account"
        align="end"
        header={<span className="shell-account-email">{user.email}</span>}
        items={[
          { id: "schedules", label: "Schedules", href: SCHEDULES_HREF },
          { id: "set-password", label: "Set a password", onSelect: () => setSettingPassword(true) },
          {
            id: "sign-out",
            label: "Sign out",
            onSelect: () => void signOut(),
          },
        ]}
        trigger={(props) => (
          <button {...props} type="button" className="shell-avatar" aria-label={`Account: ${user.email}`}>
            {initials(user.name, user.email)}
          </button>
        )}
      />
      <SetPasswordDialog open={settingPassword} onOpenChange={setSettingPassword} />
      <Dialog
        open={unsyncedAsk}
        onOpenChange={setUnsyncedAsk}
        role="alertdialog"
        title="Some changes haven't synced."
        description="Sync now, or sign out and discard them?"
        footer={
          <>
            <Button variant="destructive" disabled={syncing} onClick={() => void signOut({ discard: true })}>
              Sign out and discard
            </Button>
            <Button loading={syncing} onClick={() => void syncThenSignOut()}>
              Sync now
            </Button>
          </>
        }
      />
    </>
  );
}
