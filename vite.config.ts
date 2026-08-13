import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const entry = (name: string) =>
  fileURLToPath(new URL(`src/renderer/${name}`, import.meta.url));

export default defineConfig({
  base: "./",
  build: {
    assetsInlineLimit: 0,
    emptyOutDir: false,
    outDir: "../../dist/renderer",
    rollupOptions: {
      input: {
        app: entry("app/index.html"),
        settings: entry("settings/index.html"),
      },
    },
  },
  plugins: [react()],
  root: "src/renderer",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
