/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  // Set BASE_PATH when hosting under a subpath, e.g. GitHub Pages at /<repo>/.
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: { port: 5176, strictPort: true },
  preview: { port: 5176, strictPort: true },
  test: { environment: "node" },
});
