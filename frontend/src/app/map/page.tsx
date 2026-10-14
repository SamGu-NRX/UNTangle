import { redirect } from "next/navigation";
import { withQuery } from "@/components/shell/routes";

/**
 * "Day" replaced "Map" (docs/design/untangle-v3.md). Old links keep working,
 * query included. Temporary, not permanent: if "Day" tests poorly the name
 * may come back, and a browser-cached permanent redirect could not be undone.
 */
export default async function MapRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(withQuery("/day", await searchParams));
}
