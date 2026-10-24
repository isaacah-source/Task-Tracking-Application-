/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  // Set BASE_PATH when hosting under a subpath, e.g. GitHub Pages at /<repo>/.
  base: process.env.BASE_PATH ?? "/",
  plugins: [
    react(),
    // Installable on phones and desktops ("Add to Home Screen"), like the Relationship Tracker.
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "FSI Projects",
        short_name: "FSI Projects",
        description: "Frontier Security Institute projects, tasks, and meetings.",
        theme_color: "#1f3a5f",
        background_color: "#f5f6f8",
        display: "standalone",
        start_url: ".",
        scope: ".",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icons/monochrome-512.png", sizes: "512x512", type: "image/png", purpose: "monochrome" },
        ],
      },
      workbox: {
        // Project data lives in SharePoint and is always fetched live; only the app itself is
        // cached. config.json is fetched fresh so settings changes apply at once.
        globIgnores: ["config.json"],
        runtimeCaching: [],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: { port: 5176, strictPort: true },
  preview: { port: 5176, strictPort: true },
  test: { environment: "node" },
});
