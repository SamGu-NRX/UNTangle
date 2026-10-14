/**
 * Babel config for the mobile app. The module-resolver aliases must stay in
 * lockstep with tsconfig paths and the Jest moduleNameMapper: @/lib points at
 * the shared pure TypeScript modules of the web frontend, imported in place.
 */
const path = require("path");

const frontendLib = path.resolve(__dirname, "../frontend/src/lib");

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      [
        "babel-plugin-module-resolver",
        {
          // Plain prefix aliases: module-resolver rewrites the prefix and keeps
          // the rest of the specifier as a relative path, which Metro, Jest,
          // and tsc all resolve with normal extension handling.
          alias: {
            "@/lib": frontendLib,
            "@/assets": path.resolve(__dirname, "assets"),
            "@": path.resolve(__dirname, "src"),
          },
        },
      ],
    ],
  };
};
