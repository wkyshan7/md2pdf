/**
 * 无浏览器冒烟测试：验证 markdown 解析、HTML 组装、PPTX/DOCX 构建。
 * 运行：npm run smoke
 */
import { Document, Packer } from "docx";
import { parse, renderTokens, withHeadingNumbers } from "../src/core/parser";
import { computeHeadingNumbers } from "../src/core/headingNumbers";
import {
  BUNDLE_FORMAT,
  buildDocumentBundle,
  looksLikeDocumentBundle,
  parseDocumentBundle,
} from "../src/core/documentBundle";
import {
  fromUserThemeId,
  isUserThemeId,
  newUserThemeId,
  toUserThemeId,
} from "../src/core/userThemes";
import { buildStandaloneHtml } from "../src/core/document";
import { buildPrintCss, BASE_CSS, buildThemeStyle, buildVars } from "../src/core/themeCss";
import { resolveTokens, THEME_PRESETS } from "../src/core/themes";
import { SAMPLE_MARKDOWN } from "../src/core/sample";
import { buildPptxPresentation } from "../src/core/exportPptx";
import { buildDocxDocument } from "../src/core/exportDocx";
import {
  buildFontFaceCss,
  prependFamily,
  primaryFamily,
  removeFamily,
  resolveAssetSrc,
  stripKnownFamilies,
  type AssetMap,
  type FontAsset,
  type ImageAsset,
} from "../src/core/assets";
import { parseFontMeta } from "../src/core/fontMeta";
import type { ExportMeta, PptxOptions, DocxOptions } from "../src/core/types";

const meta: ExportMeta = {
  title: "冒烟测试",
  author: "CI",
  subject: "smoke",
  header: "页眉",
  footer: "页脚",
  showPageNumber: false,
};
const pptxOpts: PptxOptions = {
  splitLevel: 2,
  slideSize: "16:9",
  includeTitleSlide: true,
  bulletsPerSlide: 7,
  codeAsTextBox: true,
};
const docxOpts: DocxOptions = { includeToc: true, headingNumbered: true, codeShading: true };

let failures = 0;
function check(name: string, cond: boolean, extra = ""): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

console.log("[1] markdown 解析与插件");
const parsed = parse(SAMPLE_MARKDOWN);
const flat = parsed.tokens.map((t) => t.type);
check("token 数量 > 50", parsed.tokens.length > 50, String(parsed.tokens.length));
check("标题 >= 7", parsed.headings.length >= 7, String(parsed.headings.length));
check("含表格", flat.includes("table_open"));
check("含代码块", flat.includes("fence"));
check("含引用", flat.includes("blockquote_open"));
check("含脚注", flat.includes("footnote_ref") || flat.includes("footnote_block_open"));
check("标题锚点 id", parsed.headings.some((h) => h.id.length > 0));
check("标题含源码行号", parsed.headings.some((h) => h.line > 0));
check("任务列表", flat.includes("task-list-item") || renderTokens(parsed.tokens).includes("task-list-item"));
const html = renderTokens(parsed.tokens, parsed.env);
check("KaTeX 渲染", html.includes("katex"), "未找到 katex 标记");
check("代码高亮", html.includes("hljs-keyword") || html.includes('class="hljs'), "未找到高亮 span");
check("行内代码", html.includes("<code>") || html.includes("<code "));
check("表格输出", html.includes("<table"));
check("脚注输出", html.includes("footnote"));

console.log("[2] markdown-it-attrs 属性语法");const attrHtml = renderTokens(parse("# 标题 {.special}\n\n段落 {#pid}").tokens);
check("自定义 class 生效", attrHtml.includes("special"));
check("自定义 id 生效", attrHtml.includes('id="pid"'));

console.log("[2b] 标题自动编号");
const numbered = renderTokens(withHeadingNumbers(parse("# A\n\n## B\n\n## C").tokens));
check("包含序号 span", numbered.includes("md-secnum"));
check("二级标题编号 1.2", numbered.includes("1.2 </span>") || numbered.includes("1.1 </span>"));

