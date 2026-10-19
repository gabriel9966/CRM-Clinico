import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["quickjs-emscripten", "quickjs-emscripten-core"],
  /* config options here */
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
