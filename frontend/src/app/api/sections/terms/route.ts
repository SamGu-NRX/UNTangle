import { sectionSource } from "@/lib/sections/server";
import { createSectionsHandlers } from "@/lib/sections/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createSectionsHandlers(sectionSource);
export async function GET() { return handlers.terms(); }