console.log("[3] 独立 HTML 文档组装");
const tokens = resolveTokens(THEME_PRESETS[1]);
const doc = buildStandaloneHtml({ tokens, meta, bodyHtml: html, flow: true, forPrint: true });
check("doctype", doc.startsWith("<!doctype html>"));
check("内联主题样式", doc.includes('id="md-theme"'));
check("内联高亮样式", doc.includes('id="md-hljs"'));
check("@page 规则", doc.includes("@page"));
check("页眉", doc.includes("md-run-header"));
check("文档标题转义", doc.includes("<title>冒烟测试</title>"));

console.log("[4] PPTX 构建");
const { pres, slideCount } = buildPptxPresentation(SAMPLE_MARKDOWN, tokens, meta, pptxOpts);
check("生成幻灯片", slideCount > 0, String(slideCount));
check("PPTX 对象就绪", typeof pres.write === "function");

console.log("[5] DOCX 构建");
const { doc: docxDoc, paragraphs } = buildDocxDocument(SAMPLE_MARKDOWN, tokens, meta, docxOpts);
check("生成内容块", paragraphs > 0, String(paragraphs));
check("Document 就绪", docxDoc instanceof Document);

console.log("[6] DOCX 打包（Packer）");
const buf = await Packer.toBuffer(docxDoc);
const sig = String.fromCharCode(buf[0], buf[1]);
check("生成合法 zip 包", sig === "PK", `signature=${sig}`);

/**
 * 用 jsdom + 模拟布局验证分页器：
 * 重点不是像像素，而是「内容不丢失、不重复、不死循环」。
 */
