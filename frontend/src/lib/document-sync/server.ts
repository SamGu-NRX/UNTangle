import { getServerSession } from "@/lib/auth-server";
import { db, hasDatabaseUrl } from "@/lib/db";
import { documentHandlers } from "./handlers";
import { documentRepository } from "./repository";

export const syncHandlers = documentHandlers({
  repository: documentRepository(db),
  session: getServerSession,
  origin: new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin,
  available: hasDatabaseUrl,
});
