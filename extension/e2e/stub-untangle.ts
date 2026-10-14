/**
 * Contract-accurate local stub of the UNTangle API for the extension journey.
 *
 * It reproduces the guard semantics the real routes enforce - planner GET
 * gated on the Better Auth session cookie, POST requiring X-Planner-Base-
 * Revision (428 without it, 409 on a stale revision), ClassNumberMatch for
 * known class numbers, and HistoryResult envelopes from the grades routes -
 * so the journey exercises the extension's real client behavior offline.
 * Everything binds to localhost only.
 *
 * Run: bun --no-env-file extension/e2e/stub-untangle.ts
 */

const PORT = Number(process.env.STUB_PORT ?? 3217);
const SESSION_COOKIE = "better-auth.session_token";
const SESSION_VALUE = "journey-session-token";
/** The seeded Main schedule: CSCE 1040, MWF 9:30 AM - 10:20 AM, spring 2027. */
const SECTION_1040 = "vsb:spring-2027:CSCE 1040:10001";
const SMITH_ID = JSON.stringify(["John", "Smith"]);

let revision = 1;
let selectedSections: Record<string, string> = { "CSCE 1040": SECTION_1040 };
const observedWrites: Array<{ header: string | null; body: unknown }> = [];
/** Journey diagnostics: every request the stub sees. */
const requestLog: Array<{ method: string; path: string; cookie: boolean }> = [];

const gradesBlock = { gradeA: 18, gradeB: 4, gradeC: 1, gradeD: 1, gradeF: 0, gradeP: 0, gradeNP: 0, gradeW: 0, gradeWF: 0, gradeI: 0, gradePR: 0, gradeNPR: 0, gradeZ: 0, gradeSuppressed: 0, totalEnroll: 24 };

const smithHistory = {
  counts: { A: 18, B: 4, C: 1, D: 1 },
  total: 24,
  grades: gradesBlock,
  instructor: { id: SMITH_ID, firstName: "John", lastName: "Smith", name: "John Smith" },
  courses: [
    {
      counts: { A: 18, B: 4, C: 1, D: 1 },
      total: 24,
      grades: gradesBlock,
      course: { subject: "CSCE", number: "1030", title: "Computer Science I" },
      terms: [],
      sectionCount: 1,
      gpa: 3.4,
    },
  ],
};

function plannerState() {
  return {
    courseStatuses: {},
    selectedSections: { ...selectedSections },
    optimization: "compact",
    activeDay: "Mon",
    selectedMajor: null,
    transcriptRecords: [],
    updatedAt: new Date().toISOString(),
  };
}

function isSectionMap(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && Object.values(value).every(entry => typeof entry === "string");
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function hasSession(request: Request): boolean {
  const cookie = request.headers.get("cookie") ?? "";
  return cookie.split(";").some(part => part.trim() === `${SESSION_COOKIE}=${SESSION_VALUE}`);
}

const sessionPage = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="utf-8" /><title>UNTangle session</title></head>',
  "<body><p id=\"session\">Stub session established</p></body></html>",
].join("");

const classNumberMatches: Record<string, unknown> = {
  "14523": { term: "spring-2027", classNumber: "14523", courseCode: "CSCE 1030", sectionId: "vsb:spring-2027:CSCE 1030:001" },
  "15802": { term: "spring-2027", classNumber: "15802", courseCode: "ENGL 1310", sectionId: "vsb:spring-2027:ENGL 1310:005" },
  "16077": { term: "spring-2027", classNumber: "16077", courseCode: "CSCE 2100", sectionId: "vsb:spring-2027:CSCE 2100:004" },
};

const csce1040Sections = {
  term: "spring-2027",
  courseCode: "CSCE 1040",
  courseTitle: "Introductory Computer Science",
  sections: [
    {
      id: SECTION_1040,
      meetings: ["Mon", "Wed", "Fri"].map(day => ({
        day,
        startMinutes: 570,
        endMinutes: 620,
        dates: { start: "2027-01-19", end: "2027-05-07" },
        async: false,
        tba: false,
      })),
    },
  ],
};

Bun.serve({
  port: PORT,
  async fetch(request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/health") return json({ ok: true });
    if (pathname === "/__log") return json({ requests: requestLog });
    requestLog.push({ method: request.method, path: pathname, cookie: hasSession(request) });
    if (pathname === "/__observed") return json({ writes: observedWrites });
    if (pathname === "/session") {
      return new Response(sessionPage, {
        status: 200,
        headers: {
          "content-type": "text/html",
          // SameSite=None + Secure so the extension's service-worker fetches
          // carry it across origins; 127.0.0.1 is a trustworthy origin, so
          // the Secure attribute is honored over http.
          "set-cookie": `${SESSION_COOKIE}=${SESSION_VALUE}; Path=/; SameSite=None; Secure`,
        },
      });
    }

    if (pathname === "/api/planner") {
      if (!hasSession(request)) return json({ error: "Unauthorized" }, 401);
      if (request.method === "GET") {
        return json({ state: plannerState(), revision, persistent: true });
      }
      if (request.method === "POST") {
        const header = request.headers.get("X-Planner-Base-Revision");
        if (header === null || !/^\d+$/.test(header)) return json({ error: "Missing X-Planner-Base-Revision" }, 428);
        const body: unknown = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || !isSectionMap((body as Record<string, unknown>).selectedSections)) {
          return json({ error: "Invalid planner state" }, 422);
        }
        if (Number(header) !== revision) {
          return json({ error: "Stale revision", state: plannerState(), revision }, 409);
        }
        selectedSections = { ...(body as Record<string, unknown>).selectedSections as Record<string, string> };
        revision += 1;
        observedWrites.push({ header, body });
        return json({ state: plannerState(), revision, persistent: true });
      }
      return json({ error: "Method not allowed" }, 405);
    }

    const classMatch = pathname.match(/^\/api\/sections\/(spring|summer|fall)-\d{4}\/class\/\d{4,5}$/);
    if (classMatch && request.method === "GET") {
      const classNumber = pathname.split("/").at(-1) ?? "";
      const match = classNumberMatches[classNumber];
      return match ? json(match) : json({ error: "Not found" }, 404);
    }

    const sectionsMatch = pathname.match(/^\/api\/sections\/(spring|summer|fall)-\d{4}\/([A-Z]{2,4})\/(\d{4})$/);
    if (sectionsMatch && request.method === "GET") {
      if (sectionsMatch[2] === "CSCE" && sectionsMatch[3] === "1040") return json(csce1040Sections);
      return json({ error: "Not found" }, 404);
    }

    if (pathname === "/api/grades/search" && request.method === "GET") {
      const query = new URL(request.url).searchParams.get("q") ?? "";
      if (query.toLowerCase().includes("smith")) {
        return json({ status: "ok", source: "untgrades.app", data: { courses: [], instructors: [smithHistory.instructor] } });
      }
      return json({ status: "no-history", source: "untgrades.app", data: null });
    }

    const instructorMatch = pathname.match(/^\/api\/grades\/instructors\/(.+)$/);
    if (instructorMatch && request.method === "GET") {
      const id = decodeURIComponent(instructorMatch[1]);
      if (id === SMITH_ID) return json({ status: "ok", source: "untgrades.app", data: smithHistory });
      return json({ status: "no-history", source: "untgrades.app", data: null });
    }

    return json({ error: "Not found" }, 404);
  },
});

console.log(`stub-untangle listening on http://127.0.0.1:${PORT}`);
