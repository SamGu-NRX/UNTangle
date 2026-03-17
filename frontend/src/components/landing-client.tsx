"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { StatusChip } from "@/components/status-chip";
import { authClient } from "@/lib/auth-client";

const featureCards = [
  {
    title: "Prerequisite-aware intake",
    copy: "Review prior coursework, see what is complete, and move forward with a cleaner academic snapshot.",
  },
  {
    title: "Optimization that feels legible",
    copy: "Shift the semester toward morning focus, compact days, shorter walks, or stronger professor ratings.",
  },
  {
    title: "Campus map as a destination",
    copy: "Finish with a route-first view designed for real campus movement instead of a static screenshot.",
  },
];

export function LandingClient() {
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("eagleid@unt.edu");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("Mean Green Student");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    const response =
      mode === "signIn"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name });

    setIsSubmitting(false);

    if (response.error) {
      setMessage(response.error.message ?? "Authentication failed.");
      return;
    }

    router.push("/courses");
  }

  return (
    <AppShell
      currentStep={0}
      eyebrow="Entry"
      title="A quieter, clearer way to build your UNT schedule."
      subtitle="The old flow had the right bones. This version keeps the same four steps, but sharpens the pacing, typography, and interaction quality so the experience feels intentional from the first screen."
      aside={
        <section className="glass-panel p-5">
          <div className="mb-5 flex flex-wrap gap-2">
            <StatusChip label="Guest-friendly" tone="stone" />
            <StatusChip label="Better Auth" tone="green" />
            <StatusChip label="Google campus map" tone="gold" />
          </div>
          <div className="mb-6 flex gap-2 rounded-full bg-[rgba(16,38,20,0.05)] p-1">
            {(["signIn", "signUp"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`flex-1 rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200 ${
                  mode === value
                    ? "bg-[var(--green-800)] text-white shadow-[0_10px_24px_rgba(17,46,29,0.18)]"
                    : "text-[var(--muted)]"
                }`}
                onClick={() => setMode(value)}
              >
                {value === "signIn" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>
          <form className="space-y-4" onSubmit={handleSubmit}>
            {mode === "signUp" ? (
              <label className="block">
                <span className="field-label">Name</span>
                <input className="field-input" value={name} onChange={(event) => setName(event.target.value)} />
              </label>
            ) : null}
            <label className="block">
              <span className="field-label">Email / Username</span>
              <input
                className="field-input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="field-label">Password</span>
              <input
                className="field-input"
                type="password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {message ? <p className="text-sm text-[#8d2b2b]">{message}</p> : null}
            <div className="flex flex-col gap-3">
              <button className="primary-button w-full" disabled={isSubmitting} type="submit">
                {isSubmitting ? "Working..." : mode === "signIn" ? "Sign in" : "Create account"}
              </button>
              <button
                type="button"
                className="secondary-button w-full"
                onClick={() => router.push("/courses")}
              >
                Continue as guest
              </button>
            </div>
          </form>
          <div className="mt-6 flex flex-col gap-2 text-sm text-[var(--muted)]">
            <Link className="transition-colors duration-150 hover:text-[var(--green-900)]" href="/forgot-password">
              Forgot password?
            </Link>
            <span>Saved plans unlock cross-session persistence.</span>
          </div>
        </section>
      }
    >
      <div className="space-y-8">
        <div className="flex flex-wrap gap-2 xl:hidden">
          <StatusChip label="Guest-friendly" tone="stone" />
          <StatusChip label="Better Auth" tone="green" />
          <StatusChip label="Google campus map" tone="gold" />
        </div>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(22rem,0.95fr)] xl:items-start">
          <div className="rounded-[2rem] border border-[rgba(16,38,20,0.08)] bg-[linear-gradient(145deg,_rgba(17,46,29,0.94),_rgba(18,60,35,0.82))] p-6 text-white shadow-[0_20px_60px_rgba(15,35,20,0.14)] sm:p-8">
            <p className="text-xs uppercase tracking-[0.32em] text-[#d4e6cb]">Flow preview</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {[
                "Review prior courses with prerequisite context.",
                "Let the optimizer choose a starting semester layout.",
                "Swap sections without walking into overlap.",
                "Finish with a live campus route instead of a static mock.",
              ].map((item, index) => (
                <div
                  key={item}
                  className="rounded-[1.5rem] border border-[rgba(255,255,255,0.12)] bg-white/8 p-4 backdrop-blur-sm transition-transform duration-200 ease-out hover:-translate-y-0.5"
                  style={{ animationDelay: `${index * 70}ms` }}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#b9d7b2]">
                    0{index + 1}
                  </p>
                  <p className="mt-3 text-lg leading-8 text-[#f3f2ed]">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-1">
            {featureCards.map((card) => (
              <article
                key={card.title}
                className="rounded-[1.6rem] border border-[rgba(16,38,20,0.08)] bg-[linear-gradient(180deg,_rgba(255,255,255,0.88),_rgba(245,239,228,0.72))] p-5 shadow-[0_18px_40px_rgba(27,36,24,0.06)]"
              >
                <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Why this flow works</p>
                <h2 className="mt-3 font-display text-[clamp(1.9rem,2.4vw,2.45rem)] font-bold leading-[0.95] tracking-[-0.06em] text-[var(--green-900)]">
                  {card.title}
                </h2>
                <p className="mt-3 text-base leading-8 text-[var(--copy)]">{card.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="glass-panel p-5 xl:hidden">
          <div className="mb-6 flex gap-2 rounded-full bg-[rgba(16,38,20,0.05)] p-1">
            {(["signIn", "signUp"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-200 ${
                  mode === value
                    ? "bg-[var(--green-800)] text-white shadow-[0_10px_24px_rgba(17,46,29,0.18)]"
                    : "text-[var(--muted)]"
                }`}
                onClick={() => setMode(value)}
              >
                {value === "signIn" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>
          <form className="space-y-4" onSubmit={handleSubmit}>
            {mode === "signUp" ? (
              <label className="block">
                <span className="field-label">Name</span>
                <input className="field-input" value={name} onChange={(event) => setName(event.target.value)} />
              </label>
            ) : null}
            <label className="block">
              <span className="field-label">Email / Username</span>
              <input
                className="field-input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="field-label">Password</span>
              <input
                className="field-input"
                type="password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {message ? <p className="text-sm text-[#8d2b2b]">{message}</p> : null}
            <div className="flex flex-col gap-3 sm:flex-row">
              <button className="primary-button flex-1" disabled={isSubmitting} type="submit">
                {isSubmitting ? "Working..." : mode === "signIn" ? "Sign in" : "Create account"}
              </button>
              <button
                type="button"
                className="secondary-button flex-1"
                onClick={() => router.push("/courses")}
              >
                Continue as guest
              </button>
            </div>
          </form>
          <div className="mt-6 flex flex-col gap-2 text-sm text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
            <Link className="transition-colors duration-150 hover:text-[var(--green-900)]" href="/forgot-password">
              Forgot password?
            </Link>
            <span>Saved plans unlock cross-session persistence.</span>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
