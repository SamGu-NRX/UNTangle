"use client";

import { lazy, Suspense, useSyncExternalStore } from "react";
import { findModelContext } from "@/lib/webmcp/register";

const WebMcpBridge = lazy(() => import("./WebMcpBridge").then((module) => ({ default: module.WebMcpBridge })));
const subscribe = () => () => {};

/**
 * Mounted once by the app shell. In a browser with WebMCP it loads and
 * registers UNTangle's agent tools (lib/webmcp); anywhere else it renders
 * nothing and loads nothing.
 */
export function WebMcpTools() {
  const supported = useSyncExternalStore(subscribe, () => findModelContext() !== null, () => false);
  return supported ? (
    <Suspense fallback={null}>
      <WebMcpBridge />
    </Suspense>
  ) : null;
}
