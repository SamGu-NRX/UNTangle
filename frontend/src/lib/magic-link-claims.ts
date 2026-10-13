import { createHash } from "node:crypto";

/**
 * Makes a sign-in link single-use under concurrency. better-auth's verify
 * reads the token's attempt count and then updates it, so two requests that
 * arrive together both pass and both get a session. A claim is one atomic
 * insert keyed by the token's hash: exactly one request can win it, and the
 * hook in auth-config.ts refuses the rest before a session is made.
 */
export interface MagicLinkClaims {
  /** True for exactly one caller per token hash; claims expire with their link and are pruned after. */
  claim(tokenHash: string, expiresAt: Date): Promise<boolean>;
}

/** The identifier better-auth stores for a hashed magic-link token: SHA-256, base64url without padding. */
export function hashMagicLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** In one process: the check and the insert run with no await between. Tests, and development without a database. */
export function memoryClaims(): MagicLinkClaims {
  const claimed = new Map<string, number>();
  return {
    async claim(tokenHash, expiresAt) {
      const now = Date.now();
      for (const [hash, until] of claimed) if (until < now) claimed.delete(hash);
      if (claimed.has(tokenHash)) return false;
      claimed.set(tokenHash, expiresAt.getTime());
      return true;
    },
  };
}

/** The slice of a SQL client this needs: run one statement, get its rows back. */
export type SqlRunner = (statement: string, params: unknown[]) => Promise<{ rows: unknown[] }>;

/**
 * Postgres: INSERT … ON CONFLICT DO NOTHING RETURNING is the claim (one row
 * back for the winner, none for everyone else, across server instances).
 * Expired claims are pruned on the way in.
 */
export function postgresClaims(run: SqlRunner): MagicLinkClaims {
  return {
    async claim(tokenHash, expiresAt) {
      await run("DELETE FROM magic_link_claim WHERE expires_at < now()", []);
      const { rows } = await run(
        "INSERT INTO magic_link_claim (token_hash, expires_at) VALUES ($1, $2) ON CONFLICT (token_hash) DO NOTHING RETURNING token_hash",
        [tokenHash, expiresAt],
      );
      return rows.length === 1;
    },
  };
}
