import PptxGenJS from "pptxgenjs";
import type { Token } from "markdown-it";
import { parse } from "./parser";
import type { ExportMeta, PptxOptions, ThemeTokens } from "./types";
import { safeFilename } from "./download";

/* ── 中间表示 ─────────────────────────────────────────── */

type Block =
  | { kind: "bullets"; items: { text: string; level: number; ordered: boolean }[] }
  | { kind: "paragraph"; text: string; sub: boolean }
  | { kind: "code"; text: string; lang: string }
  | { kind: "quote"; text: string }
  | { kind: "table"; rows: string[][] }
  | { kind: "image"; src: string; alt: string };

interface Slide {
  title: string;
  kind: "title" | "section" | "content";
  blocks: Block[];
}

/* ── token → 纯文本 ───────────────────────────────────── */

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

function inlineText(token: Token | undefined): string {
  if (!token) return "";
  if (!token.children) return stripHtml(token.content);
  let out = "";
  for (const c of token.children) {
    switch (c.type) {
      case "softbreak":
        out += " ";
        break;
      case "hardbreak":
        out += "\n";
        break;
      case "code_inline":
        out += c.content;
        break;
      case "image":
        out += c.content ? `图：${c.content}` : "图";
        break;
      case "math_inline":
        out += `$${c.content}$`;
        break;
      case "html_inline":
        out += stripHtml(c.content);
        break;
      default:
        out += c.content;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

function inlineImages(token: Token | undefined): { src: string; alt: string }[] {
  if (!token?.children) return [];
  return token.children
    .filter((c) => c.type === "image")
    .map((c) => ({ src: String(c.attrGet("src") ?? ""), alt: c.content || "" }));
}

/* ── 结构切分：markdown → slides ─────────────────────── */

function buildSlides(markdown: string, splitLevel: 1 | 2): Slide[] {
  const { tokens } = parse(markdown);
  const slides: Slide[] = [];
  let current: Slide | null = null;
  const ctx: string[] = [];
  const listStack: { ordered: boolean; index: number }[] = [];
  let pendingFirstHeading = true;

  const ensure = (): Slide => {
    if (!current) {
      current = { title: "", kind: "content", blocks: [] };
      slides.push(current);
    }
    return current;
  };

  const startSlide = (title: string, kind: Slide["kind"]): void => {
    const isFirst = pendingFirstHeading && slides.length === 0;
    current = { title, kind: kind === "title" || !isFirst ? kind : "title", blocks: [] };
    slides.push(current);
    pendingFirstHeading = false;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const parent = ctx[ctx.length - 1];

    if (t.type === "heading_open") {
      const level = Number(t.tag.slice(1));
      const text = inlineText(tokens[i + 1]);
      if (level <= splitLevel) {
        startSlide(text, level === 1 ? "section" : "content");
      } else {
        ensure().blocks.push({ kind: "paragraph", text, sub: true });
      }
      continue;
    }

    if (t.type === "paragraph_open") continue;

    if (t.type === "fence" || t.type === "code_block") {
      ensure().blocks.push({ kind: "code", text: t.content.replace(/\n$/, ""), lang: t.info || "" });
      continue;
    }

    if (t.type === "hr") {
      continue;
    }

    if (t.type === "blockquote_open") {
      // 收集整段引用
      let j = i + 1;
      const parts: string[] = [];
      while (j < tokens.length && tokens[j].type !== "blockquote_close") {
        if (tokens[j].type === "inline") parts.push(inlineText(tokens[j]));
        j++;
      }
      ensure().blocks.push({ kind: "quote", text: parts.join("\n") });
      i = j;
      continue;
    }

    if (t.type === "table_open") {
      const rows: string[][] = [];
      let row: string[] | null = null;
      let j = i + 1;
      while (j < tokens.length && tokens[j].type !== "table_close") {
        const tt = tokens[j];
        if (tt.type === "tr_open") row = [];
        else if (tt.type === "tr_close") {
          if (row) rows.push(row);
          row = null;
        } else if (tt.type === "inline" && row) row.push(inlineText(tt));
        j++;
      }
      ensure().blocks.push({ kind: "table", rows });
      i = j;
      continue;
    }

    if (t.type === "inline") {
      const imgs = inlineImages(t);
      const text = inlineText(t);
      if (parent === "paragraph" || parent === "heading") {
        if (imgs.length && !text.replace(/图：.*/g, "").trim()) {
          for (const img of imgs) ensure().blocks.push({ kind: "image", src: img.src, alt: img.alt });
        } else if (text) {
          if (imgs.length) for (const img of imgs) ensure().blocks.push({ kind: "image", src: img.src, alt: img.alt });
          ensure().blocks.push({ kind: "paragraph", text, sub: false });
        }
      } else if (ctx.includes("list_item")) {
        const list = listStack[listStack.length - 1];
        if (list && text) {
          list.index += 1;
          ensure().blocks.push({
            kind: "bullets",
            items: [{ text, level: Math.max(0, listStack.length - 1), ordered: list.ordered }],
          });
        }
      }
      continue;
    }

    if (t.type === "bullet_list_open") listStack.push({ ordered: false, index: 0 });
    else if (t.type === "ordered_list_open") listStack.push({ ordered: true, index: 0 });
    else if (t.type === "bullet_list_close" || t.type === "ordered_list_close") listStack.pop();

    if (t.nesting === 1) ctx.push(t.type.replace(/_open$/, ""));
    else if (t.nesting === -1) ctx.pop();
  }

  return slides.filter((s) => s.kind !== "content" || s.blocks.length > 0 || s.title);
}

/* ── PPTX 渲染 ───────────────────────────────────────── */

const hex = (c: string): string => c.replace("#", "").toUpperCase();

export interface PptxResult {
  slideCount: number;
}

/** 仅构建演示文稿对象（便于测试/复用），不写文件 */
export function buildPptxPresentation(
  markdown: string,
  tokens: ThemeTokens,
  meta: ExportMeta,
  options: PptxOptions,
): { pres: PptxGenJS; slideCount: number } {
  const pres = new PptxGenJS();
  pres.layout = options.slideSize === "4:3" ? "LAYOUT_4x3" : "LAYOUT_16x9";
  pres.title = meta.title || "Markdown 演示";
  pres.author = meta.author || "MD Studio";
  pres.subject = meta.subject || "";

  const W = options.slideSize === "4:3" ? 10 : 13.333;
  const H = 7.5;
  const M = 0.72;
  const CW = W - M * 2;

  const bg = hex(tokens.pptxBg);
  const accent = hex(tokens.pptxAccent);
  const titleColor = hex(tokens.pptxTitleColor);
  const bodyColor = hex(tokens.pptxBodyColor);

  const slides = buildSlides(markdown, options.splitLevel);
  let produced = 0;

  const addBg = (slide: PptxGenJS.Slide): void => {
    slide.background = { color: bg };
  };

  const addAccentBar = (slide: PptxGenJS.Slide, x: number, y: number, h = 0.55): void => {
    slide.addShape(pres.ShapeType.rect, { x, y, w: 0.07, h, fill: { color: accent }, line: { color: accent } });
  };

  const titleSlide = (title: string, subtitle: string): void => {
    const slide = pres.addSlide();
    addBg(slide);
    slide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.28, fill: { color: accent }, line: { color: accent } });
    slide.addText(title, {
      x: M, y: H / 2 - 1.4, w: CW, h: 1.5,
      fontSize: 40, bold: true, color: titleColor, align: "left", valign: "bottom", fontFace: "Microsoft YaHei",
    });
    slide.addShape(pres.ShapeType.rect, { x: M, y: H / 2 + 0.18, w: 1.6, h: 0.06, fill: { color: accent }, line: { color: accent } });
    if (subtitle) {
      slide.addText(subtitle, {
        x: M, y: H / 2 + 0.5, w: CW, h: 1,
        fontSize: 16, color: bodyColor, align: "left", fontFace: "Microsoft YaHei",
      });
    }
    produced++;
  };

  const contentSlide = (title: string, continuation: boolean): PptxGenJS.Slide => {
    const slide = pres.addSlide();
    addBg(slide);
    if (title) {
      addAccentBar(slide, M, 0.5, 0.5);
      slide.addText(continuation ? `${title}（续）` : title, {
        x: M + 0.22, y: 0.38, w: CW - 0.3, h: 0.8,
        fontSize: 26, bold: true, color: titleColor, valign: "middle", fontFace: "Microsoft YaHei",
      });
      slide.addShape(pres.ShapeType.line, {
        x: M, y: 1.28, w: CW, h: 0, line: { color: "D8DEE9", width: 1 },
      });
    }
    produced++;
    return slide;
  };

  let yTop = 1.55;
  const bottom = H - 0.55;

  for (const s of slides) {
    if (s.kind === "title") {
      const first = s.blocks.find((b) => b.kind === "paragraph");
      titleSlide(s.title, first && first.kind === "paragraph" ? first.text : meta.author);
      continue;
    }
    if (s.kind === "section" && options.includeTitleSlide) {
      const slide = pres.addSlide();
      addBg(slide);
      slide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: accent }, line: { color: accent } });
      slide.addText(s.title, {
        x: M, y: H / 2 - 0.8, w: CW, h: 1.6,
        fontSize: 34, bold: true, color: "FFFFFF", align: "left", valign: "middle", fontFace: "Microsoft YaHei",
      });
      produced++;
      continue;
    }

    // 内容幻灯片：按 bulletsPerSlide 自动分页
    let slide = contentSlide(s.title, false);
    let y = yTop;
    let bulletBuffer: { text: string; level: number; ordered: boolean }[] = [];

    const flushBullets = (): void => {
      if (!bulletBuffer.length) return;
      if (y + bulletBuffer.length * 0.42 > bottom) {
        slide = contentSlide(s.title, true);
        y = yTop;
      }
      slide.addText(
        bulletBuffer.map((b) => ({
          text: b.text,
          options: { bullet: b.ordered ? { type: "number" as const } : true, indentLevel: b.level },
        })),
        {
          x: M + 0.1, y, w: CW - 0.2, h: Math.min(bottom - y, bulletBuffer.length * 0.45 + 0.3),
          fontSize: 17, color: bodyColor, valign: "top", fontFace: "Microsoft YaHei",
          lineSpacingMultiple: 1.1,
        },
      );
      y += bulletBuffer.length * 0.42 + 0.16;
      bulletBuffer = [];
    };

    for (const b of s.blocks) {
      if (b.kind === "bullets") {
        bulletBuffer.push(...b.items);
        if (bulletBuffer.length >= options.bulletsPerSlide) flushBullets();
        continue;
      }
      flushBullets();

      if (b.kind === "paragraph") {
        const h = b.sub ? 0.5 : Math.max(0.4, Math.ceil(b.text.length / 60) * 0.36 + 0.2);
        if (y + h > bottom) {
          slide = contentSlide(s.title, true);
          y = yTop;
        }
        if (b.sub) {
          slide.addText(b.text, {
            x: M + 0.1, y, w: CW - 0.2, h,
            fontSize: 19, bold: true, color: accent, fontFace: "Microsoft YaHei", valign: "top",
          });
        } else {
          slide.addText(b.text, {
            x: M + 0.1, y, w: CW - 0.2, h,
            fontSize: 16, color: bodyColor, fontFace: "Microsoft YaHei", valign: "top",
            lineSpacingMultiple: 1.2,
          });
        }
        y += h + 0.12;
      } else if (b.kind === "quote") {
        const lines = b.text.split("\n").length;
        const h = Math.max(0.5, lines * 0.4 + 0.3);
        if (y + h > bottom) {
          slide = contentSlide(s.title, true);
          y = yTop;
        }
        slide.addShape(pres.ShapeType.rect, { x: M + 0.1, y, w: 0.05, h, fill: { color: accent }, line: { color: accent } });
        slide.addText(b.text, {
          x: M + 0.35, y, w: CW - 0.45, h,
          fontSize: 15, italic: true, color: bodyColor, valign: "top", fontFace: "Microsoft YaHei",
        });
        y += h + 0.14;
      } else if (b.kind === "code" && options.codeAsTextBox) {
        const lines = b.text.split("\n").length;
        const h = Math.min(bottom - y, Math.max(0.6, lines * 0.24 + 0.3));
        if (y + h > bottom) {
          slide = contentSlide(s.title, true);
          y = yTop;
        }
        slide.addText(b.text, {
          x: M, y, w: CW, h,
          fontSize: 12, fontFace: "Consolas", color: hex(tokens.codeBlockColor),
          fill: { color: hex(tokens.codeBlockBg) }, valign: "top", breakLine: false,
          lineSpacingMultiple: 1.0,
        });
        y += h + 0.16;
      } else if (b.kind === "table") {
        if (!b.rows.length) continue;
        const cols = Math.max(...b.rows.map((r) => r.length));
        const colW = CW / cols;
        const rows = b.rows.map((r, ri) =>
          Array.from({ length: cols }, (_, ci) => ({
            text: r[ci] ?? "",
            options: {
              bold: ri === 0,
              fill: { color: ri === 0 ? hex(tokens.tableHeaderBg) : bg },
              color: bodyColor,
              fontSize: 13,
              fontFace: "Microsoft YaHei",
              valign: "middle" as const,
            },
          })),
        );
        const h = Math.min(bottom - y, (b.rows.length + 1) * 0.4);
        if (y + h > bottom) {
          slide = contentSlide(s.title, true);
          y = yTop;
        }
        slide.addTable(rows, {
          x: M, y, w: CW, colW: Array.from({ length: cols }, () => colW),
          border: { type: "solid", pt: 0.5, color: hex(tokens.tableBorderColor) },
          autoPage: false,
        });
        y += h + 0.16;
      } else if (b.kind === "image") {
        const h = Math.min(bottom - y, 3.4);
        const w = CW;
        if (y + h > bottom) {
          slide = contentSlide(s.title, true);
          y = yTop;
        }
        try {
          if (/^data:image\//.test(b.src)) {
            slide.addImage({ data: b.src, x: M, y, w, h, sizing: { type: "contain", w, h } });
          } else if (/^https?:\/\//.test(b.src)) {
            slide.addImage({ path: b.src, x: M, y, w, h, sizing: { type: "contain", w, h } });
          }
        } catch (err) {
          console.warn("[md-studio] PPTX 图片插入失败", b.src, err);
        }
        y += h + 0.16;
      }
    }
    flushBullets();
  }

  if (!slides.length) {
    titleSlide(meta.title || "未命名文档", meta.subject);
  }

  return { pres, slideCount: produced };
}

export async function exportPptx(
  markdown: string,
  tokens: ThemeTokens,
  meta: ExportMeta,
  options: PptxOptions,
): Promise<PptxResult> {
  const { pres, slideCount } = buildPptxPresentation(markdown, tokens, meta, options);
  await pres.writeFile({ fileName: `${safeFilename(meta.title, "document")}.pptx` });
  return { slideCount };
}
