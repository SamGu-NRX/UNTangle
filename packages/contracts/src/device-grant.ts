import { z } from "zod";

export const deviceClientKind = z.enum(["mobile", "extension"]);
export const deviceScope = z.enum(["documents:read", "documents:write", "schedule:read", "schedule:add-option"]);
export type DeviceScope = z.infer<typeof deviceScope>;
export type DeviceClientKind = z.infer<typeof deviceClientKind>;
export const deviceScopes = {
  mobile: ["documents:read", "documents:write"],
  extension: ["schedule:read", "schedule:add-option"],
} as const satisfies Record<DeviceClientKind, readonly DeviceScope[]>;

const challenge = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const userCode = z.string().trim().toUpperCase().regex(/^[A-Z2-7]{8}$/);
export const startDeviceGrant = z.discriminatedUnion("clientKind", [
  z.object({ clientKind: z.literal("mobile"), codeChallenge: challenge, codeChallengeMethod: z.literal("S256") }).strict(),
  z.object({ clientKind: z.literal("extension"), codeChallenge: challenge, codeChallengeMethod: z.literal("S256"), scheduleId: z.string().min(1).max(200) }).strict(),
]);
export const deviceGrantStarted = z.object({ deviceCode: opaque, userCode, verificationUri: z.string().url(), expiresIn: z.number().int().positive(), interval: z.number().int().positive() }).strict();
export const inspectDeviceGrant = z.object({ userCode }).strict();
export const deviceGrantDetails = z.object({ clientKind: deviceClientKind, scopes: z.array(deviceScope), userCode, scheduleId: z.string().nullable() }).strict();
export const approveDeviceGrant = z.object({ userCode, expectedUserId: z.string().min(1).max(200), decision: z.enum(["approve", "deny"]) }).strict();
export const exchangeDeviceGrant = z.object({ deviceCode: opaque, codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/) }).strict();
export const refreshDeviceGrant = z.object({ refreshToken: opaque }).strict();
export const deviceTokenResponse = z.object({ accessToken: opaque, refreshToken: opaque, tokenType: z.literal("Bearer"), expiresIn: z.number().int().positive(), scopes: z.array(deviceScope), grantId: z.string() }).strict();
export const deviceGrantError = z.object({ error: z.enum(["invalid_request", "invalid_grant", "authorization_pending", "access_denied", "expired_token", "invalid_token", "insufficient_scope", "ambiguous_credentials", "forbidden_origin", "unauthorized", "account_changed", "rate_limited", "unavailable"]) }).strict();
export type DeviceGrantErrorCode = z.infer<typeof deviceGrantError>["error"];
export type StartDeviceGrant = z.infer<typeof startDeviceGrant>;
export type DeviceTokenResponse = z.infer<typeof deviceTokenResponse>;
