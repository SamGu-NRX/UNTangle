import { redirect } from "next/navigation";
import { withQuery } from "@/components/shell/routes";

/**
 * "Schedules" replaced "Plans" (docs/design/untangle-v3.md). Temporary for
 * the same reason as /map: a cached permanent redirect could not be undone.
 */
export default async function PlansRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(withQuery("/schedules", await searchParams));
}
