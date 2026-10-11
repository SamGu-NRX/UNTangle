import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { hasDatabaseUrl } from "@/lib/db";
import { loadPlannerState, savePlannerState } from "@/lib/persistence";
import { normalizePlannerState } from "@/lib/planner";
import { validatePlannerStatePayload } from "@/lib/planner-validation";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const state = await loadPlannerState(session.user.id);
    // `persistent: false` tells the client this deployment stores nothing
    // server-side, so a `Saved` acknowledgement must never be shown.
    return NextResponse.json({ state, persistent: hasDatabaseUrl });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load planner state" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const validation = validatePlannerStatePayload(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  try {
    const state = await savePlannerState(session.user.id, normalizePlannerState(validation.state));
    // `state: null` (no storage on this deployment) surfaces as `Not saved…`
    // in the client, never as a false `Saved`.
    return NextResponse.json({ state, persistent: state !== null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save planner state" },
      { status: 500 },
    );
  }
}
