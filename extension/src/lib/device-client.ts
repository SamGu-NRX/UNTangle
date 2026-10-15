import { UNTANGLE_ORIGIN } from "../config";
import { isGrant, isRecord, type DeviceGrant } from "../shared/extension-api";
import type { FetchLike } from "./planner-client";
import { StudentError } from "../shared/student-error";
export interface AuthBrowser {
  redirectUri: string;
  launch(url: string): Promise<string>;
}
function randomSecret(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export class DeviceClient {
  constructor(private readonly fetchImpl: FetchLike, private readonly browser: AuthBrowser, private readonly base = UNTANGLE_ORIGIN) { }
  async signIn(): Promise<DeviceGrant> {
    const verifier = randomSecret();
    const state = randomSecret();
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const response = await this.fetchImpl(`${this.base}/api/v1/devices/authorize`, {
      method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "extension", redirectUri: this.browser.redirectUri, state, codeChallenge: challenge, codeChallengeMethod: "S256" }),
    });
    if (!response.ok)
      throw new StudentError("Couldn't start sign-in. Check your connection and retry.");
    const authorization: unknown = await response.json();
    if (!isRecord(authorization) || typeof authorization.authorizationUrl !== "string")
      throw new Error("Invalid device authorization response");
    const url = new URL(authorization.authorizationUrl);
    if (url.origin !== new URL(this.base).origin || url.username || url.password)
      throw new Error("Untrusted authorization URL");
    const callback = new URL(await this.browser.launch(url.href));
    const redirect = new URL(this.browser.redirectUri);
    if (callback.origin !== redirect.origin || callback.pathname !== redirect.pathname || callback.hash || callback.searchParams.getAll("state").length !== 1 || callback.searchParams.get("state") !== state)
      throw new Error("Invalid sign-in state or redirect");
    const code = callback.searchParams.get("code");
    if (!code || callback.searchParams.getAll("code").length !== 1 || code.length > 2048)
      throw new Error("Missing sign-in code");
    const exchange = await this.fetchImpl(`${this.base}/api/v1/devices/token`, {
      method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "extension", code, codeVerifier: verifier, redirectUri: this.browser.redirectUri }),
    });
    if (!exchange.ok)
      throw new StudentError("That sign-in expired. Sign in again.");
    const grant: unknown = await exchange.json();
    if (!isGrant(grant) || grant.expiresAt <= Date.now())
      throw new Error("Invalid device grant response");
    return grant;
  }
}
