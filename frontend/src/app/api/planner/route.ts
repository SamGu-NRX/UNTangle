import { withRateLimit } from "@/lib/rate-limit/server";
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { hasDatabaseUrl } from "@/lib/db";
import { loadPlannerState, savePlannerState } from "@/lib/persistence";
import { normalizePlannerState } from "@/lib/planner";
import { validatePlannerStatePayload } from "@/lib/planner-validation";

export const runtime = "nodejs";

/**
 * The legacy planner row, kept for clients from before documents
 * (docs/architecture/README.md, "Migration"). Reads still answer; writes are
 * refused once the row has moved into documents.
 */
const BASE_REVISION_HEADER = "X-Planner-Base-Revision";

async function getPlanner(request: Request) {
  const session = await getServerSession(request);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const stored = await loadPlannerState(session.user.id);
    // `persistent: false` tells the client this deployment stores nothing
    // server-side, so a `Saved` acknowledgement must never be shown.
    return NextResponse.json({
      state: stored?.state ?? null,
      revision: stored?.revision ?? 0,
      persistent: hasDatabaseUrl,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load planner state" },
      { status: 500 },
    );
  }
}

/** A non-negative integer, or null when the header is missing or malformed. */
function parseBaseRevision(value: string | null): number | null {
  if (value === null || !/^\d{1,9}$/.test(value)) {
    return null;
  }
  return Number(value);
}

async function savePlanner(request: Request) {
  const session = await getServerSession(request);
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

  // Required, not defaulted: a save that does not say which revision it was
  // based on could silently overwrite a newer save from another tab.
  const baseRevision = parseBaseRevision(request.headers.get(BASE_REVISION_HEADER));
  if (baseRevision === null) {
    return NextResponse.json(
      { error: `${BASE_REVISION_HEADER} must be the revision this save is based on (0 when none was loaded).` },
      { status: 428 },
    );
  }

  try {
    const result = await savePlannerState(
      session.user.id,
      normalizePlannerState(validation.state),
      baseRevision,
    );
    if (result === null) {
      // No storage on this deployment: surfaces as `Not saved…` in the
      // client, never as a false `Saved`.
      return NextResponse.json({ state: null, persistent: false });
    }
    if (result.kind === "upgrade-required") {
      // Not 409: a client from before documents reads 409 as another tab's
      // save and offers to overwrite it. Any other error is a failed save it
      // keeps in memory and offers to retry.
      return NextResponse.json(
        { error: "UNTangle was updated. Reload to keep editing.", code: "UPGRADE_REQUIRED" },
        { status: 426 },
      );
    }
    if (result.kind === "conflict") {
      return NextResponse.json(
        {
          error: "A newer version of this schedule was saved from another tab or device.",
          state: result.current?.state ?? null,
          revision: result.current?.revision ?? 0,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ state: result.state, revision: result.revision, persistent: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save planner state" },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit("plannerRead", getPlanner);
export const POST = withRateLimit("plannerSave", savePlanner);
