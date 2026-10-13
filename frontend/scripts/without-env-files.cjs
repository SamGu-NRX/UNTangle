// Next.js 16 reads files before checking __NEXT_PROCESSED_ENV. This preload
// replaces its loader for verification runs that prohibit environment-file access.
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const exports = originalLoad.call(this, request, parent, isMain);
  if (request === "@next/env" || request.endsWith("/@next/env/dist/index.js")) {
    return {
      ...exports,
      loadEnvConfig: () => ({ combinedEnv: process.env, parsedEnv: undefined, loadedEnvFiles: [] }),
    };
  }
  return exports;
};
