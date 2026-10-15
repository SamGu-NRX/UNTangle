import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, boolean, bigint, primaryKey } from "drizzle-orm/pg-core";

export const users = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const sessions = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const accounts = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verifications = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

/**
 * One row per magic-link token that has been used: the atomic claim that
 * keeps a link single-use under concurrent verifies (lib/magic-link-claims.ts).
 * Rows are pruned after the link would have expired.
 */
export const magicLinkClaims = pgTable("magic_link_claim", {
  tokenHash: text("token_hash").primaryKey(),
  // With time zone: node-postgres sends Dates in the server's local zone, so a
  // plain timestamp compared with now() breaks when Node and Postgres differ.
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).defaultNow().notNull(),
});

export const plannerStates = pgTable("planner_state", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  courseStatuses: jsonb("course_statuses").notNull(),
  selectedSections: jsonb("selected_sections").notNull(),
  optimization: text("optimization").notNull(),
  activeDay: text("active_day").notNull(),
  selectedMajor: text("selected_major"),
  transcriptRecords: jsonb("transcript_records").default([]).notNull(),
  routeStops: jsonb("route_stops").notNull(),
  // Course code -> pinned section id. Rows from before locks default to none.
  lockedSections: jsonb("locked_sections").default({}).notNull(),
  // Courses-view facts kept with the plan (manual credit, Auto provenance and
  // the last Auto run). Null on rows from before it existed; normalize fills it.
  coursePlan: jsonb("course_plan"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // Bumped on every write. A save names the revision it started from and is
  // refused when the row moved on, so a stale tab cannot overwrite newer data.
  // Default 1 so rows written before this column existed count as written
  // once; 0 is reserved for "no row yet".
  revision: integer("revision").default(1).notNull(),
});

// One fixed-window counter per route class and caller. Route classes can have different window
// lengths, so each row carries its own expiry (epoch ms) and cleanup deletes by that.
export const apiRateLimits = pgTable("api_rate_limit", {
  windowIndex: integer("window_index").notNull(),
  route: text("route").notNull(),
  caller: text("caller").notNull(),
  count: integer("count").notNull(),
  // 0 for rows written before this column: already expired, swept on the next pass.
  expiresAt: bigint("expires_at", { mode: "number" }).default(0).notNull(),
}, (table) => [primaryKey({ columns: [table.windowIndex, table.route, table.caller] })]);

// better-auth's own limiter counts here when its storage is "database".
export const authRateLimits = pgTable("auth_rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
}, (table) => [index("auth_rate_limit_last_request_idx").on(table.lastRequest)]);

export const gradesHistoryCache = pgTable("grades_history_cache", {
  key: text("key").primaryKey(),
  // The envelope holds JSON null for confirmed absence without using SQL NULL.
  record: jsonb("record").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// Every untgrades caller locks the same row before checking or spending the budget.
export const gradesHistoryBudget = pgTable("grades_history_budget", {
  source: text("source").primaryKey(),
  nextPermitAt: timestamp("next_permit_at", { withTimezone: true }).notNull(),
  cooldownUntil: timestamp("cooldown_until", { withTimezone: true }).notNull(),
  sentAt: bigint("sent_at", { mode: "number" }).array().notNull(),
});

export const documents = pgTable("documents", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  id: text("id").notNull(),
  kind: text("kind").notNull(),
  institutionId: text("institution_id").notNull(),
  revision: integer("revision").notNull(),
  body: jsonb("body"),
  deleted: boolean("deleted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.id] }),
  check("documents_kind", sql`${table.kind} in ('academic-record', 'schedule', 'preferences')`),
  check("documents_revision", sql`${table.revision} > 0`),
  check("documents_tombstone", sql`${table.deleted} = (${table.body} is null)`),
]);

export const receipts = pgTable("receipts", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  operationId: text("operation_id").notNull(),
  writeSha256: text("write_sha256").notNull(),
  committedRevision: integer("committed_revision").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.operationId] }),
  check("receipts_hash", sql`${table.writeSha256} ~ '^[0-9a-f]{64}$'`),
  check("receipts_revision", sql`${table.committedRevision} > 0`),
]);

// Versions have no update path. The migration also rejects direct SQL updates.
export const versions = pgTable("versions", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  id: text("id").notNull(),
  institutionId: text("institution_id").notNull(),
  scheduleId: text("schedule_id").notNull(),
  reason: text("reason").notNull(),
  body: jsonb("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.id] }),
  index("versions_user_created_idx").on(table.userId, table.createdAt.desc(), table.id.desc()),
  index("versions_schedule_created_idx").on(table.userId, table.scheduleId, table.createdAt.desc(), table.id.desc()),
  check("versions_reason", sql`${table.reason} in ('before-auto', 'restore-point', 'import')`),
]);

export const schema = {
  users,
  sessions,
  accounts,
  verifications,
  magicLinkClaims,
  plannerStates,
  apiRateLimits,
  authRateLimits,
  gradesHistoryCache,
  gradesHistoryBudget,
  documents,
  receipts,
  versions,
};
