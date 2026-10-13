import { APIError } from "better-auth/api";
import type { createAuth } from "@/lib/auth-config";
import type { AuthEmailKind } from "@/lib/auth-email";

/** How recent the session must be: a password is a second way in, so it is added only right after a sign-in. */
export const SET_PASSWORD_MAX_SESSION_AGE_MS = 10 * 60 * 1000;

type Deps = {
  sendEmail: (kind: AuthEmailKind, to: string, url: string) => Promise<unknown>;
  now?: () => number;
};

const refuse = (status: number, code: string, message: string) => Response.json({ code, message }, { status });

/**
 * "Set a password" for a signed-in account that has none. better-auth's
 * setPassword is server-only (it has no public endpoint), so this wraps it
 * in the app's own POST /api/account/set-password.
 *
 * - better-auth's origin check doesn't run for server-side calls, so this
 *   route does its own: the request must come from the app's origin with a
 *   JSON body (a cross-site form can't send that without a preflight).
 * - The session must have started in the last 10 minutes. better-auth's
 *   own setPassword only skips its cookie cache; it would take a session
 *   that is days old.
 * - setPassword refuses an account that already has a password.
 * - The owner is emailed that a password was added, so a stolen session
 *   can't add one quietly.
 */
export function setPasswordHandler(auth: Pick<ReturnType<typeof createAuth>, "api" | "options">, { sendEmail, now = Date.now }: Deps) {
  const appOrigin = new URL(auth.options.baseURL as string).origin;
  return async function POST(request: Request): Promise<Response> {
    if (request.headers.get("origin") !== appOrigin)
      return refuse(403, "FORBIDDEN_ORIGIN", "This request has to come from UNTangle.");
    const mediaType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (mediaType !== "application/json") return refuse(415, "UNSUPPORTED_MEDIA_TYPE", "Send the password as JSON.");
    const body = (await request.json().catch(() => null)) as { newPassword?: unknown } | null;
    if (typeof body?.newPassword !== "string") return refuse(400, "INVALID_BODY", "Enter a password.");

    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return refuse(401, "UNAUTHORIZED", "Sign in first.");
    if (now() - new Date(session.session.createdAt).getTime() > SET_PASSWORD_MAX_SESSION_AGE_MS)
      return refuse(
        403,
        "SESSION_TOO_OLD",
        "For your safety, sign in again with a link, then set the password within 10 minutes.",
      );

    try {
      await auth.api.setPassword({ body: { newPassword: body.newPassword }, headers: request.headers });
    } catch (error) {
      if (error instanceof APIError) {
        const detail = error.body as { code?: string; message?: string } | undefined;
        return Response.json({ code: detail?.code, message: detail?.message ?? error.message }, { status: error.statusCode });
      }
      throw error;
    }
    try {
      await sendEmail("password-added", session.user.email, `${appOrigin}/forgot-password`);
    } catch (error) {
      // The password is set either way; a missing notice is logged, not shown as a failure.
      console.error("Password-added notice not sent.", error);
    }
    return Response.json({ status: true });
  };
}
