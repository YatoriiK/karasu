import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";

const woff2Only: Plugin = {
  name: "woff2-only",
  enforce: "pre",
  transform(code, id) {
    if (id.includes("@fontsource") && id.split("?")[0].endsWith(".css")) {
      return code.replace(/,\s*url\([^)]*\.woff\)\s*format\(["']woff["']\)/g, "");
    }
  },
};

export default defineConfig({
  plugins: [woff2Only, react(), tailwindcss()],
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:8765", changeOrigin: false } },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
