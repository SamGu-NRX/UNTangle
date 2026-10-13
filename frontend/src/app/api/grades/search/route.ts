import { gradesHistory } from "@/lib/grades-history";
import { createGradesHandlers } from "@/lib/grades-history/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createGradesHandlers(gradesHistory);
export const GET = handlers.search;
