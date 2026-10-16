"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { forgetGuestWork, guestWorkIsThisSession } from "@/lib/guest-session";
import { GUEST_ID_KEY, preferencesKey } from "@/components/schedule/preferences-store";
import { clearPlannerIdentity, plannerStateKey } from "@/lib/planner-store";
import { clearSavedPlansIdentity, createSavedPlanStore, savedPlansKey } from "@/lib/saved-plans/store";
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
  const [ask, setAsk] = useState<Ask | null>(null);
  // The last question, kept while the dialog plays its exit.
  const [shownAsk, setShownAsk] = useState<Ask | null>(null);
  if (ask && ask !== shownAsk) setShownAsk(ask);
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
   * Signing out deletes this account's documents and saved schedules from the
   * browser, and this browser's guest work. A write still waiting for the
   * server is never dropped without the student's choice
   * (docs/architecture/README.md, "Local data belongs to one identity"), and
   * nothing that lives only on this browser is removed without saying so.
   * Each dialog asks one question: discarding waiting writes then asks about
   * saved schedules.
   */
  const signOut = async ({
    discard = false,
    remove = false,
    prepared: given,
  }: { discard?: boolean; remove?: boolean; prepared?: Awaited<ReturnType<typeof prepareSignOut>> } = {}) => {
    const prepared = given ?? (await prepareSignOut());
    if (prepared.unsynced && !discard) {
      setAsk({ kind: "unsynced" });
      return false;
    }
    const library = createSavedPlanStore().list();
    // Entries this version can't read are removed too, so they count; an unreadable library counts as one.
    const saved = library.ok ? library.doc.plans.length + library.doc.unreadable.length : 1;
    const guestWork = guestWorkOnBrowser();
    if ((saved > 0 || guestWork) && !remove) {
      // The answer to the first question travels with the second, so answering one never undoes the other.
      setAsk({ kind: "remove", saved, guestWork, discard });
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
        action: { label: "Try again", onClick: () => void signOut({ discard, remove, prepared }) },
      });
      return false;
    }
    setAsk(null);
    await prepared.forget(discard).catch((error: unknown) => console.error("Couldn't clear this account's documents from the browser", error));
    clearPlannerIdentity(user.id);
    clearSavedPlansIdentity(user.id);
    clearPlannerIdentity(null);
    clearSavedPlansIdentity(null);
    clearGuestPreferences();
    forgetGuestWork();
    router.push("/");
    return true;
  };
  const settle = async (choice: "sync" | "discard" | "remove") => {
    setBusy(choice);
    try {
      const prepared = await prepareSignOut();
      if (choice === "sync" && prepared.unsynced) {
        toast({ message: "Couldn't sync, so you're still signed in. Try again, or sign out and discard them.", tone: "error" });
        return;
      }
      const discarded = choice === "discard" || (choice === "remove" && ask?.kind === "remove" && ask.discard);
      await signOut({ discard: discarded, remove: choice === "remove", prepared });
    } finally {
      setBusy(null);
    }
  };
  const view = ask ?? shownAsk;
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
        focusTitle
        title={view?.kind === "unsynced" ? "Some changes haven't synced" : view ? removalTitle(view) : undefined}
        description={view?.kind === "unsynced" ? "Sync now, or sign out and discard them?" : view ? removalLine(view) : undefined}
        footer={
          view?.kind === "unsynced" ? (
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
                Remove and sign out
              </Button>
              {view?.saved ? (
                <Link href={SCHEDULES_HREF} className="ui-btn ui-btn--primary" data-ui="" onClick={() => setAsk(null)}>
                  Open Schedules
                </Link>
              ) : null}
            </>
          )
        }
      />
    </>
  );
}

type GuestWork = "this-session" | "earlier" | null;
type Ask = { kind: "unsynced" } | { kind: "remove"; saved: number; guestWork: GuestWork; discard: boolean };

function removalTitle(ask: Ask): string {
  if (ask.kind !== "remove" || ask.saved > 0) return "Signing out removes your saved schedules";
  return ask.guestWork === "this-session" ? "Signing out removes your work from before you signed in" : "Signing out removes guest work kept on this browser";
}

function removalLine(ask: Ask): string {
  if (ask.kind !== "remove") return "";
  const { saved, guestWork } = ask;
  const one = saved === 1;
  const lines = [
    saved > 0 ? `${saved} saved ${one ? "schedule is" : "schedules are"} kept only on this browser. Export ${one ? "it" : "them"} from Schedules to keep a copy.` : "",
    guestWork === "this-session"
      ? "What you did as a guest before signing in hasn't been added to your account yet. Stay signed in to choose what to keep."
      : guestWork === "earlier"
        ? "This browser also keeps guest work from an earlier visit."
        : "",
  ];
  return lines.filter(Boolean).join(" ");
}

/**
 * The guest work sign-out will delete: whatever the guest stores hold, read
 * raw so nothing is migrated or moved by looking. A library that can't be
 * read counts, as its bytes are deleted too. "this-session" when a guest
 * wrote some of it in this browser session (lib/guest-session.ts), which
 * signing in could still carry into the account.
 */
function guestWorkOnBrowser(): GuestWork {
  try {
    const storage = window.localStorage;
    const guestId = storage.getItem(GUEST_ID_KEY);
    const any =
      storage.getItem(plannerStateKey(null)) !== null ||
      (guestId !== null && storage.getItem(preferencesKey({ kind: "guest", id: guestId })) !== null) ||
      guestLibraryEntries(storage.getItem(savedPlansKey(null))) > 0;
    if (!any) return null;
    return guestWorkIsThisSession() ? "this-session" : "earlier";
  } catch {
    // Storage denied: no guest work was kept.
    return null;
  }
}

/** Entries in a stored library, readable or not; an unparseable library counts as one. */
function guestLibraryEntries(raw: string | null): number {
  if (raw === null) return 0;
  try {
    const doc = JSON.parse(raw) as { plans?: unknown; unreadable?: unknown };
    const count = (list: unknown) => (Array.isArray(list) ? list.length : 0);
    return count(doc?.plans) + count(doc?.unreadable);
  } catch {
    return 1;
  }
}

/** The guest's preferences go with the rest of the guest's work. */
function clearGuestPreferences(): void {
  try {
    const guestId = window.localStorage.getItem(GUEST_ID_KEY);
    if (guestId) window.localStorage.removeItem(preferencesKey({ kind: "guest", id: guestId }));
  } catch {
    // Storage denied: nothing was stored.
  }
}