async function testPaginate(): Promise<void> {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const win = dom.window as unknown as Window & typeof globalThis;

  // 挂到全局，让被测试模块里的 document / NodeFilter 可用
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = win;
  g.document = win.document;
  g.NodeFilter = (win as unknown as { NodeFilter: unknown }).NodeFilter;

  // 用 data-h 模拟高度：叶子取 data-h，容器取子元素之和
  const heightOf = (el: Element): number => {
    if (el.children.length > 0) {
      let sum = 0;
      for (const c of Array.from(el.children)) sum += heightOf(c);
      return sum;
    }
    return Number((el as HTMLElement).dataset.h ?? 40);
  };
  const topOf = (el: Element): number => {
    let top = 0;
    let sib = el.previousElementSibling;
    while (sib) {
      top += heightOf(sib);
      sib = sib.previousElementSibling;
    }
    const parent = el.parentElement;
    if (parent && !parent.classList.contains("md-body") && parent.tagName !== "BODY") {
      top += topOf(parent);
    }
    return top;
  };

  const proto = win.HTMLElement.prototype as unknown as Record<string, unknown>;
  Object.defineProperty(proto, "offsetHeight", {
    configurable: true,
    get(this: Element) {
      return heightOf(this);
    },
  });
  Object.defineProperty(proto, "offsetTop", {
    configurable: true,
    get(this: Element) {
      return topOf(this);
    },
  });

  // jsdom 未实现 Range#getBoundingClientRect，补一个零尺寸桩：
  // 这样 splitByText 会判定“放不下 -> 无法拆分”，正好验证降级路径
  Object.defineProperty(win.Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0, y: 0, width: 0, height: 0,
      top: 0, right: 0, bottom: 0, left: 0,
      toJSON: () => ({}),
    }),
  });

  const { paginate } = await import("../src/core/exportPdfRaster");

  const build = (html: string): HTMLElement => {
    const body = win.document.createElement("div");
    body.className = "md-body";
    body.innerHTML = html;
    return body as HTMLElement;
  };

  // ── 用例 1：列表需要被切开，且最后一页存在超高不可拆分块
  const body1 = build(`
    <h1 data-h="60">标题</h1>
    <p data-h="120">段落一</p>
    <ul><li data-h="50">A</li><li data-h="50">B</li><li data-h="50">C</li><li data-h="50">D</li></ul>
    <p data-h="300">超高的不可拆分段落</p>
  `);
  const original1 = (body1.textContent ?? "").replace(/\s+/g, "");
  const pages1 = paginate(body1, 120);
  const joined1 = pages1
    .map((p) => p.map((n) => n.textContent).join(""))
    .join("")
    .replace(/\s+/g, "");
  check("分页产生多页", pages1.length >= 4, `pages=${pages1.length}`);
  check("内容不丢失（列表切分）", joined1 === original1, `${joined1} vs ${original1}`);
  check("每页高度受限", pages1.every((p) => p.length > 0), "存在空页");
  check("原始容器已清空", body1.children.length === 0);
  const lists = pages1.flat().filter((n) => n.tagName === "UL");
  check("列表被拆成两段", lists.length === 2, `ul=${lists.length}`);
  check(
    "列表项未重复",
    lists.reduce((s, ul) => s + ul.children.length, 0) === 4,
    lists.map((ul) => ul.children.length).join("+"),
  );

  // ── 用例 2：表格按行拆分，且保留表头
  const body2 = build(`
    <table>
      <thead><tr><th data-h="40">H</th></tr></thead>
      <tbody>
        <tr data-h="50"><td>r1</td></tr>
        <tr data-h="50"><td>r2</td></tr>
        <tr data-h="50"><td>r3</td></tr>
        <tr data-h="50"><td>r4</td></tr>
      </tbody>
    </table>
  `);
  // 先取原始表体文本（paginate 会清空 body2）
  const rows2 = Array.from(body2.querySelectorAll("tbody tr"))
    .map((tr) => tr.textContent ?? "")
    .join("")
    .replace(/\s+/g, "");
  const pages2 = paginate(body2, 150);
  // 续页会重复表头，因此只比较表体行内容与顺序
  const joined2 = pages2
    .flat()
    .filter((n) => n.tagName === "TABLE")
    .map((t) =>
      Array.from(t.querySelectorAll("tbody tr"))
        .map((tr) => tr.textContent ?? "")
        .join(""),
    )
    .join("")
    .replace(/\s+/g, "");
  check("表格被拆分", pages2.length >= 2, `pages=${pages2.length}`);
  check("表体内容不丢失", joined2 === rows2, `${joined2} vs ${rows2}`);
  const tables = pages2.flat().filter((n) => n.tagName === "TABLE");
  check("尾部仍在同一表格中", tables.every((t) => t.querySelector("tbody") !== null));
  check("拆出的行数正确", tables.every((t) => t.querySelectorAll("tbody tr").length > 0));

  // ── 用例 3：完全放得下时只产生一页
  const body3 = build(`<p data-h="50">短</p><p data-h="50">内容</p>`);
  const pages3 = paginate(body3, 500);
  check("内容放得下时只有一页", pages3.length === 1, `pages=${pages3.length}`);

  // ── 用例 4：空文档不抛错、不死循环
  const body4 = build("");
  check("空文档返回 0 页", paginate(body4, 500).length === 0);
}

console.log("[7] PDF 分页器（jsdom + 模拟布局）");
await testPaginate();

console.log("[8] 打印（矢量）样式与页面宽度约束");
testPrintCss();

console.log("[9] 排版回归（任务清单 / 标题锚点）");
testTypographyCss();

/**
 * 回归测试：浏览器打印曾经因为 .md-page 是 flex item、被 min-content 撑宽而右侧被裁切。
 */
