import type { ExportMeta, ThemeTokens } from "./types";
import type { AssetMap, FontAsset } from "./assets";
import { renderMarkdown } from "./render";
import { buildStandaloneHtml } from "./document";
import { downloadText, safeFilename } from "./download";

export interface HtmlExportOptions {
  flow: boolean;
  numbered?: boolean;
  assets?: AssetMap;
  fonts?: FontAsset[];
}

/** 导出单文件、自包含的 HTML（样式内联，可直接分享/离线打开） */
export function buildHtmlDocument(
  markdown: string,
  tokens: ThemeTokens,
  meta: ExportMeta,
  options: HtmlExportOptions = { flow: true },
): string {
  const { html } = renderMarkdown(markdown, {
    numbered: options.numbered ?? tokens.headingNumbered,
    numberMaxLevel: tokens.headingNumberMaxLevel,
    assets: options.assets,
  });
  return buildStandaloneHtml({
    tokens,
    meta,
    bodyHtml: html,
    flow: options.flow,
    includeKatex: /\$[^$\n]+\$|\$\$/.test(markdown),
    forPrint: false,
    fonts: options.fonts,
  });
}

export function exportHtml(
  markdown: string,
  tokens: ThemeTokens,
  meta: ExportMeta,
  options: HtmlExportOptions = { flow: true },
): void {
  const doc = buildHtmlDocument(markdown, tokens, meta, options);
  downloadText(doc, `${safeFilename(meta.title, "document")}.html`, "text/html");
}
