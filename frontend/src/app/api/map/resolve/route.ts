import { activeCampus } from "@/lib/campus/config";
import { createResolveHandler } from "@/lib/campus/resolve-handler";

export const runtime = "nodejs";

export const POST = createResolveHandler(activeCampus);
