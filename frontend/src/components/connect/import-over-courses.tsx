"use client";

import { useEffect } from "react";
import { CoursesView } from "@/components/courses/CoursesView";
import { OPEN_CONNECT_EVENT } from "./open-connect";

/**
 * /courses/import: the Courses view with the Connect sheet opened over it.
 * The history becomes /courses (this view) then /connect (the sheet), so
 * Back or closing the sheet lands on Courses.
 *
 * Deferred by a task: on a cold load this effect runs before the router's
 * own effects patch the history API and before the shell's ConnectHost
 * listens, and an early pushState would move the URL without Next noticing.
 * The event is sent directly, not through openConnect(), whose fallback
 * navigates here and would loop.
 */
export function ImportOverCourses() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.history.replaceState(null, "", "/courses");
      window.dispatchEvent(new Event(OPEN_CONNECT_EVENT, { cancelable: true }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  return <CoursesView />;
}
