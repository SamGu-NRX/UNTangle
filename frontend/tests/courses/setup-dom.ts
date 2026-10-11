/**
 * Shared happy-dom environment for mounted React tests in this directory.
 *
 * bun test runs every test file in ONE process with a shared module registry,
 * so each file must not create its own Window — swapping `document` mid-process
 * breaks react-dom's cached internals for later files. This module registers a
 * single happy-dom Window exactly once; import it before any React import.
 */
import { Window } from "happy-dom";

type TestWindow = Window & { document: Document };

const marker = "__untangleCoursesTestWindow" as const;
const holder = globalThis as unknown as Record<string, unknown>;

export const browserWindow = (holder[marker] as TestWindow | undefined) ?? new Window();

if (!holder[marker]) {
  holder[marker] = browserWindow;
  holder.window = browserWindow;
  holder.document = browserWindow.document;
  holder.HTMLElement = browserWindow.HTMLElement;
  holder.HTMLInputElement = browserWindow.HTMLInputElement;
  holder.HTMLTextAreaElement = browserWindow.HTMLTextAreaElement;
  holder.Element = browserWindow.Element;
  holder.Node = browserWindow.Node;
  holder.getComputedStyle = browserWindow.getComputedStyle.bind(browserWindow);
  holder.requestAnimationFrame = (cb: (time: number) => void) => setTimeout(() => cb(0), 0);
  holder.IS_REACT_ACT_ENVIRONMENT = true;
}

/** happy-dom's File constructor, typed loosely for synthetic test files. */
export const TestFile = (browserWindow as unknown as {
  File: new (parts: string[], name: string, options?: { type: string }) => File;
}).File;
