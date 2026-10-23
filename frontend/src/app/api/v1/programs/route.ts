import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/rate-limit/server";
import { DEGREE_DATA } from "@/lib/degree/programs.generated";

export const runtime = "nodejs";

// Every generated program can be audited. The University Core is audited
// directly through /api/v1/programs/core/audit, and every major audit also
// returns the core audit beside it.

/**
 * The public program index for the degree audit: what can be audited and
 * where each requirement tree comes from. No student data — this route is
 * safe to call signed out.
 */
export const GET = withRateLimit("degreeAudit", () => {
  const programs = DEGREE_DATA.programs
    .map((program) => ({ id: program.id, name: program.name, sourceUrl: program.sourceUrl }));
  return NextResponse.json(
    {
      catalogId: DEGREE_DATA.catalogId,
      catalogYear: DEGREE_DATA.catalogYear,
      builtAt: DEGREE_DATA.builtAt,
      pages: DEGREE_DATA.pages.map((page) => ({
        file: page.file,
        url: page.url,
        title: page.title,
        capturedAt: page.capturedAt,
        sha256: page.sha256,
      })),
      programs,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});

