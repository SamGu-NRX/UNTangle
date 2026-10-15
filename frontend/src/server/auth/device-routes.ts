import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limit/server";
import { createDeviceHttp } from "./device-http";
import { deviceGrants } from "./device-runtime";
import { createDeviceRouteHandlers } from "./device-handlers";

const session = (request: Request) => auth.api.getSession({ headers: request.headers });
const http = createDeviceHttp({ grants: deviceGrants, origin: auth.options.baseURL as string, extensionOrigins: (process.env.DEVICE_EXTENSION_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean), session });
const routes = createDeviceRouteHandlers(http, withRateLimit);
export const deviceOptions = routes.options;
export const deviceStart = routes.start;
export const deviceInspect = routes.inspect;
export const deviceApprove = routes.approve;
export const deviceToken = routes.token;
export const deviceRefresh = routes.refresh;
export const deviceRevoke = routes.revoke;
