import DOMPurify from "dompurify";
import type { Config } from "dompurify";
import { parse, renderTokens, withHeadingNumbers } from "./parser";
import type { Heading } from "./parser";
import type { AssetMap } from "./assets";

const PURIFY_CONFIG: Config = {
  USE_PROFILES: { html: true, mathMl: true, svg: true },
  ADD_TAGS: ["input", "label", "figcaption", "figure"],
  ADD_ATTR: ["target", "rel", "data-lang", "align", "disabled", "checked"],
  ALLOW_DATA_ATTR: true,
};

export interface RenderResult {
  html: string;
  headings: Heading[];
}

/** markdown → 安全的 HTML 片段（已高亮、已净化） */
export function renderMarkdown(
  markdown: string,
  options: { numbered?: boolean; numberMaxLevel?: number; assets?: AssetMap } = {},
): RenderResult {
  const { tokens, env, headings } = parse(markdown);
  const finalTokens = options.numbered
    ? withHeadingNumbers(tokens, options.numberMaxLevel ?? 6)
    : tokens;
  if (options.assets) env.assets = options.assets;
  const raw = renderTokens(finalTokens, env);
  const html = DOMPurify.sanitize(raw, PURIFY_CONFIG) as unknown as string;
  return { html, headings };
}

/** 判断文档是否含数学公式，用于决定是否引入 KaTeX 样式 */
export function containsMath(markdown: string): boolean {
  return /\$[^$\n]+\$|\$\$[\s\S]+?\$\$|\\\(|\\\[/.test(markdown);
}
