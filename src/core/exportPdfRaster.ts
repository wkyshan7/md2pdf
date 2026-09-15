import type { ExportMeta, RasterPdfOptions, ThemeTokens } from "./types";
import { PAGE_SIZES } from "./types";
import { mmToPx, waitForAssets } from "./dom";
import { fitOverflowingLists, fitPageOverflow } from "./listFit";
import { safeFilename } from "./download";

/**
 * 所见即所得 PDF：把预览页的真实 DOM 在离屏容器里按纸张尺寸重新分页，
 * 交给 html2canvas 渲染成位图，再由 jsPDF 写入页面。
 *
 * 因为画的就是浏览器排版后的结果，所以输出必然与预览一致；
 * 代价是文字不可选中（需要矢量文字时请用浏览器「打印为 PDF」）。
 */

/**
 * 单次 html2canvas 的画布高度上限（设备像素）。
 * 300 DPI 下 A4 单页高约 3508px，8000 意味着一次最多渲染 2 页，
 * 画布内存约 70MB，避免触及浏览器的 canvas 内存上限。
 */
const MAX_CANVAS_PX = 8000;

const PRINT_DOM_CSS = `
.md-print-page { border-radius: 0 !important; box-shadow: none !important; }
.md-print-body { position: relative; overflow-wrap: anywhere; }
.md-print-body pre.md-code-block { white-space: pre-wrap; overflow: visible; max-width: 100%; }
.md-print-body pre.md-code-block > code.hljs { white-space: pre-wrap; word-break: break-word; }
.md-print-body pre.md-code-block[data-lang]::after { content: none !important; }
.md-print-body .md-code-lang {
  position: absolute; top: 0.45em; right: 0.7em;
  font-family: var(--md-code-font); font-size: 0.72em; letter-spacing: 0.04em;
  color: var(--md-code-color); opacity: 0.4; pointer-events: none;
}
.md-print-body img, .md-print-body figure, .md-print-body svg { max-width: 100%; }
.md-print-body table { max-width: 100%; }
.md-print-body th, .md-print-body td { overflow-wrap: anywhere; word-break: break-word; }
.md-print-body .katex-display { max-width: 100%; }
`;

export interface RasterPdfProgress {
  done: number;
  total: number;
}

export interface RasterPdfResult {
  pages: number;
  widthMm: number;
  heightMm: number;
}

interface PreparedPages {
  strips: HTMLElement[];
  root: HTMLElement;
  style: HTMLStyleElement;
  clip: HTMLElement;
  pageW: number;
  pageH: number;
  widthMm: number;
  heightMm: number;
  dispose: () => void;
}

/* ── 分页 ──────────────────────────────────────────────── */

function fits(el: HTMLElement, maxHeight: number): boolean {
  return el.offsetTop + el.offsetHeight <= maxHeight + 0.5;
}

/** 在高度受限的容器里把内容切成多页；原始容器会被清空 */
export function paginate(body: HTMLElement, contentHeight: number): HTMLElement[][] {
  const pages: HTMLElement[][] = [];
  let guard = 0;

  while (body.firstElementChild && guard++ < 5000) {
    const children = Array.from(body.children) as HTMLElement[];

    let cut = -1;
    for (let i = 0; i < children.length; i++) {
      if (!fits(children[i], contentHeight)) {
        cut = i;
        break;
      }
    }

    // 剩余内容全部放得下 → 最后一页
    if (cut === -1) {
      pages.push(children);
      for (const c of children) c.remove();
      break;
    }

    // 首个元素就超高 → 尝试拆分
    if (cut === 0) {
      const first = children[0];
      const tail = splitElement(first, contentHeight);
      pages.push([first]);
      first.remove();
      if (tail) body.insertBefore(tail, body.firstChild);
      continue;
    }

    const page = children.slice(0, cut);
    for (const c of page) c.remove();
    pages.push(page);
  }

  return pages;
}

/** 把超高元素就地截成 head，返回 tail（无法拆分时返回 null） */
function splitElement(el: HTMLElement, maxHeight: number): HTMLElement | null {
  const tag = el.tagName;
  if (tag === "UL" || tag === "OL") return splitList(el, maxHeight);
  if (tag === "TABLE") return splitTable(el, maxHeight);
  return splitByText(el, maxHeight);
}

