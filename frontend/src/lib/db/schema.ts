import { index, integer, jsonb, pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

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
  expiresAt: timestamp("expires_at").notNull(),
  claimedAt: timestamp("claimed_at").defaultNow().notNull(),
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

export const schema = {
  users,
  sessions,
  accounts,
  verifications,
  magicLinkClaims,
  plannerStates,
};
