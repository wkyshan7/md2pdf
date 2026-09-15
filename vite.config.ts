import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [
    react(),
    VitePWA({
      // SSR（如脚本冒烟测试打包）时不需要 Service Worker
      disable: isSsrBuild,
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png", "icons/favicon-64.png"],
      manifest: {
        name: "MD Studio · Markdown 排版与导出",
        short_name: "MD Studio",
        description:
          "Markdown 排版工作台：实时预览、主题预设、导出 PDF / PPTX / DOCX / HTML，支持离线使用。",
        lang: "zh-CN",
        dir: "ltr",
        theme_color: "#10141c",
        background_color: "#10141c",
        display: "standalone",
        orientation: "any",
        start_url: "./",
        scope: "./",
        categories: ["productivity", "utilities"],
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // KaTeX 字体会被一起预缓存，保证离线也能渲染公式
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2,woff,ttf,webmanifest}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  base: "./",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000,
  },
  server: {
    host: true,
    port: 5173,
  },
}));