function testPrintCss(): void {
  const tokens = resolveTokens(THEME_PRESETS[0]);
  const printCss = buildPrintCss({ tokens });
  const standalone = buildStandaloneHtml({
    tokens,
    meta,
    bodyHtml: html,
    flow: false,
    forPrint: true,
  });

  check("生成 @page 纸张尺寸", /@page\s*{[^}]*size:\s*210mm 297mm/.test(printCss));
  check("生成 @page 页边距", new RegExp(`margin:\\s*${tokens.marginMm}mm`).test(printCss));
  check(
    "打印时外壳改为块级（避免 flex 撑宽）",
    /\.md-doc-shell\s*{\s*display:\s*block\s*!important/.test(printCss),
  );
  check(
    "打印时页面宽度被约束到 100%",
    /\.md-page\s*{[^}]*width:\s*100%\s*!important/.test(printCss) &&
      /\.md-page\s*{[^}]*max-width:\s*100%\s*!important/.test(printCss),
  );
  check(
    "打印时解除 min-width 自动最小值",
    /\.md-page\s*{[^}]*min-width:\s*0\s*!important/.test(printCss),
  );
  check(
    "打印时代码块折行而非裁切",
    /pre\.md-code-block\s*{[^}]*white-space:\s*pre-wrap\s*!important/.test(printCss),
  );
  check(
    "打印时表格允许折行",
    /\.md-body th,\s*\.md-body td\s*{\s*overflow-wrap:\s*anywhere/.test(printCss),
  );
  check(
    "打印时页面允许纵向溢出可见",
    /\.md-page\s*{[^}]*overflow:\s*visible\s*!important/.test(printCss),
  );
  check("独立打印文档包含修复后的样式", standalone.includes("display: block !important"));
  check("独立打印文档包含 @page", standalone.includes("@page"));

  // 页面尺寸应随纸张/方向变化
  const landscape = buildPrintCss({
    tokens: { ...tokens, orientation: "landscape" as const },
  });
  check("横向时宽高互换", /size:\s*297mm 210mm/.test(landscape));
  const a5 = buildPrintCss({ tokens: { ...tokens, pageSize: "A5" as const } });
  check("小纸张尺寸生效", /size:\s*148mm 210mm/.test(a5));
  const withBreaks = buildPrintCss({
    tokens: { ...tokens, pageBreakBeforeH1: true, pageBreakBeforeH2: true },
  });
  check("分页开关生效", withBreaks.includes("h1 { break-before: page; }") && withBreaks.includes("h2 { break-before: page; }"));
}

/** 取出所有规则的选择器与规则体（用于 CSS 回归断言） */
function cssRules(css: string, selectorPart: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (selector.includes(selectorPart)) out.push({ selector, body: m[2] });
  }
  return out;
}

/** 选择器（逗号分隔）中任一项以给定片段结尾 */
function selectorEndsWith(selector: string, part: string): boolean {
  return selector.split(",").some((s) => s.trim().endsWith(part));
}

/**
 * 回归测试：
 * 1. 任务清单曾经用 `li{margin-left:-1.4em}` + `.contains-task-list{padding-left:.4em}`，
 *    净位移 -1em，复选框跑到版心左侧外面。
 * 2. 标题锚点曾经是行内元素（opacity:0 但占位），把标题整体推右约 1.6em。
 */
function testTypographyCss(): void {
  const anchor = cssRules(BASE_CSS, ".md-anchor").map((r) => r.body);
  check("存在标题锚点样式", anchor.length > 0);
  check("锚点已绝对定位（不占行内空间）", anchor.some((b) => /position:\s*absolute/.test(b)));
  check("锚点不再有行内 margin-right", anchor.every((b) => !/margin-right/.test(b)));

  const headings = cssRules(BASE_CSS, ".md-body h1").map((r) => r.body);
  check("标题建立定位上下文", headings.some((b) => /position:\s*relative/.test(b)));

  const taskItem = cssRules(BASE_CSS, "li.task-list-item").filter((r) =>
    selectorEndsWith(r.selector, "li.task-list-item"),
  );
  check("存在任务清单项样式", taskItem.length > 0);
  check(
    "任务清单项不再使用负外边距",
    taskItem.every((r) => !/margin-left:\s*-/.test(r.body)),
    taskItem.map((r) => `${r.selector} {${r.body}}`).join(" | "),
  );

  const checkbox = cssRules(BASE_CSS, "task-list-item-checkbox").map((r) => r.body);
  check(
    "复选框改挂在 marker 区域",
    checkbox.some((b) => /margin-left:\s*-1\.25em/.test(b)),
    checkbox.join(" | "),
  );

  const contains = cssRules(BASE_CSS, ".contains-task-list").map((r) => r.body);
  check(
    "不再缩小 contains-task-list 内边距",
    contains.every((b) => !/padding-left/.test(b)),
    contains.join(" | "),
  );

  // 结构验证：复选框确实是 li 的直接子元素（负外边距才能正确挂到 marker 区）
  const rendered = renderTokens(parse("- [x] 完成项\n- [ ] 待办项").tokens);
  check("任务清单含 checkbox", rendered.includes("task-list-item-checkbox"));
  check(
    "任务清单 checkbox 紧跟在 li 之后",
    /<li class="task-list-item">\s*<input class="task-list-item-checkbox"/.test(rendered),
    rendered.slice(0, 200),
  );

  // 锚点在标题内部，且应当是标题的第一个子元素
  const headingHtml = renderTokens(parse("## 小节").tokens);
  check("标题锚点在标题内部", /<h2[^>]*>\s*<a class="md-anchor"/.test(headingHtml), headingHtml);
}

console.log("[10] 资源库（字体 / 图片）");
await testAssets();

/** 构造一个只含 name 表的最小 TTF，用于验证字体元信息解析 */
function buildTestFont(names: { id: number; text: string }[]): ArrayBuffer {
  const encode = (s: string): number[] => {
    const out: number[] = [];
    for (const ch of s) {
      const code = ch.charCodeAt(0);
      out.push((code >> 8) & 0xff, code & 0xff);
    }
    return out;
  };
  const strings = names.map((n) => encode(n.text));
  const stringOffset = 6 + names.length * 12;
  const stringLen = strings.reduce((sum, s) => sum + s.length, 0);
  const nameTableLen = stringOffset + stringLen;
  const tableOffset = 28;
  const buffer = new ArrayBuffer(tableOffset + nameTableLen);
  const view = new DataView(buffer);

  view.setUint32(0, 0x00010000);
  view.setUint16(4, 1);
  for (let i = 0; i < 4; i++) view.setUint8(12 + i, "name".charCodeAt(i));
  view.setUint32(12 + 8, tableOffset);
  view.setUint32(12 + 12, nameTableLen);

  view.setUint16(tableOffset, 0);
  view.setUint16(tableOffset + 2, names.length);
  view.setUint16(tableOffset + 4, stringOffset);
  let cursor = 0;
  names.forEach((n, i) => {
    const rec = tableOffset + 6 + i * 12;
    view.setUint16(rec, 3);
    view.setUint16(rec + 2, 1);
    view.setUint16(rec + 4, 0x0409);
    view.setUint16(rec + 6, n.id);
    view.setUint16(rec + 8, strings[i].length);
    view.setUint16(rec + 10, cursor);
    cursor += strings[i].length;
  });
  let p = tableOffset + stringOffset;
  for (const s of strings) for (const byte of s) view.setUint8(p++, byte);
  return buffer;
}

async function testAssets(): Promise<void> {
  // 字体栈工具
  check("prependFamily 前置族名", prependFamily("My Font", "serif") === '"My Font", serif');
  check("prependFamily 去重", prependFamily("My Font", '"My Font", serif') === '"My Font", serif');
  check("removeFamily 移除", removeFamily("My Font", '"My Font", serif') === "serif");
  check("removeFamily 不误删", removeFamily("Other", "serif") === "serif");
  check("primaryFamily 取首项", primaryFamily('"My Font", serif') === "My Font");
  check("primaryFamily 回退", primaryFamily("", "sans-serif") === "sans-serif");
  check(
    "stripKnownFamilies 清理自定义字体",
    stripKnownFamilies('"A", "B", serif', [
      { family: "A" } as FontAsset,
      { family: "B" } as FontAsset,
    ]) === "serif",
  );

  // 字体元信息解析（合成 TTF）
  const ttf = buildTestFont([
    { id: 1, text: "Test Font" },
    { id: 2, text: "Bold Italic" },
  ]);
  const fontMeta = await parseFontMeta(ttf, "TestFont-BoldItalic.ttf");
  check("解析字体族名", fontMeta.family === "Test Font", fontMeta.family);
  check("解析字体字重", fontMeta.weight === 700, String(fontMeta.weight));
  check("解析字体斜体", fontMeta.style === "italic", fontMeta.style);
  const fallbackMeta = await parseFontMeta(new ArrayBuffer(8), "Weird_Font-Name.otf");
  check("无法解析时回退文件名", fallbackMeta.family === "Weird Font Name", fallbackMeta.family);

  const fontAsset: FontAsset = {
    id: "f1",
    kind: "font",
    name: "MyFont.ttf",
    family: "My Font",
    weight: 400,
    style: "normal",
    format: "truetype",
    mime: "font/ttf",
    size: 1024,
    dataUrl: "data:font/ttf;base64,AAAA",
    createdAt: 1,
  };
  const fontCss = buildFontFaceCss([fontAsset], "block");
  check("生成 @font-face", fontCss.includes("@font-face"));
  check("@font-face 内联 data URL", fontCss.includes("url(\"data:font/ttf;base64,AAAA\")"));
  check("@font-face 声明字重/字形", /font-weight:\s*400/.test(fontCss) && /font-style:\s*normal/.test(fontCss));

  const withFonts = buildStandaloneHtml({
    tokens,
    meta,
    bodyHtml: html,
    flow: true,
    forPrint: true,
    fonts: [fontAsset],
  });
  check("单文件 HTML 内联字体", withFonts.includes('id="md-fonts"'));
  check("单文件 HTML 含 @font-face", withFonts.includes("@font-face"));

  // 图片引用解析
  const tinyPng =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const imageAsset: ImageAsset = {
    id: "img1",
    kind: "image",
    name: "pic",
    filename: "pic.png",
    mime: "image/png",
    size: 100,
    width: 1,
    height: 1,
    dataUrl: tinyPng,
    createdAt: 1,
  };
  const assetMap: AssetMap = { f1: fontAsset, img1: imageAsset };
  check("resolveAssetSrc 解析引用", resolveAssetSrc("asset://img1", assetMap) === tinyPng);
  check("resolveAssetSrc 保留外链", resolveAssetSrc("https://x/y.png", assetMap) === "https://x/y.png");
  check("resolveAssetSrc 缺失时占位", resolveAssetSrc("asset://nope", assetMap).startsWith("data:image/svg+xml"));

  const assetParsed = parse("![图](asset://img1)");
  assetParsed.env.assets = assetMap;
  const assetHtml = renderTokens(assetParsed.tokens, assetParsed.env);
  check("渲染时内联 data URL", assetHtml.includes(tinyPng));
  check("渲染后不残留 asset://", !assetHtml.includes("asset://"));

  // 导出层：带资源不抛错且能识别图片
  const assetMd = "# 资源测试\n\n![图](asset://img1)\n";
  const pptx = buildPptxPresentation(assetMd, tokens, meta, pptxOpts, assetMap);
  check("PPTX 支持资源图片", pptx.slideCount >= 1, String(pptx.slideCount));
  const docx = buildDocxDocument(assetMd, tokens, meta, docxOpts, assetMap);
  check("DOCX 支持资源图片", docx.paragraphs >= 1, String(docx.paragraphs));
}

console.log("[11] 标题自动编号（1 / 1.2 / 1.2.2）");
testHeadingNumbers();

function testHeadingNumbers(): void {
  const nums = computeHeadingNumbers([1, 2, 3, 2, 3, 1, 2]);
  check(
    "多级序号为 1/1.1/1.1.1/1.2/1.2.1/2/2.1",
    nums.join(",") === "1,1.1,1.1.1,1.2,1.2.1,2,2.1",
    nums.join(","),
  );
  check("跳级时补零", computeHeadingNumbers([1, 4]).join(",") === "1,1.0.0.1", computeHeadingNumbers([1, 4]).join(","));
  check(
    "限制编号层级",
    computeHeadingNumbers([1, 2, 3, 4], 2).join(",") === "1,1.1,,",
    computeHeadingNumbers([1, 2, 3, 4], 2).join(","),
  );
  check("同级计数器递增", computeHeadingNumbers([1, 1]).join(",") === "1,2");

  const seq = renderTokens(withHeadingNumbers(parse("# A\n## B\n### C\n## D").tokens));
  check("渲染包含序号 span", seq.includes('class="md-secnum"'));
  check("三级序号 1.1.1", seq.includes("1.1.1 </span>"), seq.slice(0, 260));
  check("同级递增 1.2", seq.includes("1.2 </span>"), seq.slice(0, 260));

  const limited = renderTokens(withHeadingNumbers(parse("# A\n## B\n### C").tokens, 2));
  const count = (limited.match(/md-secnum/g) ?? []).length;
  check("限制层级时只编号 H1/H2", count === 2, String(count));
  check("被限制的 H3 不编号", !limited.includes("1.1.1"));

  // 跳过 / 忽略某个标题
  const skipped = renderTokens(
    withHeadingNumbers(parse("# A\n\n## 摘要 {.no-number}\n\n## B").tokens),
  );
  const skipCount = (skipped.match(/md-secnum/g) ?? []).length;
  check("带 .no-number 的标题不编号", skipCount === 2, String(skipCount));
  check("被跳过的标题保留 class", skipped.includes("no-number"));
  check("跳过标题不占用编号（下一标题仍为 1.1）", skipped.includes("1.1 </span>"), skipped);
  const skipped2 = renderTokens(
    withHeadingNumbers(parse("# A\n\n## 附录 {.unnumbered}\n\n## B").tokens),
  );
  check(".unnumbered 同样生效", (skipped2.match(/md-secnum/g) ?? []).length === 2);

  const defaultTokens = resolveTokens(THEME_PRESETS[0]);
  check("标题编号默认开启", defaultTokens.headingNumbered === true);
  check("默认编号到 H6", defaultTokens.headingNumberMaxLevel === 6, String(defaultTokens.headingNumberMaxLevel));

  const docxNumbered = buildDocxDocument("# A\n\n## B\n", defaultTokens, meta, {
    ...docxOpts,
    headingNumbered: true,
  });
  check("DOCX 开启标题编号不报错", docxNumbered.paragraphs >= 2, String(docxNumbered.paragraphs));
}

console.log("[12] 文档文件与自定义主题");
testBundleAndThemes();

function testBundleAndThemes(): void {
  const tinyPng =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const image = {
    id: "img1",
    kind: "image" as const,
    name: "pic",
    filename: "pic.png",
    mime: "image/png",
    size: 100,
    width: 1,
    height: 1,
    dataUrl: tinyPng,
    createdAt: 1,
  };
  const bundle = buildDocumentBundle({
    markdown: "# X\n\n![图](asset://img1)\n",
    tokens,
    meta,
    presetId: "academic",
    images: [image],
  });
  check("文档文件格式标记", bundle.format === BUNDLE_FORMAT, bundle.format);
  const round = parseDocumentBundle(JSON.stringify(bundle));
  check("文档文件往返 Markdown", round.markdown === "# X\n\n![图](asset://img1)\n");
  check("文档文件携带图片", round.images.length === 1 && round.images[0].id === "img1");
  check("文档文件保留主题", round.tokens.headingNumbered === tokens.headingNumbered);
  check("looksLikeDocumentBundle 识别文档文件", looksLikeDocumentBundle(JSON.stringify(bundle)));
  check("普通 Markdown 不被误判", !looksLikeDocumentBundle("# Title\n\n正文"));
  let threw = false;
  try {
    parseDocumentBundle("{}");
  } catch {
    threw = true;
  }
  check("非法文档文件报错", threw);
  const badImage = parseDocumentBundle(
    JSON.stringify({ ...bundle, images: [{ id: "x", kind: "image" }] }),
  );
  check("过滤不完整的图片记录", badImage.images.length === 0);

  check("用户主题 id 往返", fromUserThemeId(toUserThemeId("abc")) === "abc");
  check("识别用户主题 id", isUserThemeId(toUserThemeId("abc")) && !isUserThemeId("academic"));
  check("新主题 id 唯一", newUserThemeId() !== newUserThemeId());
}

console.log("[13] 列表行距 / 缩进与版心约束");
testListLayout();

function testListLayout(): void {
  const t = resolveTokens(THEME_PRESETS[0]);
  const vars = buildVars(t);
  check("CSS 变量含列表缩进", /--md-list-indent:\s*1\.7em/.test(vars));
  check(
    "基础样式用变量控制缩进",
    /:where\(ul, ol\)\s*{[^}]*padding-left:\s*var\(--md-list-indent\)/.test(BASE_CSS),
  );
  check("基础样式不再写死缩进", !/padding-left:\s*1\.7em/.test(BASE_CSS));
  check("列表项允许任意断行", /\.md-body li\s*{[^}]*overflow-wrap:\s*anywhere/.test(BASE_CSS));
  check("列表有 max-width 保护", /:where\(ul, ol\)\s*{[^}]*max-width:\s*100%/.test(BASE_CSS));

  const auto = buildThemeStyle({ ...t, listAutoFit: true }, ":root");
  check(
    "自动收缩：深层缩进递减",
    auto.includes("min(var(--md-list-indent), 1.5em)") && auto.includes("min(var(--md-list-indent), 1em)"),
  );
  check("自动收缩：约束列表内块级元素", /\.md-body li :where\(pre, table, blockquote/.test(auto));
  check("自动收缩：含运行时兜底类", auto.includes(".md-list-tight"));
  const off = buildThemeStyle({ ...t, listAutoFit: false }, ":root");
  check("关闭时不输出收缩规则", !off.includes("min(var(--md-list-indent), 1.5em)"));
  check("关闭时仍保留缩进变量", off.includes("padding-left: var(--md-list-indent)"));

  const line = buildThemeStyle({ ...t, listLineHeight: 1.4 }, ":root");
  check("列表行距写入 CSS", /\.md-body li\s*{\s*line-height:\s*1\.4/.test(line));
  const noLine = buildThemeStyle({ ...t, listLineHeight: 0 }, ":root");
  check("行距为 0 时不覆盖正文行高", !/\.md-body li\s*{\s*line-height/.test(noLine));

  const printCss = buildPrintCss({ tokens: t });
  check("打印时列表不超出版心", /:where\(ul, ol\)\s*{[^}]*max-width:\s*100%/.test(printCss));

  const docxList = buildDocxDocument(
    "- 一级\n  - 二级\n    - 三级\n      - 四级\n        - 五级\n",
    { ...t, listIndent: 2, listLineHeight: 1.5 },
    meta,
    { ...docxOpts, headingNumbered: false },
  );
  check("DOCX 深层列表不报错", docxList.paragraphs >= 1, String(docxList.paragraphs));
}

console.log("");
if (failures > 0) {
  console.error(`❌ 冒烟测试失败：${failures} 项`);
  process.exit(1);
}
console.log("✅ 全部冒烟测试通过");
