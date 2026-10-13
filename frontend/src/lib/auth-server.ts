import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export async function getServerSession(request?: Request) {
  return auth.api.getSession({
    headers: request?.headers ?? await headers(),
  });
}
