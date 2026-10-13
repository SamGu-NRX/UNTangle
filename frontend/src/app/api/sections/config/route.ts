import { sectionsConfig } from "@/lib/sections/settings";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() { return Response.json(sectionsConfig, { headers: { "Cache-Control": "no-store" } }); }
