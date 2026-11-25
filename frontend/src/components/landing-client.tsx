"use client";

import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";

export function LandingClient() {
  return (
    <AuthShell step={0} totalSteps={4} tagline="Plan UNT semesters.">
      <Link href="/courses" className="btn-primary" style={{ width: "100%", padding: "0.85rem 1.1rem" }}>
        Continue as guest
      </Link>
      <Link
        href="/auth"
        className="btn-ghost"
        style={{ width: "100%", padding: "0.7rem", fontSize: "0.85rem" }}
      >
        Sign in or create account
      </Link>
    </AuthShell>
  );
}