function splitList(el: HTMLElement, maxHeight: number): HTMLElement | null {
  const items = Array.from(el.children) as HTMLElement[];
  if (items.length < 2) return null;
  const base = el.offsetTop;

  let cut = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i].offsetTop + items[i].offsetHeight - base > maxHeight + 0.5) {
      cut = i;
      break;
    }
  }
  if (cut <= 0) return null;

  const tail = el.cloneNode(false) as HTMLElement;
  for (let i = cut; i < items.length; i++) tail.appendChild(items[i]);
  if (el.tagName === "OL") {
    tail.setAttribute("start", String(Number(el.getAttribute("start") ?? "1") + cut));
  }
  return tail;
}

function splitTable(el: HTMLElement, maxHeight: number): HTMLElement | null {
  const table = el as HTMLTableElement;
  const tbody = table.tBodies[0];
  if (!tbody) return null;
  const rows = Array.from(tbody.rows);
  if (rows.length < 2) return null;
  const base = el.offsetTop;

  let cut = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].offsetTop + rows[i].offsetHeight - base > maxHeight + 0.5) {
      cut = i;
      break;
    }
  }
  if (cut <= 0) return null;

  const tail = el.cloneNode(true) as HTMLTableElement;
  const tailBody = tail.tBodies[0];
  while (tailBody.rows.length) tailBody.deleteRow(0);
  for (let i = cut; i < rows.length; i++) tailBody.appendChild(rows[i]);
  return tail;
}

/**
 * 通用文本拆分：用 Range 测量「前 N 个字符占多高」，二分出能放下的最大前缀。
 * extractContents 会克隆被切开的祖先节点，因此 <pre><code>…</code></pre>、
 * <blockquote><p>…</p></blockquote> 之类的结构都能正确保留。
 */
function splitByText(el: HTMLElement, maxHeight: number): HTMLElement | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeValue && node.nodeValue.trim().length) textNodes.push(node as Text);
  }
  if (textNodes.length === 0) return null;

  const valueOf = (t: Text): string => t.nodeValue ?? "";
  const total = textNodes.reduce((sum, t) => sum + valueOf(t).length, 0);
  if (total < 2) return null;

  const locate = (offset: number): [Text, number] => {
    let acc = 0;
    for (const t of textNodes) {
      const len = valueOf(t).length;
      if (offset <= acc + len) return [t, offset - acc];
      acc += len;
    }
    const last = textNodes[textNodes.length - 1];
    return [last, valueOf(last).length];
  };

  const range = document.createRange();
  const top = el.getBoundingClientRect().top;
  const usedHeight = (offset: number): number => {
    const [n, o] = locate(offset);
    range.setStart(textNodes[0], 0);
    range.setEnd(n, o);
    const rect = range.getBoundingClientRect();
    return rect.height === 0 ? 0 : rect.bottom - top;
  };

  let lo = 1;
  let hi = total;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (usedHeight(mid) <= maxHeight) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best <= 0 || best >= total) return null;

  // 尽量不在英文单词中间断开（中文可任意断行）
  const [splitNode, rawOffset] = locate(best);
  const text = valueOf(splitNode);
  const isWordChar = (c: string | undefined): boolean => !!c && /[A-Za-z0-9]/.test(c);
  let splitOffset = rawOffset;
  if (isWordChar(text[splitOffset - 1]) && isWordChar(text[splitOffset])) {
    let back = splitOffset;
    while (back > 0 && isWordChar(text[back - 1])) back--;
    if (back > 0) splitOffset = back;
  }

  const tailRange = document.createRange();
  tailRange.setStart(splitNode, splitOffset);
  tailRange.setEndAfter(textNodes[textNodes.length - 1]);
  const fragment = tailRange.extractContents();
  if (!fragment.textContent || !fragment.textContent.trim()) return null;

  const tail = el.cloneNode(false) as HTMLElement;
  tail.appendChild(fragment);
  return tail;
}

/* ── 离屏排版 ─────────────────────────────────────────── */

