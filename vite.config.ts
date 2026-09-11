import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const entry = (name: string) =>
  fileURLToPath(new URL(`src/renderer/${name}`, import.meta.url));
const STYLESHEET_LINK = /<link(?=\s[^>]*\brel="stylesheet")/;
const PRESSABLE_STYLE_ID = 'id="react-aria-pressable-style"';

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
  plugins: [
    react(),
    {
      name: "preserve-pressable-style-id",
      transformIndexHtml: {
        handler: (html) => {
          // Vite replaces stylesheet links during build and drops their IDs.
          // Keep the static marker that prevents React Aria's inline style injection.
          return html.includes(PRESSABLE_STYLE_ID)
            ? html
            : html.replace(STYLESHEET_LINK, `<link ${PRESSABLE_STYLE_ID}`);
        },
        order: "post",
      },
    },
  ],
  root: "src/renderer",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
