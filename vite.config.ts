import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const base = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "アートメモ",
        short_name: "アートメモ",
        description: "歌詞、音、映像のアイデアをすばやく記録する個人用メモ",
        lang: "ja",
        theme_color: "#f2f2f7",
        background_color: "#f2f2f7",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: ".",
        scope: ".",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,ico,webmanifest}"],
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true
      },
      devOptions: { enabled: true }
    })
  ],
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"]
  }
});
