import { VERIFY_PATH } from "./magic-link-url";
import type { createRateLimitWrapper } from "./rate-limit/wrapper";

type Handler = (request: Request) => Promise<Response>;

export function authGetHandler(handler: Handler, withRateLimit: ReturnType<typeof createRateLimitWrapper>): Handler {
  const verify = withRateLimit("auth", handler);
  return (request) => {
    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    // Session polling must not spend the shared IP budget needed to sign in.
    return path === VERIFY_PATH ? verify(request) : handler(request);
  };
}
