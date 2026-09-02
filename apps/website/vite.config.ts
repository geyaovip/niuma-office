import { defineConfig } from "vite";
import { resolve } from "node:path";
import { notFoundRoute, publicRoutes } from "./site.routes.mjs";

export default defineConfig({
  build: {
    rollupOptions: {
      input: Object.fromEntries(
        [...publicRoutes, notFoundRoute].map(({ key, file }) => [
          key,
          resolve(__dirname, file),
        ]),
      ),
    },
  },
});
