import "server-only";
import path from "node:path";
import { GradesMcpClient } from "./client";
import { GradesDiskCache } from "./cache";
import { GradesHistoryService } from "./service";

export const gradesHistory = new GradesHistoryService(new GradesMcpClient(), new GradesDiskCache(path.join(process.cwd(), ".grades-history-cache")));
