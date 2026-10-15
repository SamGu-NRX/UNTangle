import { authSecret } from "@/lib/auth";
import { getServerSession } from "@/lib/auth-server";
import { db } from "@/lib/db";
import { createRateLimitWrapper, createUserLimit } from "./wrapper";
import { memoryStore, postgresStore } from "./store";

export { createRateLimitWrapper };

const store = process.env.NODE_ENV === "production" ? postgresStore(db) : memoryStore();

export const withRateLimit = createRateLimitWrapper({ store, session: getServerSession, secret: authSecret });
export const limitUser = createUserLimit({ store, secret: authSecret });
