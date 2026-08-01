import { defineConfig } from "vite";

export default defineConfig({
  root: "public",
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "../dist/public",
    emptyOutDir: false,
    assetsInlineLimit: 0,
  },
});
