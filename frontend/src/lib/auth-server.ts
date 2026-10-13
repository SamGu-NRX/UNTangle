import { headers } from "next/headers";
import { auth } from "@/lib/auth";

type Session = Awaited<ReturnType<typeof auth.api.getSession>>;
// withRateLimit and the route it wraps both ask for one request's session; the second ask reuses the first lookup.
const lookups = new WeakMap<Request, Promise<Session>>();

export async function getServerSession(request?: Request): Promise<Session> {
  if (!request) return auth.api.getSession({ headers: await headers() });
  let lookup = lookups.get(request);
  if (!lookup) lookups.set(request, (lookup = auth.api.getSession({ headers: request.headers })));
  return lookup;
}
