/**
 * 文档文件（`.mdstudio.json`）：把 Markdown、主题与**文档图片**打包在一起，
 * 让图片真正「跟随文档」——换设备 / 分享文件后，`asset://<id>` 引用依然能解析到图片。
 *
 * 字体属于全局字体库（体积大、跨文档复用），不放进文档文件。
 */

import type { ExportMeta, ThemeTokens } from "./types";
import type { ImageAsset } from "./assets";

export const BUNDLE_FORMAT = "md-studio:document";
export const BUNDLE_VERSION = 1;

export interface DocumentBundle {
  format: string;
  version: number;
  savedAt: string;
  meta: ExportMeta;
  markdown: string;
  tokens: ThemeTokens;
  presetId: string;
  bodyFontId?: string;
  codeFontId?: string;
  images: ImageAsset[];
}

export interface BundleInput {
  markdown: string;
  tokens: ThemeTokens;
  meta: ExportMeta;
  presetId: string;
  bodyFontId?: string;
  codeFontId?: string;
  images: ImageAsset[];
}

function sanitizeImages(value: unknown): ImageAsset[] {
  if (!Array.isArray(value)) return [];
  const out: ImageAsset[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const img = raw as Partial<ImageAsset>;
    if (typeof img.id !== "string" || typeof img.dataUrl !== "string" || !img.dataUrl.startsWith("data:")) {
      continue;
    }
    out.push({
      id: img.id,
      kind: "image",
      name: typeof img.name === "string" ? img.name : "image",
      filename: typeof img.filename === "string" ? img.filename : (img.name ?? "image"),
      mime: typeof img.mime === "string" ? img.mime : "image/png",
      size: typeof img.size === "number" ? img.size : 0,
      width: typeof img.width === "number" ? img.width : 0,
      height: typeof img.height === "number" ? img.height : 0,
      dataUrl: img.dataUrl,
      createdAt: typeof img.createdAt === "number" ? img.createdAt : Date.now(),
    });
  }
  return out;
}

export function buildDocumentBundle(input: BundleInput): DocumentBundle {
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    savedAt: new Date().toISOString(),
    meta: input.meta,
    markdown: input.markdown,
    tokens: input.tokens,
    presetId: input.presetId,
    bodyFontId: input.bodyFontId,
    codeFontId: input.codeFontId,
    images: input.images,
  };
}

/** 判断文件内容是否为 MD Studio 文档文件 */
export function looksLikeDocumentBundle(text: string): boolean {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("{")) return false;
  return trimmed.includes(BUNDLE_FORMAT);
}

export function parseDocumentBundle(text: string): DocumentBundle {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的 JSON");
  }
  if (!data || typeof data !== "object") throw new Error("文件内容不是对象");
  const bundle = data as Partial<DocumentBundle>;
  if (bundle.format !== BUNDLE_FORMAT) throw new Error("不是 MD Studio 文档文件");
  if (typeof bundle.markdown !== "string") throw new Error("文档缺少 Markdown 内容");
  if (!bundle.tokens || typeof bundle.tokens !== "object") throw new Error("文档缺少主题信息");
  if (!bundle.meta || typeof bundle.meta !== "object") throw new Error("文档缺少元信息");

  return {
    format: BUNDLE_FORMAT,
    version: typeof bundle.version === "number" ? bundle.version : 1,
    savedAt: typeof bundle.savedAt === "string" ? bundle.savedAt : new Date().toISOString(),
    meta: bundle.meta,
    markdown: bundle.markdown,
    tokens: bundle.tokens,
    presetId: typeof bundle.presetId === "string" ? bundle.presetId : "",
    bodyFontId: typeof bundle.bodyFontId === "string" ? bundle.bodyFontId : undefined,
    codeFontId: typeof bundle.codeFontId === "string" ? bundle.codeFontId : undefined,
    images: sanitizeImages(bundle.images),
  };
}
