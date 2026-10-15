import { db, hasDatabaseUrl } from "@/lib/db";
import { authorizeV1 } from "@/server/auth/v1-runtime";
import { documentHandlers } from "./handlers";
import { documentRepository } from "./repository";

export const syncHandlers = documentHandlers({
  repository: documentRepository(db),
  authorize: authorizeV1,
  origin: new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin,
  available: hasDatabaseUrl,
});
