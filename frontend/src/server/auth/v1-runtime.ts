import { getServerSession } from "@/lib/auth-server";
import { deviceGrants } from "./device-runtime";
import { createV1Auth } from "./v1-auth";

// Its own module so /api/v1 routes don't load the device endpoints' config,
// which throws at import on a malformed DEVICE_EXTENSION_ORIGINS. The session
// lookup is memoized per request, so it is shared with withRateLimit.
export const authorizeV1 = createV1Auth(deviceGrants, getServerSession);
