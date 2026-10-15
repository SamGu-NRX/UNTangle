import "server-only";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { sectionsProxy } from "@/lib/sections/server";
import { deviceGrants } from "@/server/auth/device-runtime";
import { createExtensionHttp } from "./http";
import { extensionStore } from "./store";

/** One instance per process, wired like the device routes: real grants, the
 * sections proxy, and the document-sync write path. */
export const extensionHttp = createExtensionHttp({
  grants: deviceGrants,
  store: extensionStore(db),
  sections: sectionsProxy,
  origin: auth.options.baseURL as string,
  extensionOrigins: (process.env.DEVICE_EXTENSION_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
});
