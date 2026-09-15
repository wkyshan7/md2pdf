import MarkdownIt from "markdown-it";
import type { MarkdownIt as MarkdownItInstance, Token } from "markdown-it";
import anchor from "markdown-it-anchor";
import attrs from "markdown-it-attrs";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
import katex from "@vscode/markdown-it-katex";
import hljs from "highlight.js/lib/common";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 用 hljs 高亮代码，输出 `<pre class="md-code-block"><code class="hljs …">` */
export function highlightCode(code: string, lang?: string): string {
  const language = lang && hljs.getLanguage(lang) ? lang : "";
  let inner: string;
  try {
    inner = language
      ? hljs.highlight(code, { language, ignoreIllegals: true }).value
      : escapeHtml(code);
  } catch {
    inner = escapeHtml(code);
  }
  const cls = `hljs${language ? ` language-${escapeHtml(language)}` : ""}`;
  return `<pre class="md-code-block" data-lang="${escapeHtml(lang ?? "")}"><code class="${cls}">${inner}</code></pre>`;
}

function slugify(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[\s]+/g, "-")
      .replace(/[^\p{L}\p{N}\-_]/gu, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "section"
  );
}

/**
 * 统一插件导入：CJS 包在 Node 原生 ESM 下可能被包成 `{ default: fn }`，
 * 而 Vite 已完成 interop。两种情况都取出可调用的插件函数。
 */
function asPlugin<T extends (...args: never[]) => unknown>(mod: T | { default: T }): T {
  return typeof mod === "function" ? mod : mod.default;
}

export const md: MarkdownItInstance = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
  highlight: (code, lang) => highlightCode(code, lang),
})
  .use(asPlugin(footnote))
  .use(asPlugin(taskLists), { label: true, labelAfter: true, enabled: false })
  .use(asPlugin(attrs), { allowedAttributes: ["id", "class", "style", "width", "height", "align"] })
  .use(asPlugin(anchor), {
    slugify,
    permalink: anchor.permalink.linkInsideHeader({ symbol: "#", placement: "before", class: "md-anchor" }),
  })
  .use(asPlugin(katex), { throwOnError: false, errorColor: "#cc0000" });

export interface Heading {
  level: number;
  text: string;
  id: string;
  /** 源码起始行（0 基），用于编辑器↔预览的同步滚动 */
  line: number;
}

export interface ParseResult {
  tokens: Token[];
  env: Record<string, unknown>;
  headings: Heading[];
}

/** 解析 markdown，返回 token 流、env 与目录信息 */
export function parse(markdown: string): ParseResult {
  const env: Record<string, unknown> = {};
  const tokens = md.parse(markdown, env);
  return { tokens, env, headings: collectHeadings(tokens) };
}

export function collectHeadings(tokens: Token[]): Heading[] {
  const out: Heading[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "heading_open") continue;
    const inline = tokens[i + 1];
    const text = inline && inline.type === "inline" ? inline.content : "";
    out.push({
      level: Number(t.tag.slice(1)),
      text: text.replace(/[#*`_~[\]]/g, "").trim(),
      id: String(t.attrGet("id") ?? ""),
      line: t.map ? t.map[0] : 0,
    });
  }
  return out;
}

export function renderTokens(tokens: Token[], env: Record<string, unknown> = {}): string {
  return md.renderer.render(tokens, md.options, env);
}

/** 给标题插入自动编号（复制 inline token 后写入序号，不改动原始数组） */
export function withHeadingNumbers(tokens: Token[]): Token[] {
  const counters = [0, 0, 0, 0, 0, 0];
  const out = tokens.slice();
  for (let i = 0; i < out.length; i++) {
    const t = out[i];
    if (t.type !== "heading_open") continue;
    const level = Number(t.tag.slice(1));
    if (level < 1 || level > 6) continue;
    counters[level - 1] += 1;
    for (let j = level; j < 6; j++) counters[j] = 0;
    const inline = out[i + 1];
    if (!inline || inline.type !== "inline") continue;
    const proto = Object.getPrototypeOf(inline) as object;
    const clone = Object.assign(Object.create(proto) as Token, inline);
    // inline 渲染走 children，因此需要插入一个 html_inline 子节点而不是改 content
    const marker = Object.assign(Object.create(proto) as Token, inline, {
      type: "html_inline",
      tag: "",
      nesting: 0,
      content: `<span class="md-secnum">${counters.slice(0, level).join(".")} </span>`,
      children: null,
      attrs: null,
      map: null,
      markup: "",
      info: "",
      meta: null,
      block: false,
      hidden: false,
    });
    clone.children = [marker, ...(inline.children ?? [])];
    clone.content = `${marker.content}${inline.content}`;
    out[i + 1] = clone;
  }
  return out;
}

/** 从 token 中抽取标题文本，用于 PPTX/DOCX 的结构化转换 */
export function headingText(tokens: Token[], index: number): string {
  const inline = tokens[index + 1];
  return inline && inline.type === "inline" ? inline.content : "";
}
