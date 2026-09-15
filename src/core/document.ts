import type { ExportMeta, ThemeTokens } from "./types";
import { buildThemeStyle } from "./themeCss";
import { getCodeTheme } from "./highlightThemes";
import { escapeHtml } from "./parser";

export const KATEX_CDN =
  "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";

export interface DocShellOptions {
  tokens: ThemeTokens;
  meta: ExportMeta;
  bodyHtml: string;
  /** 流式阅读布局（而非固定页面） */
  flow?: boolean;
  /** 是否注入 KaTeX 样式（含公式时） */
  includeKatex?: boolean;
  /** 是否包含打印规则（PDF 用） */
  forPrint?: boolean;
}

/** 生成完整、自包含的 HTML 文档（HTML 导出与 PDF 打印共用） */
export function buildStandaloneHtml({
  tokens,
  meta,
  bodyHtml,
  flow = false,
  includeKatex = false,
  forPrint = false,
}: DocShellOptions): string {
  const themeStyle = buildThemeStyle(tokens, ":root");
  const codeCss = getCodeTheme(tokens.codeTheme).css;
  const runningHeader = meta.header.trim();
  const runningFooter = meta.footer.trim();

  const shellCss = `
html, body { margin: 0; padding: 0; }
body { background: #e8eaed; }
${forPrint ? "" : "body { padding: 28px 12px; }"}
.md-doc-shell { display: flex; justify-content: center; }
.md-doc-shell .md-page { box-shadow: 0 2px 18px rgba(0,0,0,.18); border-radius: 4px; }
.md-run-header, .md-run-footer { display: none; }
@media print {
  body { background: #fff !important; padding: 0 !important; }
  /* 改为块级：flex item 的 min-content 宽度会把页面撑得比纸张宽 */
  .md-doc-shell { display: block !important; }
  .md-doc-shell .md-page {
    box-shadow: none !important;
    border-radius: 0 !important;
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
  }
  ${
    runningHeader
      ? `.md-run-header { display: block; position: fixed; top: 0; left: 0; right: 0; text-align: center;
        font-size: 9pt; color: #888; padding-bottom: 4pt; }`
      : ""
  }
  ${
    runningFooter
      ? `.md-run-footer { display: block; position: fixed; bottom: 0; left: 0; right: 0; text-align: center;
        font-size: 9pt; color: #888; padding-top: 4pt; }`
      : ""
  }
}
`;

  const author = meta.author.trim();
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title || "Markdown 文档")}</title>${author ? `\n<meta name="author" content="${escapeHtml(author)}">` : ""}${
    meta.subject.trim() ? `\n<meta name="description" content="${escapeHtml(meta.subject.trim())}">` : ""
  }
${includeKatex ? `<link rel="stylesheet" href="${KATEX_CDN}">\n` : ""}<style id="md-theme">
${themeStyle}
</style>
<style id="md-hljs">
${codeCss}
</style>
<style id="md-shell">
${shellCss}
</style>
</head>
<body>
<div class="md-doc-shell">
  <main class="md-page${flow ? " md-flow" : ""}">
    ${runningHeader ? `<div class="md-run-header">${escapeHtml(runningHeader)}</div>` : ""}
    <article class="md-body">
${bodyHtml}
    </article>
    ${runningFooter ? `<div class="md-run-footer">${escapeHtml(runningFooter)}</div>` : ""}
  </main>
</div>
</body>
</html>`;
}
