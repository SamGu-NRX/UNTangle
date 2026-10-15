import type { createRateLimitWrapper } from "@/lib/rate-limit/wrapper";
import type { createDeviceHttp } from "./device-http";

export function createDeviceRouteHandlers(http: ReturnType<typeof createDeviceHttp>, limit: ReturnType<typeof createRateLimitWrapper>) {
  const finish = (handler: (request: Request) => Promise<Response>) => async (request: Request) => http.cors(request, await handler(request));
  return {
    start: finish(limit("deviceStart", http.handler("start"))),
    inspect: finish(limit("deviceInspect", http.handler("inspect"))),
    approve: finish(limit("deviceInspect", limit("deviceApprove", http.handler("approve")))),
    token: finish(limit("deviceToken", http.handler("token"))),
    refresh: finish(limit("deviceToken", http.handler("refresh"))),
    revoke: finish(limit("deviceToken", http.handler("revoke"))),
    options: http.options,
  };
}
