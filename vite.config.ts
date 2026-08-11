import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    assetsInlineLimit: 0,
    emptyOutDir: false,
    outDir: "../../dist/renderer",
  },
  root: "src/renderer",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
