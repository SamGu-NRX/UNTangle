"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { usePlanner } from "@/components/planner-provider";
import { openConnect } from "@/components/connect/open-connect";
import { ChevronRight } from "@/components/ui/icons";
import { getInitialPlannerState } from "@/lib/planner";
import { hasStartedPlan } from "./home-entry";

const OPTIONS = [
  {
    id: "connect",
    title: "Import from myUNT",
    meta: "Download your unofficial transcript and bring the PDF back here.",
    href: null,
    primary: true,
  },
  {
    id: "upload",
    title: "Upload a transcript PDF",
    meta: "Already downloaded it? Choose it, or drop it anywhere on the page.",
    href: null,
    primary: false,
  },
  {
    id: "manual",
    title: "Pick courses by hand",
    meta: "Browse the catalog and mark what you've taken.",
    href: "/courses",
    primary: false,
  },
];

/**
 * `/`: the guest Courses entry (DESIGN.md §2 Landing). A first visit gets
 * a calm three-way start; a student who has already begun goes straight
 * to Courses. Nothing renders until the stored plan has loaded, so a
 * returning student never sees the welcome flash before the redirect.
 */
export function HomeEntry() {
  const { hydrated, plannerState } = usePlanner();
  const router = useRouter();
  const started = hydrated && hasStartedPlan(plannerState, getInitialPlannerState());

  useEffect(() => {
    if (started) router.replace("/courses");
  }, [started, router]);

  if (!hydrated || started) {
    return <div className="home" aria-busy="true" />;
  }

  return (
    <div className="home">
      <section className="home-card" aria-labelledby="home-title">
        <h1 id="home-title" className="home-card__title">
          Start with what you&apos;ve taken
        </h1>
        <ul className="home-options">
          {OPTIONS.map((option) => (
            <li key={option.id} className={option.primary ? "home-option home-option--primary" : "home-option"}>
              {option.href ? (
                <Link href={option.href} className="home-option__link">
                  <span className="home-option__title">{option.title}</span>
                  <span className="home-option__meta">{option.meta}</span>
                  <ChevronRight className="home-option__chevron" />
                </Link>
              ) : (
                // Both transcript paths open the Connect sheet over this page.
                <button type="button" className="home-option__link" onClick={openConnect}>
                  <span className="home-option__title">{option.title}</span>
                  <span className="home-option__meta">{option.meta}</span>
                  <ChevronRight className="home-option__chevron" />
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="home-foot">
          <span>
            Have an account? <Link href="/auth">Sign in</Link>
          </span>
          <Link href="/about">About UNTangle</Link>
        </p>
        <p className="home-install-hint">Tip: add UNTangle to your Home Screen from the Share menu to open it like an app.</p>
      </section>
    </div>
  );
}
