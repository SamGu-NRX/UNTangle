import { APIError } from "better-auth/api";
import type { createAuth } from "@/lib/auth-config";

/**
 * "Set a password" for a signed-in account that has none. better-auth's
 * setPassword is server-only (it has no public endpoint), so this wraps it
 * in the app's own POST /api/account/set-password.
 *
 * better-auth's origin check doesn't run for server-side calls, so this
 * route does its own: the request must come from the app's origin with a
 * JSON body (a cross-site form can't send that without a preflight).
 * setPassword itself needs a fresh session and refuses an account that
 * already has a password.
 */
export function setPasswordHandler(auth: Pick<ReturnType<typeof createAuth>, "api" | "options">) {
  const appOrigin = new URL(auth.options.baseURL as string).origin;
  return async function POST(request: Request): Promise<Response> {
    if (request.headers.get("origin") !== appOrigin)
      return Response.json({ code: "FORBIDDEN_ORIGIN", message: "This request has to come from UNTangle." }, { status: 403 });
    if (!request.headers.get("content-type")?.includes("application/json"))
      return Response.json({ code: "UNSUPPORTED_MEDIA_TYPE", message: "Send the password as JSON." }, { status: 415 });
    const body = (await request.json().catch(() => null)) as { newPassword?: unknown } | null;
    if (typeof body?.newPassword !== "string")
      return Response.json({ code: "INVALID_BODY", message: "Enter a password." }, { status: 400 });
    try {
      await auth.api.setPassword({ body: { newPassword: body.newPassword }, headers: request.headers });
      return Response.json({ status: true });
    } catch (error) {
      if (error instanceof APIError) {
        const detail = error.body as { code?: string; message?: string } | undefined;
        return Response.json({ code: detail?.code, message: detail?.message ?? error.message }, { status: error.statusCode });
      }
      throw error;
    }
  };
}
