/**
 * The root layout's client providers must render route segments on the
 * server. Next sets a 404 (with noindex) or a 307 with Location only when the
 * page's notFound() or redirect() error reaches the server render's shell; a
 * provider that renders nothing there swallows it and the response is a 200.
 *
 * This file has no DOM, like a real server. A page runs as a server component
 * and its error reaches the HTML render at the page's position in the tree;
 * `pageSegment` reproduces that by rendering the page's promise with use().
 */
import { expect, test } from "bun:test";
import { use, type ReactNode } from "react";
import { getAccessFallbackHTTPStatus, isHTTPAccessFallbackError } from "next/dist/client/components/http-access-fallback/http-access-fallback";
import { getRedirectStatusCodeFromError, getURLFromRedirectError } from "next/dist/client/components/redirect";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { pendSessionLookup, setSession } from "./test-dom";

function pageSegment(render: () => ReactNode | Promise<ReactNode>): ReactNode {
  const page = Promise.resolve().then(render);
  page.catch(() => {});
  function Segment() {
    return use(page);
  }
  return <Segment />;
}

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch: async () => {} };

/** The root layout's tree (app/layout.tsx) around one route segment, inside the router contexts Next provides. */
async function renderOnServer(segment: ReactNode): Promise<{ html: string; error: null } | { html: null; error: unknown }> {
  const { renderToReadableStream } = await import("react-dom/server");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { PathnameContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime");
  const { Providers } = await import("@/components/providers");
  const { AppShell } = await import("@/components/shell/AppShell");
  const tree = (
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value="/courses">
        <Providers>
          <AppShell>{segment}</AppShell>
        </Providers>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  );
  try {
    const stream = await renderToReadableStream(tree, { onError() {} });
    await stream.allReady;
    return { html: await new Response(stream).text(), error: null };
  } catch (error) {
    return { html: null, error };
  }
}

const sessions = [
  ["the first session lookup is pending", () => pendSessionLookup()],
  ["the visitor is a guest", () => setSession(null)],
  ["a student is signed in", () => setSession({ id: "server-a", email: "a@my.unt.edu", name: "A" })],
] as const;

for (const [label, session] of sessions) {
  for (const [subject, number] of [["ZZZZ", "9999"], ["CSCE", "3010"], ["%", "1030"]]) {
    test(`/courses/${subject}/${number} raises Next's 404 in the server render when ${label}`, async () => {
      session();
      const { default: CourseDeepLinkPage } = await import("@/app/courses/[subject]/[number]/page");
      const result = await renderOnServer(
        pageSegment(() =>
          CourseDeepLinkPage({ params: Promise.resolve({ subject, number }), searchParams: Promise.resolve({}) }),
        ),
      );
      expect(result.html).toBeNull();
      expect(isHTTPAccessFallbackError(result.error)).toBe(true);
      if (!isHTTPAccessFallbackError(result.error)) return;
      expect(getAccessFallbackHTTPStatus(result.error)).toBe(404);
    });
  }

  test(`/instructors/<id> raises Next's 307 redirect to /courses in the server render when ${label}`, async () => {
    session();
    const { default: InstructorRedirectPage } = await import("@/app/instructors/[id]/page");
    const result = await renderOnServer(pageSegment(() => InstructorRedirectPage()));
    expect(result.html).toBeNull();
    expect(isRedirectError(result.error)).toBe(true);
    if (!isRedirectError(result.error)) return;
    expect(getURLFromRedirectError(result.error)).toBe("/courses");
    expect(getRedirectStatusCodeFromError(result.error)).toBe(307);
  });

  test(`a page's planner views are in the server HTML, unprepared and loading, when ${label}`, async () => {
    session();
    const { usePlanner } = await import("@/components/planner-provider");
    function PlannerView() {
      const planner = usePlanner();
      const { identityReady, hydrated, plannerState } = planner;
      return <p>{`identityReady=${identityReady} hydrated=${hydrated} transcript=${plannerState.transcriptRecords.length}`}</p>;
    }
    const result = await renderOnServer(<PlannerView />);
    expect(result.error).toBeNull();
    expect(result.html).toContain("identityReady=false hydrated=false transcript=0");
  });
}
