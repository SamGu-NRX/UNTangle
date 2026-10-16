import "server-only";

/**
 * The Postgres store behind the extension routes, as the route files import
 * it. The factory lives in store-core.ts without the server-only import so
 * the opt-in live-Postgres tests can construct the same store against a real
 * database; this module keeps the guard for every Next.js import graph.
 */
export { extensionStore } from "./store-core";
