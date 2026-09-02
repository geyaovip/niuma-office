import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  optimizeDeps: {
    include: ["react", "react-dom/client", "@phosphor-icons/react"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: { clientFiles: ["./src/main.tsx"] },
  },
  plugins: [react()],
});
