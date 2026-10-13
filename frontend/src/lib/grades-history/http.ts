import type { GradesHistoryService } from "./service";
import { failure } from "./service";
import { GradesError } from "./errors";
import type { HistoryResult } from "./types";

function response<T>(result: HistoryResult<T>) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (result.status === "unavailable" && result.error.retryAfterSeconds !== undefined) headers["Retry-After"] = String(result.error.retryAfterSeconds);
  return Response.json(result, { status: result.status === "unavailable" && result.error.reason === "invalid-request" ? 400 : 200, headers });
}
export function createGradesHandlers(service: GradesHistoryService) {
  return {
    course: async (subject: string, number: string) => response(await service.getCourseHistory(subject, number)),
    instructor: async (id: string) => {
      const parts = id.split(",");
      if (parts.length !== 2) return response(failure(new GradesError("invalid-request", "Instructor id must be LastName,FirstName as returned by search")));
      return response(await service.getInstructorHistory(parts[1], parts[0]));
    },
    instructorByName: async (request: Request) => {
      const params = new URL(request.url).searchParams;
      return response(await service.getInstructorHistory(params.get("firstName") ?? "", params.get("lastName") ?? ""));
    },
    search: async (request: Request) => response(await service.searchGrades(new URL(request.url).searchParams.get("q") ?? "")),
  };
}
