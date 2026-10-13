import { authSecret } from "@/lib/auth";
import { getServerSession } from "@/lib/auth-server";
import { db } from "@/lib/db";
import { createRateLimitWrapper } from "./wrapper";
import { memoryStore, postgresStore } from "./store";

export { createRateLimitWrapper };

export const withRateLimit = createRateLimitWrapper({
  store: process.env.NODE_ENV === "production" ? postgresStore(db) : memoryStore(),
  session: getServerSession,
  secret: authSecret,
});
