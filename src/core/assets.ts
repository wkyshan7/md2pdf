/**
 * 用户自定义资源（字体 / 图片）。
 *
 * 设计要点：
 * - 资源以 data URL 形式保存在内存中，并持久化到 IndexedDB（见 assetStore.ts），
 *   避免写入 localStorage 造成配额溢出。
 * - Markdown 里用短引用 `asset://<id>` 指向资源，渲染时替换为真实 data URL，
 *   因此编辑器保持整洁，而导出结果（HTML / PDF / DOCX / PPTX）都是自包含的。
 * - 字体通过 `@font-face` + data URL 注入，预览、单文件 HTML、打印 PDF 共用同一套样式。
 */

export type FontStyle = "normal" | "italic" | "oblique";
export type FontFormat = "truetype" | "opentype" | "woff" | "woff2";

export interface FontAsset {
  id: string;
  kind: "font";
  /** 原始文件名，用于展示 */
  name: string;
  /** CSS font-family 名称（可由用户修改） */
  family: string;
  /** 100–900 */
  weight: number;
  style: FontStyle;
  format: FontFormat;
  mime: string;
  size: number;
  dataUrl: string;
  createdAt: number;
}

export interface ImageAsset {
  id: string;
  kind: "image";
  /** 展示名 / 建议的 alt 文本 */
  name: string;
  filename: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  dataUrl: string;
  createdAt: number;
}

export type Asset = FontAsset | ImageAsset;
export type AssetMap = Record<string, Asset>;

export const ASSET_SCHEME = "asset://";

/** `asset://<id>`，id 只含安全字符 */
const ASSET_REF_RE = /^asset:\/\/([A-Za-z0-9_-]+)$/;

/** 缺失资源占位图（内联 SVG，导出时也不会是裂图） */
const MISSING_IMAGE =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="120" viewBox="0 0 360 120">' +
      '<rect x="1" y="1" width="358" height="118" rx="10" fill="#f6f8fa" stroke="#d0d7de" stroke-width="2" stroke-dasharray="8 6"/>' +
      '<text x="180" y="62" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#8a94a6">图片资源缺失</text>' +
      "</svg>",
  );

export function isFontAsset(a: Asset): a is FontAsset {
  return a.kind === "font";
}

export function isImageAsset(a: Asset): a is ImageAsset {
  return a.kind === "image";
}

export function newAssetId(): string {
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function assetRef(id: string): string {
  return `${ASSET_SCHEME}${id}`;
}

/** 解析 `asset://id`，非资源引用返回 null */
export function parseAssetRef(src: string): string | null {
  const m = ASSET_REF_RE.exec(src.trim());
  return m ? m[1] : null;
}

/** 把 Markdown 中的资源引用解析成真实 data URL；引用不存在时给出占位图 */
export function resolveAssetSrc(src: string, assets?: AssetMap): string {
  const id = parseAssetRef(src);
  if (!id) return src;
  const asset = assets?.[id];
  return asset && asset.kind === "image" ? asset.dataUrl : MISSING_IMAGE;
}

/* ── 字体 ─────────────────────────────────────────────── */

export function fontFormatFromFilename(filename: string): FontFormat {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "otf") return "opentype";
  if (ext === "woff") return "woff";
  if (ext === "woff2") return "woff2";
  return "truetype";
}

export function fontMime(format: FontFormat): string {
  switch (format) {
    case "opentype":
      return "font/otf";
    case "woff":
      return "font/woff";
    case "woff2":
      return "font/woff2";
    default:
      return "font/ttf";
  }
}

function cssFontFormat(format: FontFormat): string {
  return format === "truetype" ? "truetype" : format;
}

function cssString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * 生成 @font-face 规则。数据内联，因此预览、导出 HTML、打印 PDF 都不依赖系统是否装字体。
 * `font-display` 预览用 swap（尽快显示），导出用 block（避免位图 PDF 抓到回退字体）。
 */
export function buildFontFaceCss(
  fonts: FontAsset[],
  display: "swap" | "block" | "auto" = "swap",
): string {
  return fonts
    .filter((f) => f.dataUrl)
    .map(
      (f) => `@font-face {
  font-family: ${cssString(f.family)};
  src: url("${f.dataUrl}") format("${cssFontFormat(f.format)}");
  font-weight: ${f.weight};
  font-style: ${f.style};
  font-display: ${display};
}`,
    )
    .join("\n");
}

/* ── 字体栈工具 ───────────────────────────────────────── */

function unquote(part: string): string {
  return part.trim().replace(/^['"]|['"]$/g, "").trim();
}

/** 取字体栈里的第一个可用族名（用于 PPTX / DOCX 这类只能写字体名的场景） */
export function primaryFamily(stack: string, fallback = "sans-serif"): string {
  const first = unquote(stack.split(",")[0] ?? "");
  return first || fallback;
}

export function prependFamily(family: string, stack: string): string {
  const parts = stack
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.some((p) => unquote(p) === family)) return stack;
  return [`"${family}"`, ...parts].join(", ") || `"${family}"`;
}

export function removeFamily(family: string, stack: string): string {
  const parts = stack
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = parts.filter((p) => unquote(p) !== family);
  return (kept.length ? kept : parts).join(", ") || stack;
}

/** 从字体栈中移除所有已知的自定义字体（用于切换/关闭自定义字体） */
export function stripKnownFamilies(stack: string, fonts: FontAsset[]): string {
  let out = stack;
  for (const f of fonts) out = removeFamily(f.family, out);
  return out;
}

/* ── 通用工具 ─────────────────────────────────────────── */

export function arrayBufferToDataUrl(buffer: ArrayBuffer, mime: string): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
