"use client";

import Link from "next/link";
import { MarketingShell } from "@/components/marketing-shell";

const flowPreview = [
  {
    step: "01",
    title: "Mark the courses you have already handled.",
    copy: "Start with a clean prerequisite snapshot instead of a noisy checklist.",
  },
  {
    step: "02",
    title: "Adjust the semester around a single planning goal.",
    copy: "Compact days, morning clusters, shorter walks, or stronger professor ratings.",
  },
  {
    step: "03",
    title: "Finish with a route that works on campus.",
    copy: "The last screen is about actual movement, not a dead-end mockup.",
  },
];

const featureCards = [
  "Guest mode stays available from the first click.",
  "Saved plans live behind a dedicated auth surface instead of crowding the homepage.",
  "Each planner step now keeps one dominant task in view.",
];

export function LandingClient() {
  return (
    <MarketingShell>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.06fr)_minmax(22rem,0.94fr)]">
        <section className="surface-panel overflow-hidden px-6 py-7 sm:px-9 sm:py-9">
          <div className="max-w-3xl">
            <p className="editorial-label">UNT course planning</p>
            <h1 className="mt-4 max-w-[12ch] font-display text-[clamp(3.3rem,7vw,6.2rem)] font-bold leading-[0.88] tracking-[-0.09em] text-[color:var(--green-900)]">
              Build your schedule without the interface fighting you first.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-[color:var(--copy)]">
              UNTangle keeps the same academic workflow, but strips away the clutter. Start as a guest, sign in only when
              you want persistence, and move through courses, schedule shaping, and campus routing with a clearer sense of
              progress.
            </p>
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/courses" className="primary-button">
              Start as guest
            </Link>
            <Link href="/auth" className="secondary-button">
              Sign in or create account
            </Link>
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            {featureCards.map((item, index) => (
              <article
                key={item}
                className="subtle-panel animate-rise-in px-5 py-4"
                style={{ animationDelay: `${index * 90}ms` }}
              >
                <p className="text-sm leading-7 text-[color:var(--copy)]">{item}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <article className="surface-panel px-6 py-6 sm:px-7">
            <p className="editorial-label">Flow preview</p>
            <div className="mt-5 space-y-4">
              {flowPreview.map((item, index) => (
                <div
                  key={item.step}
                  className="subtle-panel animate-rise-in flex gap-4 px-5 py-5"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <div className="step-pill h-fit border-[rgba(79,127,95,0.22)] bg-[color:var(--green-100)] text-[color:var(--green-800)]">
                    {item.step}
                  </div>
                  <div>
                    <h2 className="font-display text-[1.75rem] font-bold leading-[0.96] tracking-[-0.05em] text-[color:var(--green-900)]">
                      {item.title}
                    </h2>
                    <p className="mt-2 text-sm leading-7 text-[color:var(--copy)]">{item.copy}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="surface-panel px-6 py-6 sm:px-7">
            <p className="editorial-label">Why the split helps</p>
            <div className="mt-4 space-y-3 text-sm leading-7 text-[color:var(--copy)]">
              <p>The homepage is for orientation, not for asking for credentials immediately.</p>
              <p>The auth surface is separate, so the first decision is simpler and the planner feels less crowded.</p>
            </div>
          </article>
        </section>
      </div>
    </MarketingShell>
  );
}
