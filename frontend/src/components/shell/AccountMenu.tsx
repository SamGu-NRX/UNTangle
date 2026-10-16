"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { forgetGuestHere } from "@/lib/guest-sign-in";
import { clearPlannerIdentity } from "@/lib/planner-store";
import { clearSavedPlansIdentity, createSavedPlanStore } from "@/lib/saved-plans/store";
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
  // Open while signing out would lose something the student hasn't agreed to lose.
  const [ask, setAsk] = useState<{ unsynced: boolean; saved: number } | null>(null);
  const [busy, setBusy] = useState<"sync" | "discard" | "remove" | null>(null);

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
  /**
   * Signing out deletes this account's documents and saved schedules from the
   * browser. A write still waiting for the server is never dropped without the
   * student's choice (docs/architecture/README.md, "Local data belongs to one
   * identity"), and saved schedules, which live only on this browser for now,
   * are never removed without saying so.
   */
  const signOut = async ({
    discard = false,
    removeSaved = false,
    prepared: given,
  }: { discard?: boolean; removeSaved?: boolean; prepared?: Awaited<ReturnType<typeof prepareSignOut>> } = {}) => {
    const prepared = given ?? (await prepareSignOut());
    const library = createSavedPlanStore().list();
    const saved = library.ok ? library.doc.plans.length : 0;
    if ((prepared.unsynced && !discard) || (saved > 0 && !removeSaved)) {
      setAsk({ unsynced: prepared.unsynced && !discard, saved: removeSaved ? 0 : saved });
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
        action: { label: "Try again", onClick: () => void signOut({ discard, removeSaved, prepared }) },
      });
      return false;
    }
    setAsk(null);
    await prepared.forget(discard).catch((error: unknown) => console.error("Couldn't clear this account's documents from the browser", error));
    clearPlannerIdentity(user.id);
    clearSavedPlansIdentity(user.id);
    clearPlannerIdentity(null);
    clearSavedPlansIdentity(null);
    forgetGuestHere();
    router.push("/");
    return true;
  };
  /**
   * "Sync now" tries the waiting writes once more, then signs out, asking
   * again if saved schedules would go. "Sign out and discard" and "Sign out
   * and remove them" answer what the dialog listed; neither drops a write the dialog didn't mention.
   */
  const settle = async (choice: "sync" | "discard" | "remove") => {
    setBusy(choice);
    try {
      const prepared = await prepareSignOut();
      if (choice === "sync" && prepared.unsynced) {
        toast({ message: "Couldn't sync, so you're still signed in. Try again, or sign out and discard them.", tone: "error" });
        return;
      }
      await signOut({ discard: choice === "discard", removeSaved: choice !== "sync", prepared });
    } finally {
      setBusy(null);
    }
  };
  const saved = ask?.saved ?? 0;
  const savedLine =
    saved > 0
      ? `${saved} saved ${saved === 1 ? "schedule is" : "schedules are"} kept only on this browser, and signing out removes ${saved === 1 ? "it" : "them"}. Export ${saved === 1 ? "it" : "them"} from Schedules to keep a copy.`
      : "";
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
        open={ask !== null}
        onOpenChange={(open) => (open ? undefined : setAsk(null))}
        role="alertdialog"
        title={ask?.unsynced ? "Some changes haven't synced" : "Saved schedules stay on this browser"}
        description={ask?.unsynced ? ["Sync now, or sign out and discard them?", savedLine].filter(Boolean).join(" ") : savedLine}
        footer={
          ask?.unsynced ? (
            <>
              <Button variant="destructive" loading={busy === "discard"} disabled={busy !== null} onClick={() => void settle("discard")}>
                Sign out and discard
              </Button>
              <Button loading={busy === "sync"} disabled={busy !== null} onClick={() => void settle("sync")}>
                Sync now
              </Button>
            </>
          ) : (
            <>
              <Button variant="destructive" loading={busy === "remove"} disabled={busy !== null} onClick={() => void settle("remove")}>
                Sign out and remove them
              </Button>
              <Link href={SCHEDULES_HREF} className="ui-btn ui-btn--primary" data-ui="" onClick={() => setAsk(null)}>
                Open Schedules
              </Link>
            </>
          )
        }
      />
    </>
  );
}