function createOffscreen(clip: HTMLElement): HTMLElement {
  const root = document.createElement("div");
  root.style.cssText = "position:absolute;left:0;top:0;";
  clip.appendChild(root);
  return root;
}

function preparePages(sourcePage: HTMLElement, tokens: ThemeTokens): PreparedPages {
  const dims = PAGE_SIZES[tokens.pageSize];
  const [wmm, hmm] = tokens.orientation === "landscape" ? [dims.h, dims.w] : [dims.w, dims.h];
  const pageW = mmToPx(wmm);
  const pageH = mmToPx(hmm);
  const marginPx = mmToPx(tokens.marginMm);
  const contentH = pageH - marginPx * 2;

  const style = document.createElement("style");
  style.textContent = PRINT_DOM_CSS;
  document.head.appendChild(style);

  const clip = document.createElement("div");
  clip.setAttribute("aria-hidden", "true");
  // 参照 html2pdf.js 的做法：整体移到视口外，但仍保持可测量与可绘制
  clip.style.cssText =
    `position:fixed;left:-100000px;top:0;width:${pageW}px;z-index:-1;overflow:hidden;pointer-events:none;`;
  document.body.appendChild(clip);
  const root = createOffscreen(clip);

  const stripStyle = (fixedHeight: boolean): string =>
    `width:${pageW}px;${fixedHeight ? `height:${pageH}px;` : ""}min-height:0;` +
    `padding:${marginPx}px;box-sizing:border-box;background:${tokens.bgColor};` +
    "position:relative;overflow:hidden;";

  // 1. 测量页：按纸张版心宽度重新排版
  const measurePage = document.createElement("div");
  measurePage.className = "md-page md-print-page";
  measurePage.style.cssText = stripStyle(false) + "height:auto;overflow:visible;";
  const measureBody = document.createElement("article");
  measureBody.className = "md-body md-print-body";
  const sourceBody = sourcePage.querySelector(".md-body");
  measureBody.innerHTML = sourceBody ? sourceBody.innerHTML : "";
  measurePage.appendChild(measureBody);
  root.appendChild(measurePage);

  // 代码语言标签：::after 在 html2canvas 上不可靠，改成真实元素
  measureBody.querySelectorAll<HTMLElement>("pre.md-code-block[data-lang]").forEach((pre) => {
    const lang = pre.getAttribute("data-lang");
    if (!lang) return;
    const span = document.createElement("span");
    span.className = "md-code-lang";
    span.textContent = lang;
    pre.appendChild(span);
  });

  // 2. 列表 / 内容溢出兜底：按纸张版心宽度重新实测一次
  fitOverflowingLists(measureBody);
  fitPageOverflow(measurePage);

  // 3. 分页
  const groups = paginate(measureBody, contentH);
  measurePage.remove();

  // 4. 生成每页 DOM
  const strips: HTMLElement[] = groups.map((nodes) => {
    const strip = document.createElement("div");
    strip.className = "md-page md-print-page";
    strip.style.cssText = stripStyle(true);
    const body = document.createElement("article");
    body.className = "md-body md-print-body";
    for (const n of nodes) body.appendChild(n);
    strip.appendChild(body);
    return strip;
  });

  if (strips.length === 0) {
    const strip = document.createElement("div");
    strip.className = "md-page md-print-page";
    strip.style.cssText = stripStyle(true);
    const body = document.createElement("article");
    body.className = "md-body md-print-body";
    strip.appendChild(body);
    strips.push(strip);
  }

  return {
    strips,
    root,
    style,
    clip,
    pageW,
    pageH,
    widthMm: wmm,
    heightMm: hmm,
    dispose: () => {
      root.replaceChildren();
      clip.remove();
      style.remove();
    },
  };
}

