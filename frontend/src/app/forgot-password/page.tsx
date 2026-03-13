import { ForgotPasswordClient } from "@/components/forgot-password-client";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const tokenParam = resolvedSearchParams.token;
  const errorParam = resolvedSearchParams.error;

  return (
    <ForgotPasswordClient
      token={typeof tokenParam === "string" ? tokenParam : null}
      error={typeof errorParam === "string" ? errorParam : null}
    />
  );
}
