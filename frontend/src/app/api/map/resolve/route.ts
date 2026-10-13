import { withRateLimit } from "@/lib/rate-limit/server";
import { NextResponse } from "next/server";
import { campuses, campusById } from "@/lib/campus/config";
import { createResolveHandler } from "@/lib/campus/resolve-handler";
export const runtime = "nodejs";
const handlers = new Map(campuses.map((c) => [c.id, createResolveHandler(c)]));
function resolve(request: Request) {
  try {
    const campus = campusById(new URL(request.url).searchParams.get("campus"));
    return handlers.get(campus.id)!(request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid campus" },
      { status: 400 },
    );
  }
}

export const POST = withRateLimit("mapResolve", resolve, undefined, (request) => {
  // Preserve independent campus windows; aliases resolve to the same configured id.
  try { return campusById(new URL(request.url).searchParams.get("campus")).id; }
  catch { return "invalid-campus"; }
});