function addRunningElements(
  strip: HTMLElement,
  tokens: ThemeTokens,
  meta: ExportMeta,
  options: RasterPdfOptions,
  pageIndex: number,
  total: number,
): void {
  const marginPx = mmToPx(tokens.marginMm);
  const offset = Math.max(6, marginPx * 0.3);
  const base =
    `position:absolute;left:${marginPx}px;right:${marginPx}px;text-align:center;` +
    "font-family:var(--md-font);font-size:11px;color:#8a94a6;";

  const header = meta.header.trim();
  if (header) {
    const el = document.createElement("div");
    el.style.cssText = `${base}top:${offset}px;`;
    el.textContent = header;
    strip.appendChild(el);
  }

  const parts = [meta.footer.trim()];
  if (options.pageNumbers) parts.push(`${pageIndex + 1} / ${total}`);
  const footer = parts.filter(Boolean).join("    ");
  if (footer) {
    const el = document.createElement("div");
    el.style.cssText = `${base}bottom:${offset}px;`;
    el.textContent = footer;
    strip.appendChild(el);
  }
}

/** 把跨域图片转成 data URL，规避 canvas 污染导致导出失败 */
async function inlineExternalImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute("src") ?? "";
      if (!src || src.startsWith("data:")) return;
      try {
        const res = await fetch(src, { mode: "cors" });
        if (!res.ok) return;
        const blob = await res.blob();
        img.src = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      } catch {
        /* 保留原样，交给 html2canvas 处理 */
      }
    }),
  );
}

/* ── 主流程 ───────────────────────────────────────────── */

export async function exportRasterPdf(
  sourcePage: HTMLElement,
  tokens: ThemeTokens,
  meta: ExportMeta,
  options: RasterPdfOptions,
  onProgress?: (p: RasterPdfProgress) => void,
): Promise<RasterPdfResult> {
  const [{ jsPDF }, html2canvasModule] = await Promise.all([import("jspdf"), import("html2canvas")]);
  const html2canvas = html2canvasModule.default;

  const prepared = preparePages(sourcePage, tokens);
  const { strips, root, pageW, pageH, widthMm, heightMm, dispose } = prepared;

  strips.forEach((strip, index) =>
    addRunningElements(strip, tokens, meta, options, index, strips.length),
  );

  const orientation = tokens.orientation === "landscape" ? "landscape" : "portrait";
  const pdf = new jsPDF({ unit: "mm", format: [widthMm, heightMm], orientation, compress: true });

  const scale = Math.max(1, options.dpi / 96);
  const pagesPerChunk = Math.max(1, Math.floor(MAX_CANVAS_PX / (pageH * scale)));
  const bg = tokens.bgColor;

  let rendered = 0;
  try {
    for (let start = 0; start < strips.length; start += pagesPerChunk) {
      const chunk = strips.slice(start, start + pagesPerChunk);
      root.replaceChildren(...chunk);
      await inlineExternalImages(root);
      await waitForAssets(root);

      const canvas = await html2canvas(root, {
        scale,
        backgroundColor: bg,
        logging: false,
        useCORS: true,
        allowTaint: false,
        width: Math.ceil(pageW),
        height: Math.ceil(pageH * chunk.length),
        windowWidth: Math.ceil(pageW),
        windowHeight: Math.ceil(pageH * chunk.length),
      });

      const sliceH = Math.max(1, Math.floor(canvas.height / chunk.length));
      for (let i = 0; i < chunk.length; i++) {
        const top = i * sliceH;
        const height = Math.min(sliceH, canvas.height - top);
        if (height <= 0) continue;

        const slice = document.createElement("canvas");
        slice.width = canvas.width;
        slice.height = height;
        const ctx = slice.getContext("2d");
        if (!ctx) continue;
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(canvas, 0, top, canvas.width, height, 0, 0, canvas.width, height);

        const data =
          options.imageFormat === "png"
            ? slice.toDataURL("image/png")
            : slice.toDataURL("image/jpeg", options.jpegQuality);

        if (rendered > 0) pdf.addPage([widthMm, heightMm], orientation);
        pdf.addImage(
          data,
          options.imageFormat === "png" ? "PNG" : "JPEG",
          0,
          0,
          widthMm,
          heightMm,
          undefined,
          "FAST",
        );
        rendered++;
        onProgress?.({ done: rendered, total: strips.length });
      }

      // 尽早释放画布内存（大尺寸画布在长文档下很可观）
      canvas.width = 0;
      canvas.height = 0;
    }

    pdf.save(`${safeFilename(meta.title, "document")}.pdf`);
    return { pages: strips.length, widthMm, heightMm };
  } finally {
    dispose();
  }
}
