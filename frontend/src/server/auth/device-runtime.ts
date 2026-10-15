import { db } from "@/lib/db";
import { createDeviceGrants } from "./device-grants";
import { postgresDeviceStore } from "./device-postgres";

export const deviceGrants = createDeviceGrants(postgresDeviceStore(db));
export const bumpSecurityGeneration = deviceGrants.bumpSecurityGeneration;
export const readSecurityGeneration = deviceGrants.readSecurityGeneration;
export const beginSecurityChange = deviceGrants.beginSecurityChange;
export const writeCredential = deviceGrants.writeCredential;
export const endStaleSession = deviceGrants.endStaleSession;
export const finishSecurityChange = deviceGrants.finishSecurityChange;
