"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { authClient } from "@/lib/auth-client";

export function AuthClient() {
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
    <AuthShell
      eyebrow="Planner access"
      title="Sign in without the homepage doing too much."
      description="Saved plans and synced course states live here. Browse first, or enter directly if you are ready to keep your planner across sessions."
      aside={
        <>
          {[
            "Guest mode still gets the full planner flow.",
            "Signed-in changes persist across sessions.",
          ].map((item, index) => (
            <div
              key={item}
              className="subtle-panel animate-rise-in px-5 py-4"
              style={{ animationDelay: `${index * 80}ms` }}
            >
              <p className="text-sm leading-7 text-[color:var(--copy)]">{item}</p>
            </div>
          ))}
        </>
      }
    >
      <div className="surface-panel mx-auto w-full max-w-[34rem] px-6 py-6 sm:px-7 sm:py-7">
        <div className="rounded-full border border-[color:var(--line)] bg-[rgba(255,255,255,0.65)] p-1">
          <div className="grid grid-cols-2 gap-1">
            {(["signIn", "signUp"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`rounded-full px-4 py-3 text-sm font-semibold transition-all duration-200 ${
                  mode === value
                    ? "bg-[color:var(--green-800)] text-white shadow-[0_10px_22px_rgba(38,69,52,0.14)]"
                    : "text-[color:var(--muted)]"
                }`}
                onClick={() => setMode(value)}
              >
                {value === "signIn" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>
        </div>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
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

          {message ? (
            <p className="rounded-[1.25rem] border border-[#e5c1c1] bg-[#fff6f4] px-4 py-3 text-sm text-[#8a3b3b]">
              {message}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <button className="primary-button w-full" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Working..." : mode === "signIn" ? "Sign in" : "Create account"}
            </button>
            <button type="button" className="secondary-button w-full" onClick={() => router.push("/courses")}>
              Continue as guest
            </button>
          </div>
        </form>
      </div>
    </AuthShell>
  );
}
