import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { loadPlannerState, savePlannerState } from "@/lib/persistence";
import { normalizePlannerState } from "@/lib/planner";
import type { PlannerState } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const state = await loadPlannerState(session.user.id);
    return NextResponse.json({ state });
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

  try {
    const body = (await request.json()) as PlannerState;
    const state = await savePlannerState(session.user.id, normalizePlannerState(body));
    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save planner state" },
      { status: 500 },
    );
  }
}
