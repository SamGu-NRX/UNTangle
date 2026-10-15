import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  devIndicators: false,
  // @untangle/core ships TypeScript source (its export map points at src/*.ts),
  // so Next has to compile it rather than load it as a prebuilt package.
  transpilePackages: ["@untangle/core"],
  turbopack: {
    root: path.join(currentDirectory, ".."),
  },
};

export default nextConfig;
