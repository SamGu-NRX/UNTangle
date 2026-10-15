/**
 * useCampusEvents: a failing feed shows nothing, and an answer that lands
 * while the student is using the list waits for the next time Day shows
 * that date instead of pushing rows in under them.
 */
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { installDom, mount, removeDom } from "../ui/dom";

const realFetch = globalThis.fetch;
beforeAll(() => {
  installDom();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  removeDom();
});

const answer = {
  events: [
    {
      sourceId: "student_organizations",
      url: "https://calendar.unt.edu/event/club",
      title: "Club meeting",
      start: "2026-10-20T15:15:00.000Z",
      end: "2026-10-20T15:45:00.000Z",
      isAllDay: false,
      location: "University Union, 401",
      buildingId: "uu",
      tags: [],
    },
  ],
};

/** A fetch that answers once the test lets it, and counts its calls. */
function deferredFetch(response: () => Response) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    await gate;
    return response();
  }) as typeof fetch;
  return { calls, release };
}

async function harness(busy: { current: boolean }) {
  const { useCampusEvents } = await import("@/components/map/use-campus-events");
  function Probe({ date }: { date: string | null }) {
    const events = useCampusEvents(date, () => busy.current);
    return <p data-probe="">{events === null ? "none" : events.map((event) => event.title).join(",")}</p>;
  }
  return Probe;
}

const text = (container: HTMLElement) => container.querySelector("[data-probe]")?.textContent;

test("a failing feed shows nothing", async () => {
  const { act } = await import("react");
  const feed = deferredFetch(() => new Response("{}", { status: 503 }));
  const Probe = await harness({ current: false });
  const view = await mount(<Probe date="2026-10-19" />);
  await act(async () => {
    feed.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(feed.calls[0]).toContain("/api/v1/events?from=2026-10-19T05%3A00%3A00.000Z&to=2026-10-20T05%3A00%3A00.000Z");
  expect(text(view.container)).toBe("none");
  await view.unmount();
});

test("an answer landing while the list is in use waits for the next visit to that date", async () => {
  const { act } = await import("react");
  const busy = { current: false };
  const feed = deferredFetch(() => Response.json(answer));
  const Probe = await harness(busy);
  const view = await mount(<Probe date="2026-10-20" />);
  // The student selects something before the feed answers.
  busy.current = true;
  await act(async () => {
    feed.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(text(view.container)).toBe("none");

  // Another day, then back: the kept answer shows at once, with no second request.
  await view.rerender(<Probe date={null} />);
  await view.rerender(<Probe date="2026-10-20" />);
  expect(text(view.container)).toBe("Club meeting");
  expect(feed.calls.length).toBe(1);
  await view.unmount();
});
