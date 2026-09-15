import type { ThemeTokens } from "./types";
import { PAGE_SIZES } from "./types";

/** 把 #rgb / #rrggbb 转成 rgba()，解析失败时原样返回。
 * 不能依赖 color-mix()：html2canvas 的色彩解析器不支持它。 */
function withAlpha(color: string, alpha: number): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const num = parseInt(hex, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** token → CSS 变量，静态样式表只引用变量，便于实时热改 */
export function buildVars(t: ThemeTokens): string {
  const dims = PAGE_SIZES[t.pageSize];
  const [w, h] =
    t.orientation === "landscape" ? [dims.h, dims.w] : [dims.w, dims.h];
  return `--md-font: ${t.fontFamily};
--md-font-size: ${t.fontSize}px;
--md-line-height: ${t.lineHeight};
--md-text: ${t.textColor};
--md-bg: ${t.bgColor};
--md-accent: ${t.accentColor};
--md-link: ${t.linkColor};
--md-link-border: ${withAlpha(t.linkColor, 0.35)};
--md-h1: ${t.h1Size}px;
--md-h2: ${t.h2Size}px;
--md-h3: ${t.h3Size}px;
--md-h4: ${t.h4Size}px;
--md-h5: ${Math.max(14, Math.round(t.h4Size * 0.94))}px;
--md-h6: ${Math.max(13, Math.round(t.h4Size * 0.9))}px;
--md-heading-color: ${t.headingColor};
--md-heading-weight: ${t.headingWeight};
--md-heading-align: ${t.headingAlign};
--md-para-spacing: ${t.paraSpacing}em;
--md-max-width: ${t.maxWidth}px;
--md-code-font: ${t.codeFontFamily};
--md-code-size: ${t.codeFontSize}px;
--md-inline-code-bg: ${t.inlineCodeBg};
--md-inline-code-color: ${t.inlineCodeColor};
--md-code-bg: ${t.codeBlockBg};
--md-code-color: ${t.codeBlockColor};
--md-table-border: ${t.tableBorderColor};
--md-code-border: ${withAlpha(t.tableBorderColor, 0.6)};
--md-stripe: ${withAlpha(t.tableHeaderBg, 0.45)};
--md-table-head-bg: ${t.tableHeaderBg};
--md-quote-border: ${t.blockquoteBorder};
--md-quote-bg: ${t.blockquoteBg};
--md-quote-color: ${t.blockquoteColor};
--md-page-w: ${w}mm;
--md-page-h: ${h}mm;
--md-page-margin: ${t.marginMm}mm;`;
}

/** Markdown 元素的基础排版（与主题无关，只读变量） */
export const BASE_CSS = `
.md-page {
  width: var(--md-page-w);
  min-height: var(--md-page-h);
  padding: var(--md-page-margin);
  box-sizing: border-box;
  background: var(--md-bg);
}
.md-page.md-flow {
  width: 100%;
  max-width: var(--md-max-width);
  min-height: 0;
  padding: 0;
}
.md-body {
  font-family: var(--md-font);
  font-size: var(--md-font-size);
  line-height: var(--md-line-height);
  color: var(--md-text);
  background: var(--md-bg);
  word-wrap: break-word;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.md-body > *:first-child { margin-top: 0; }
.md-body > *:last-child { margin-bottom: 0; }

.md-body h1, .md-body h2, .md-body h3,
.md-body h4, .md-body h5, .md-body h6 {
  color: var(--md-heading-color);
  font-weight: var(--md-heading-weight);
  text-align: var(--md-heading-align);
  line-height: 1.3;
  margin: 1.4em 0 0.6em;
  scroll-margin-top: 1em;
  /* 为绝对定位的锚点提供参考框 */
  position: relative;
}
.md-body h1 { font-size: var(--md-h1); margin-top: 1.6em; }
.md-body h2 { font-size: var(--md-h2); }
.md-body h3 { font-size: var(--md-h3); }
.md-body h4 { font-size: var(--md-h4); }
.md-body h5 { font-size: var(--md-h5); }
.md-body h6 { font-size: var(--md-h6); color: var(--md-quote-color); }
.md-body .md-secnum { color: var(--md-accent); }

.md-body p { margin: 0 0 var(--md-para-spacing); }
.md-body strong { font-weight: 700; }
.md-body em { font-style: italic; }
.md-body del { text-decoration: line-through; opacity: 0.75; }
.md-body a { color: var(--md-link); text-decoration: none; border-bottom: 1px solid var(--md-link-border); }
.md-body a:hover { border-bottom-color: var(--md-link); }
.md-body .md-anchor {
  /* 锚点是隐藏的悬浮永久链接，不能占据行内空间，否则会把标题推右 */
  position: absolute;
  top: 0;
  left: 0;
  transform: translateX(-100%);
  padding-right: 0.25em;
  font-size: 0.75em;
  font-weight: 400;
  color: var(--md-accent);
  opacity: 0;
  text-decoration: none;
  border: none;
}
.md-body h1:hover .md-anchor, .md-body h2:hover .md-anchor, .md-body h3:hover .md-anchor,
.md-body h4:hover .md-anchor, .md-body h5:hover .md-anchor, .md-body h6:hover .md-anchor { opacity: 0.55; }

.md-body ul, .md-body ol { margin: 0 0 var(--md-para-spacing); padding-left: 1.7em; }
.md-body li { margin: 0.25em 0; }
.md-body li > ul, .md-body li > ol { margin: 0.25em 0; }
/* 任务清单：复选框挂在 marker 区域（与普通列表的圆点同位置），
   绝不能使用负的 li 外边距，否则会跑到版心左侧外面。
   -1.25em + 0.45em 是为让 label 文字与普通列表正文对齐（复选框约 13px ≈ 0.81em）。 */
.md-body li.task-list-item { list-style: none; }
.md-body li.task-list-item > input.task-list-item-checkbox {
  margin-left: -1.25em;
  margin-right: 0.45em;
  vertical-align: middle;
}

.md-body code {
  font-family: var(--md-code-font);
  font-size: var(--md-code-size);
}
.md-body :not(pre) > code {
  background: var(--md-inline-code-bg);
  color: var(--md-inline-code-color);
  padding: 0.15em 0.4em;
  border-radius: 5px;
  white-space: break-spaces;
}
.md-body pre.md-code-block {
  position: relative;
  background: var(--md-code-bg);
  color: var(--md-code-color);
  border-radius: 8px;
  padding: 0.95em 1.1em;
  margin: 0 0 var(--md-para-spacing);
  overflow-x: auto;
  line-height: 1.55;
  border: 1px solid var(--md-code-border);
}
.md-body pre.md-code-block > code.hljs {
  display: block;
  padding: 0;
  background: transparent;
  color: inherit;
  font-size: var(--md-code-size);
  overflow: visible;
}
.md-body pre.md-code-block[data-lang]:not([data-lang=""])::after {
  content: attr(data-lang);
  position: absolute;
  top: 0.45em; right: 0.7em;
  font-family: var(--md-code-font);
  font-size: 0.72em;
  letter-spacing: 0.04em;
  color: var(--md-code-color);
  opacity: 0.4;
  pointer-events: none;
}
.md-body pre.md-code-block.md-wrap > code.hljs { white-space: pre-wrap; word-break: break-word; }

.md-body blockquote {
  margin: 0 0 var(--md-para-spacing);
  padding: 0.6em 1em;
  border-left: 4px solid var(--md-quote-border);
  background: var(--md-quote-bg);
  color: var(--md-quote-color);
  border-radius: 0 6px 6px 0;
}
.md-body blockquote > *:last-child { margin-bottom: 0; }

.md-body hr { border: none; border-top: 1px solid var(--md-table-border); margin: 2em 0; }

.md-body img { max-width: 100%; height: auto; display: block; margin: 0.6em auto; border-radius: 6px; }
.md-body figure { margin: 1em 0; text-align: center; }
.md-body figcaption { font-size: 0.85em; color: var(--md-quote-color); margin-top: 0.4em; }

.md-body table {
  border-collapse: collapse;
  width: 100%;
  margin: 0 0 var(--md-para-spacing);
  font-size: 0.95em;
  display: table;
}
.md-body th, .md-body td {
  border: 1px solid var(--md-table-border);
  padding: 0.5em 0.75em;
  text-align: left;
}
.md-body th { background: var(--md-table-head-bg); font-weight: 600; }

.md-body kbd {
  font-family: var(--md-code-font);
  font-size: 0.85em;
  background: var(--md-inline-code-bg);
  border: 1px solid var(--md-table-border);
  border-bottom-width: 2px;
  border-radius: 4px;
  padding: 0.1em 0.4em;
}
.md-body mark { background: #fff3a3; color: inherit; padding: 0 0.15em; }

.md-body .footnotes { font-size: 0.88em; color: var(--md-quote-color); border-top: 1px solid var(--md-table-border); margin-top: 2em; padding-top: 0.8em; }
.md-body .footnotes ol { padding-left: 1.3em; }
.md-body .footnote-ref a { text-decoration: none; }
.md-body .katex-display { overflow-x: auto; overflow-y: hidden; padding: 0.3em 0; }
`;

export interface PrintCssOptions {
  tokens: ThemeTokens;
}

/** @page 与打印（PDF）规则 */
export function buildPrintCss({ tokens: t }: PrintCssOptions): string {
  const dims = PAGE_SIZES[t.pageSize];
  const [w, h] = t.orientation === "landscape" ? [dims.h, dims.w] : [dims.w, dims.h];
  const breaks: string[] = [];
  if (t.pageBreakBeforeH1) breaks.push(".md-body h1 { break-before: page; }");
  if (t.pageBreakBeforeH2) breaks.push(".md-body h2 { break-before: page; }");
  return `
@page { size: ${w}mm ${h}mm; margin: ${t.marginMm}mm; }
@media print {
  html, body {
    background: #ffffff !important;
    margin: 0; padding: 0;
    height: auto !important;
    overflow: visible !important;
  }
  /* 不能保持 flex：flex item 的自动最小尺寸是 min-content，
     页面会被长代码行 / 宽表格撑宽，超出纸张的部分直接被裁掉（右侧显示不全）。 */
  .md-doc-shell { display: block !important; }
  .md-page {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    padding: 0 !important;
    margin: 0 !important;
    box-shadow: none !important;
    border: none !important;
    border-radius: 0 !important;
    background: transparent !important;
    overflow: visible !important;
  }
  .md-body {
    background: transparent !important;
    /* anywhere 会影响 min-content 宽度，保证长 URL / 长单词能收缩而不溢出 */
    overflow-wrap: anywhere;
  }
  .md-anchor { display: none !important; }

  /* 纸张不会滚动：长内容必须折行，否则会被右侧裁切 */
  .md-body pre.md-code-block {
    white-space: pre-wrap !important;
    overflow: visible !important;
    max-width: 100% !important;
  }
  .md-body pre.md-code-block > code.hljs {
    white-space: pre-wrap !important;
    word-break: break-word;
  }
  .md-body table { width: 100% !important; max-width: 100% !important; }
  .md-body th, .md-body td { overflow-wrap: anywhere; word-break: break-word; }
  .md-body img, .md-body figure, .md-body svg { max-width: 100% !important; }
  .md-body .katex-display { max-width: 100% !important; }

  .md-body h1, .md-body h2, .md-body h3, .md-body h4, .md-body h5, .md-body h6 { break-after: avoid-page; }
  /* 块级元素尽量不跨页；pre / table 允许跨页，否则超过一页的内容会溢出裁切 */
  .md-body blockquote, .md-body img, .md-body figure { break-inside: avoid; }
  .md-body tr, .md-body li { break-inside: avoid; }
  ${breaks.join("\n  ")}
}
`;
}

/** 把主题应用到页面容器：变量 + 基础样式 + 条件规则 + 自定义 CSS */
export function buildThemeStyle(t: ThemeTokens, scope = ":root"): string {
  const extras: string[] = [];
  if (t.h1Rule)
    extras.push(
      ".md-body h1 { padding-bottom: 0.28em; border-bottom: 2px solid var(--md-table-border); }",
    );
  if (t.h2Rule)
    extras.push(
      ".md-body h2 { padding-bottom: 0.22em; border-bottom: 1px solid var(--md-table-border); }",
    );
  if (t.codeWrap)
    extras.push(
      ".md-body pre.md-code-block { white-space: pre-wrap; overflow-wrap: anywhere; }",
      ".md-body pre.md-code-block > code.hljs { white-space: pre-wrap; word-break: break-word; }",
    );
  if (t.tableStripe)
    extras.push(
      ".md-body tbody tr:nth-child(even) { background: var(--md-stripe); }",
    );
  return `${scope} {\n${buildVars(t)}\n}\n${BASE_CSS}\n${extras.join("\n")}\n${buildPrintCss({
    tokens: t,
  })}\n${t.customCss ? `\n/* ── 自定义 CSS ── */\n${t.customCss}\n` : ""}`;
}
