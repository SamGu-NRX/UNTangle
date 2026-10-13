import courseFixture from "./fixtures/course.json";
import instructorFixture from "./fixtures/instructor.json";
import searchFixture from "./fixtures/search.json";
import searchCourseFixture from "./fixtures/search-course.json";
import toolsFixture from "./fixtures/tools.json";
import missingFixture from "./fixtures/missing.json";
import instructorMissingFixture from "./fixtures/instructor-missing.json";
import { object } from "@/lib/grades-history/client";
import { integer, text } from "@/lib/grades-history/parse";

export type FakeReply = { status?: number; retryAfter?: string; body?: string; json?: unknown; sse?: boolean };
export type FakeOptions = {
  pageSize?: number;
  instructorCourseOnly?: boolean;
  replies?: FakeReply[];
  transform?: (result: Record<string, unknown>, request: { method: string; name: string; offset: number }) => Record<string, unknown>;
};

export function startFakeMcp(options: FakeOptions = {}) {
  const requests: Array<{ method: string; name: string; args: Record<string, unknown> }> = [];
  const replies = [...(options.replies ?? [])];
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const rpc = object(await request.json(), "fake request");
      const method = text(rpc.method, "method");
      const params = object(rpc.params, "params");
      const name = method === "tools/call" ? text(params.name, "name") : "";
      const args = method === "tools/call" ? object(params.arguments, "arguments") : {};
      requests.push({ method, name, args });
      const injected = replies.shift();
      const headers: Record<string, string> = {};
      if (injected?.retryAfter !== undefined) headers["Retry-After"] = injected.retryAfter;
      if (injected?.body !== undefined) return new Response(injected.body, { status: injected.status ?? 200, headers });
      if (injected?.status && injected.status !== 200) return new Response("injected upstream failure", { status: injected.status, headers });
      const offset = args.offset === undefined ? 0 : integer(args.offset, "offset");
      const limit = Math.min(args.limit === undefined ? 25 : integer(args.limit, "limit"), options.pageSize ?? 50);
      let result: Record<string, unknown>;
      if (injected && "json" in injected) return Response.json(injected.json, { headers });
      if (method === "tools/list") result = toolsFixture.result;
      else if (name === "get_course_grades") {
        if (args.prefix !== "CSCE" || args.number !== "1030") result = missingFixture.result;
        else {
          const data = courseFixture.result.structuredContent;
          const sections = data.sections.slice(offset, offset + limit);
          const nextOffset = offset + sections.length < data.totalSections ? offset + sections.length : null;
          result = { content: [{ type: "text", text: "replayed fixture" }], structuredContent: { ...data, offset, nextOffset, sections } };
        }
      } else if (name === "get_instructor_courses") {
        if (args.firstName !== "Pradhumna Lal" || args.lastName !== "Shrestha") {
          const data = instructorMissingFixture.result.structuredContent;
          result = { content: [{ type: "text", text: "replayed empty fixture" }], structuredContent: { ...data, firstName: args.firstName, lastName: args.lastName } };
        } else {
          const data = instructorFixture.result.structuredContent;
          const all = options.instructorCourseOnly ? data.courses.slice(0, 1) : data.courses;
          const courses = all.slice(offset, offset + limit);
          result = { content: [{ type: "text", text: "replayed fixture" }], structuredContent: { ...data, totalCourses: all.length, offset, nextOffset: offset + courses.length < all.length ? offset + courses.length : null, courses } };
        }
      } else if (name === "search_grades") {
        result = args.query === "Shrestha" ? searchFixture.result : args.query === "CSCE 1030" ? searchCourseFixture.result : { content: [{ type: "text", text: '{"courses":[],"instructors":[]}' }] };
      } else return Response.json({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Unknown tool" } });
      result = options.transform?.(result, { method, name, offset }) ?? result;
      const envelope = { jsonrpc: "2.0", id: rpc.id, result };
      const sse = injected?.sse ?? true;
      return sse ? new Response(`event: message\ndata: ${JSON.stringify(envelope)}\n\n`, { headers: { "Content-Type": "text/event-stream" } }) : Response.json(envelope);
    },
  });
  return { endpoint: new URL("/api/mcp", server.url).href, requests, stop: () => server.stop(true) };
}

// A local replay can be run without contacting untgrades.app.
if (import.meta.main) {
  const fake = startFakeMcp();
  console.log(fake.endpoint);
}
