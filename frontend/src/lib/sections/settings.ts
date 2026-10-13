import "server-only";
import { createSectionsConfig } from "./config";

// A runtime config endpoint shares this one mode value with the browser.
export const sectionsConfig = createSectionsConfig({ mode: process.env.SECTIONS_MODE });
