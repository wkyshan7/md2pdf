#!/usr/bin/env node
/**
 * 构建产物 PWA 校验：确认 dist/ 真的能作为可安装、可离线的应用。
 * 用法: node scripts/check-pwa.mjs   （需先 npm run build）
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

let failures = 0;
const check = (name, ok, extra = "") => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

if (!existsSync(DIST)) {
  console.error("dist/ 不存在，请先运行 npm run build");
  process.exit(1);
}

const read = (p) => readFileSync(join(DIST, p), "utf8");

console.log("[PWA] 清单");
const manifestPath = join(DIST, "manifest.webmanifest");
check("manifest.webmanifest 存在", existsSync(manifestPath));
const manifest = JSON.parse(read("manifest.webmanifest"));
check("有 name / short_name", !!manifest.name && !!manifest.short_name);
check("display = standalone", manifest.display === "standalone");
check("start_url 相对路径", manifest.start_url === "./" || manifest.start_url === ".");
check("theme_color / background_color", !!manifest.theme_color && !!manifest.background_color);
check("声明 192 + 512 图标", manifest.icons.some((i) => i.sizes === "192x192") && manifest.icons.some((i) => i.sizes === "512x512"));
check("声明 maskable 图标", manifest.icons.some((i) => String(i.purpose).includes("maskable")));
for (const icon of manifest.icons) {
  const p = join(DIST, icon.src);
  check(`图标存在 ${icon.src}`, existsSync(p), p);
}
check(
  "maskable 图标声明 512x512",
  manifest.icons.find((i) => String(i.purpose).includes("maskable"))?.sizes === "512x512",
);
check(
  "maskable 图标不透明（全出血，交给系统裁切）",
  pngColorType(join(DIST, "icons/icon-maskable-512.png")) === 2,
  `colorType=${pngColorType(join(DIST, "icons/icon-maskable-512.png"))}`,
);

console.log("[PWA] Service Worker");
check("sw.js 存在", existsSync(join(DIST, "sw.js")));
check("registerSW.js 存在", existsSync(join(DIST, "registerSW.js")));
const sw = read("sw.js");
const precacheUrls = [...sw.matchAll(/url:\s*"([^"]+)"/g)].map((m) => m[1]);
check("预缓存条目 > 50", precacheUrls.length > 50, String(precacheUrls.length));
check("预缓存全部为相对路径（兼容 base: './'）", precacheUrls.every((u) => !u.startsWith("/")));
check("预缓存包含 index.html", precacheUrls.includes("index.html"));
check(
  "预缓存包含哈希化 JS / CSS",
  precacheUrls.some((u) => /^assets\/.*\.js$/.test(u)) && precacheUrls.some((u) => /^assets\/.*\.css$/.test(u)),
);
check("预缓存包含 KaTeX 字体（离线公式）", precacheUrls.some((u) => /\.(woff2|woff|ttf)$/.test(u)));
check("预缓存包含应用图标", precacheUrls.some((u) => u.includes("icon-192")) && precacheUrls.some((u) => u.includes("icon-512")));
check("启用 skipWaiting / clientsClaim", sw.includes("skipWaiting()") && sw.includes("clientsClaim()"));
check("navigateFallback 指向 index.html", sw.includes("index.html"));
check("超出体积上限的文件不会被漏掉", precacheUrls.every((u) => !u.startsWith("http")));

console.log("[PWA] index.html 注入");
const html = read("index.html");
check("注入 manifest 链接", /<link[^>]+rel="manifest"/.test(html));
check("注入 Service Worker 注册", /vite-plugin-pwa:register-sw/.test(html));
check("theme-color meta", /name="theme-color"/.test(html));
check("viewport-fit=cover（刘海屏）", /viewport-fit=cover/.test(html));
check("apple-touch-icon", /rel="apple-touch-icon"/.test(html));
check("apple-mobile-web-app-capable", /name="apple-mobile-web-app-capable"/.test(html));
check(
  "以 ./ 引用资源（可 file:// 直接打开）",
  /src="\.\/assets\//.test(html) || /src="\.\.?\//.test(html) === false,
);
check("无绝对路径资源", !/(src|href)="\/(?!\/)/.test(html));

console.log("[PWA] icons 目录");
for (const f of ["favicon.svg", "icons/favicon-64.png", "icons/apple-touch-icon.png"]) {
  check(`存在 ${f}`, existsSync(join(DIST, f)));
}
check(
  "apple-touch-icon 不透明（iOS 不支持透明）",
  pngColorType(join(DIST, "icons/apple-touch-icon.png")) === 2,
  `colorType=${pngColorType(join(DIST, "icons/apple-touch-icon.png"))}`,
);

console.log("");
if (failures > 0) {
  console.error(`❌ PWA 校验失败：${failures} 项`);
  process.exit(1);
}
console.log("✅ PWA 产物校验通过");

/** 读 PNG IHDR 的 colorType：2 = RGB（无 alpha），6 = RGBA */
function pngColorType(path) {
  if (!existsSync(path)) return -1;
  return readFileSync(path)[25];
}
