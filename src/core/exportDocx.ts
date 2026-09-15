import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  FileChild,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  PageBreak,
  PageNumber,
  PageOrientation,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType,
  convertMillimetersToTwip,
} from "docx";
import type { ParagraphChild } from "docx";
import type { Token } from "markdown-it";
import { parse } from "./parser";
import { PAGE_SIZES, type DocxOptions, type ExportMeta, type ThemeTokens } from "./types";
import { primaryFamily, resolveAssetSrc, type AssetMap } from "./assets";
import { HeadingNumberer, isHeadingUnnumbered } from "./headingNumbers";
import { downloadBlob, safeFilename } from "./download";

/** 取代码字体栈第一个族名，用于 docx 的 run 字体 */
const codeFontOf = (tokens: ThemeTokens): string => primaryFamily(tokens.codeFontFamily, "Consolas");

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

const hex = (c: string): string => c.replace("#", "").toUpperCase();
const stripHtml = (s: string): string => s.replace(/<[^>]*>/g, "");

function fontSizePx(t: ThemeTokens, level: number): number {
  const map = [t.h1Size, t.h2Size, t.h3Size, t.h4Size, Math.round(t.h4Size * 0.94), Math.round(t.h4Size * 0.9)];
  return map[Math.min(level, 6) - 1];
}

/* ── 内联：token → TextRun / Hyperlink / ImageRun ───────── */

interface RunState {
  bold: boolean;
  italic: boolean;
  strike: boolean;
}

function imageRun(src: string, alt: string, assets?: AssetMap): ImageRun | null {
  const resolved = resolveAssetSrc(src, assets);
  const m = /^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/i.exec(resolved);
  if (!m) return null;
  const rawType = m[1].toLowerCase();
  const type = (rawType === "jpeg" ? "jpg" : rawType) as "png" | "jpg" | "gif" | "bmp";
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new ImageRun({
    type,
    data: bytes,
    transformation: { width: 420, height: 280 },
    altText: alt ? { name: alt, description: alt } : undefined,
  });
}

function inlineRuns(inline: Token | undefined, tokens: ThemeTokens, assets?: AssetMap): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  if (!inline?.children) {
    if (inline?.content) out.push(new TextRun(inline.content));
    return out;
  }
  const st: RunState = { bold: false, italic: false, strike: false };
  const kids = inline.children;

  const styled = (text: string, extra: Record<string, unknown> = {}): TextRun =>
    new TextRun({
      text,
      bold: st.bold || undefined,
      italics: st.italic || undefined,
      strike: st.strike || undefined,
      ...extra,
    } as never);

  for (let k = 0; k < kids.length; k++) {
    const c = kids[k];
    switch (c.type) {
      case "text":
        out.push(styled(c.content));
        break;
      case "strong_open":
        st.bold = true;
        break;
      case "strong_close":
        st.bold = false;
        break;
      case "em_open":
        st.italic = true;
        break;
      case "em_close":
        st.italic = false;
        break;
      case "s_open":
        st.strike = true;
        break;
      case "s_close":
        st.strike = false;
        break;
      case "code_inline":
        out.push(
          new TextRun({
            text: c.content,
            font: codeFontOf(tokens),
            size: tokens.codeFontSize * 2,
            color: hex(tokens.inlineCodeColor),
            shading: { type: ShadingType.CLEAR, fill: hex(tokens.inlineCodeBg) },
          }),
        );
        break;
      case "softbreak":
        out.push(new TextRun(" "));
        break;
      case "hardbreak":
        out.push(new TextRun({ break: 1 }));
        break;
      case "math_inline":
        out.push(new TextRun({ text: c.content, font: codeFontOf(tokens), italics: true }));
        break;
      case "math_block":
        out.push(new TextRun({ text: c.content, font: codeFontOf(tokens) }));
        break;
      case "html_inline": {
        const txt = stripHtml(c.content);
        if (txt) out.push(styled(txt));
        break;
      }
      case "image": {
        const src = String(c.attrGet("src") ?? "");
        const run = imageRun(src, c.content || "", assets);
        if (run) out.push(run);
        else out.push(new TextRun({ text: `[图片：${c.content || src}]`, italics: true, color: "888888" }));
        break;
      }
      case "link_open": {
        const href = String(c.attrGet("href") ?? "");
        const inner: ParagraphChild[] = [];
        let j = k + 1;
        while (j < kids.length && kids[j].type !== "link_close") {
          const cc = kids[j];
          if (cc.type === "text") inner.push(new TextRun({ text: cc.content, style: "Hyperlink" }));
          else if (cc.type === "code_inline")
            inner.push(new TextRun({ text: cc.content, style: "Hyperlink", font: codeFontOf(tokens) }));
          else if (cc.content) inner.push(new TextRun({ text: cc.content, style: "Hyperlink" }));
          j++;
        }
        out.push(
          new ExternalHyperlink({
            link: href,
            children: inner.length ? inner : [new TextRun({ text: href, style: "Hyperlink" })],
          }),
        );
        k = j;
        break;
      }
      default:
        if (c.content) out.push(styled(c.content));
    }
  }
  return out;
}

/* ── 块级：token 流 → docx 元素 ─────────────────────────── */

interface WalkContext {
  tokens: ThemeTokens;
  numberer: HeadingNumberer;
  numbered: boolean;
  codeShading: boolean;
  assets?: AssetMap;
}

function codeParagraph(code: string, ctx: WalkContext): Paragraph {
  const lines = code.replace(/\n$/, "").split("\n");
  const runs: TextRun[] = [];
  lines.forEach((line, idx) => {
    if (idx > 0) runs.push(new TextRun({ break: 1 }));
    runs.push(
      new TextRun({
        text: line.length ? line : " ",
        font: codeFontOf(ctx.tokens),
        size: ctx.tokens.codeFontSize * 2,
        color: hex(ctx.tokens.codeBlockColor),
      }),
    );
  });
  return new Paragraph({
    children: runs,
    shading: ctx.codeShading
      ? { type: ShadingType.CLEAR, fill: hex(ctx.tokens.codeBlockBg) }
      : undefined,
    border: {
      left: { style: BorderStyle.SINGLE, size: 12, color: hex(ctx.tokens.accentColor), space: 8 },
    },
    spacing: { before: 120, after: 160, line: 260 },
    keepLines: true,
  });
}

function listParagraph(
  inline: Token | undefined,
  ctx: WalkContext,
  ordered: boolean,
  level: number,
): Paragraph {
  return new Paragraph({
    children: inlineRuns(inline, ctx.tokens, ctx.assets),
    numbering: { reference: ordered ? "md-ordered" : "md-bullet", level: Math.min(level, 4) },
    spacing: { after: 60, line: Math.round(ctx.tokens.lineHeight * 240) },
  });
}

function walk(tokens: Token[], ctx: WalkContext): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  let i = 0;

  const skipTo = (from: number, openType: string, closeType: string): number => {
    let depth = 0;
    for (let j = from; j < tokens.length; j++) {
      if (tokens[j].type === openType) depth++;
      else if (tokens[j].type === closeType) {
        if (depth === 0) return j;
        depth--;
      }
    }
    return tokens.length - 1;
  };

  while (i < tokens.length) {
    const t = tokens[i];

    if (t.type === "heading_open") {
      const level = Number(t.tag.slice(1));
      const inline = tokens[i + 1];
      let prefix = "";
      if (ctx.numbered) {
        const number = ctx.numberer.next(level, isHeadingUnnumbered(t));
        if (number) prefix = `${number} `;
      }
      const runs = inlineRuns(inline, ctx.tokens, ctx.assets);
      if (prefix) runs.unshift(new TextRun({ text: prefix, color: hex(ctx.tokens.accentColor) }));
      out.push(
        new Paragraph({
          heading: HEADING_LEVELS[Math.min(level, 6) - 1],
          children: runs,
          spacing: { before: level <= 2 ? 320 : 220, after: 140 },
          pageBreakBefore: level === 1 && ctx.tokens.pageBreakBeforeH1,
          alignment:
            ctx.tokens.headingAlign === "center" ? AlignmentType.CENTER : AlignmentType.LEFT,
          border:
            (level === 1 && ctx.tokens.h1Rule) || (level === 2 && ctx.tokens.h2Rule)
              ? {
                  bottom: {
                    style: BorderStyle.SINGLE,
                    size: level === 1 ? 12 : 6,
                    color: hex(ctx.tokens.tableBorderColor),
                    space: 4,
                  },
                }
              : undefined,
          run: {
            size: fontSizePx(ctx.tokens, level) * 2,
            bold: ctx.tokens.headingWeight >= 600,
            color: hex(ctx.tokens.headingColor),
          },
        }),
      );
      i += 3;
      continue;
    }

    if (t.type === "paragraph_open") {
      const inline = tokens[i + 1];
      out.push(
        new Paragraph({
          children: inlineRuns(inline, ctx.tokens, ctx.assets),
          spacing: { after: Math.round(ctx.tokens.paraSpacing * 240), line: Math.round(ctx.tokens.lineHeight * 240) },
        }),
      );
      i += 3;
      continue;
    }

    if (t.type === "fence" || t.type === "code_block") {
      out.push(codeParagraph(t.content, ctx));
      i++;
      continue;
    }

    if (t.type === "bullet_list_open" || t.type === "ordered_list_open") {
      const ordered = t.type === "ordered_list_open";
      const closeType = ordered ? "ordered_list_close" : "bullet_list_close";
      i++;
      let level = 0;
      while (i < tokens.length && tokens[i].type !== closeType) {
        const tk = tokens[i];
        if (tk.type === "list_item_open") {
          level = 0;
          i++;
          continue;
        }
        if (tk.type === "list_item_close") {
          i++;
          continue;
        }
        if (tk.type === "bullet_list_open" || tk.type === "ordered_list_open") {
          level++;
          i++;
          continue;
        }
        if (tk.type === "bullet_list_close" || tk.type === "ordered_list_close") {
          level = Math.max(0, level - 1);
          i++;
          continue;
        }
        if (tk.type === "paragraph_open") {
          out.push(listParagraph(tokens[i + 1], ctx, ordered, level));
          i += 3;
          continue;
        }
        if (tk.type === "inline") {
          out.push(listParagraph(tk, ctx, ordered, level));
          i++;
          continue;
        }
        i++;
      }
      i++;
      continue;
    }

    if (t.type === "blockquote_open") {
      const close = skipTo(i + 1, "blockquote_open", "blockquote_close");
      const paras: Token[] = [];
      for (let j = i + 1; j < close; j++) if (tokens[j].type === "inline") paras.push(tokens[j]);
      for (const p of paras) {
        out.push(
          new Paragraph({
            children: inlineRuns(p, ctx.tokens, ctx.assets),
            spacing: { after: 120, line: Math.round(ctx.tokens.lineHeight * 240) },
            indent: { left: 360 },
            border: {
              left: { style: BorderStyle.SINGLE, size: 18, color: hex(ctx.tokens.blockquoteBorder), space: 10 },
            },
            shading: { type: ShadingType.CLEAR, fill: hex(ctx.tokens.blockquoteBg) },
          }),
        );
      }
      i = close + 1;
      continue;
    }

    if (t.type === "table_open") {
      const rows: TableRow[] = [];
      let j = i + 1;
      let colCount = 1;
      while (j < tokens.length && tokens[j].type !== "table_close") {
        if (tokens[j].type === "tr_open") {
          const cells: TableCell[] = [];
          let k = j + 1;
          while (k < tokens.length && tokens[k].type !== "tr_close") {
            const cellTok = tokens[k];
            if (cellTok.type === "th_open" || cellTok.type === "td_open") {
              const isHeader = cellTok.type === "th_open";
              const inline = tokens[k + 1];
              cells.push(
                new TableCell({
                  children: [
                    new Paragraph({
                      children: inlineRuns(inline, ctx.tokens, ctx.assets),
                      spacing: { after: 0 },
                      alignment: isHeader && ctx.tokens.headingAlign === "center" ? AlignmentType.CENTER : undefined,
                    }),
                  ],
                  verticalAlign: VerticalAlign.CENTER,
                  shading: isHeader
                    ? { type: ShadingType.CLEAR, fill: hex(ctx.tokens.tableHeaderBg) }
                    : undefined,
                  margins: { top: 60, bottom: 60, left: 100, right: 100 },
                }),
              );
              while (k < tokens.length && tokens[k].type !== "th_close" && tokens[k].type !== "td_close") k++;
            }
            k++;
          }
          colCount = Math.max(colCount, cells.length);
          rows.push(new TableRow({ children: cells, tableHeader: rows.length === 0 }));
          j = k;
        }
        j++;
      }
      out.push(
        new Table({
          rows,
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: hex(ctx.tokens.tableBorderColor) },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: hex(ctx.tokens.tableBorderColor) },
            left: { style: BorderStyle.SINGLE, size: 4, color: hex(ctx.tokens.tableBorderColor) },
            right: { style: BorderStyle.SINGLE, size: 4, color: hex(ctx.tokens.tableBorderColor) },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: hex(ctx.tokens.tableBorderColor) },
            insideVertical: { style: BorderStyle.SINGLE, size: 4, color: hex(ctx.tokens.tableBorderColor) },
          },
        }),
      );
      i = j + 1;
      continue;
    }

    if (t.type === "hr") {
      out.push(
        new Paragraph({
          text: "",
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: hex(ctx.tokens.tableBorderColor), space: 1 },
          },
          spacing: { before: 200, after: 200 },
        }),
      );
      i++;
      continue;
    }

    if (t.type === "html_block") {
      const text = stripHtml(t.content).trim();
      if (text) out.push(new Paragraph({ children: [new TextRun(text)] }));
      i++;
      continue;
    }

    i++;
  }

  return out;
}

/* ── 组装 Document ─────────────────────────────────────── */

export interface DocxResult {
  paragraphs: number;
}

/** 仅构建 Document 对象（便于测试/复用），不打包下载 */
export function buildDocxDocument(
  markdown: string,
  tokens: ThemeTokens,
  meta: ExportMeta,
  options: DocxOptions,
  assets?: AssetMap,
): { doc: Document; paragraphs: number } {
  const { tokens: mdTokens } = parse(markdown);
  const ctx: WalkContext = {
    tokens,
    numberer: new HeadingNumberer(tokens.headingNumberMaxLevel),
    numbered: options.headingNumbered,
    codeShading: options.codeShading,
    assets,
  };
  const body = walk(mdTokens, ctx);

  const children: FileChild[] = [];
  if (options.includeToc) {
    children.push(
      new TableOfContents("目录", { hyperlink: true, headingStyleRange: "1-3" }),
      new Paragraph({ children: [new PageBreak()] }),
    );
  }
  children.push(...body);

  const dims = PAGE_SIZES[tokens.pageSize];
  const [w, h] = tokens.orientation === "landscape" ? [dims.h, dims.w] : [dims.w, dims.h];

  const header = meta.header.trim()
    ? new Header({ children: [new Paragraph({ children: [new TextRun({ text: meta.header, size: 18, color: "888888" })], alignment: AlignmentType.CENTER })] })
    : undefined;
  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: meta.footer ? `${meta.footer}  ` : "", size: 18, color: "888888" }),
          new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "888888" }),
          new TextRun({ text: " / ", size: 18, color: "888888" }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: "888888" }),
        ],
      }),
    ],
  });

  const doc = new Document({
    creator: meta.author || "MD Studio",
    title: meta.title || "Markdown 文档",
    description: meta.subject || "",
    features: { updateFields: true },
    numbering: {
      config: [
        {
          reference: "md-bullet",
          levels: [0, 1, 2, 3, 4].map((level) => ({
            level,
            format: LevelFormat.BULLET,
            text: ["•", "◦", "▪"][level % 3],
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360 + level * 360, hanging: 260 } } },
          })),
        },
        {
          reference: "md-ordered",
          levels: [0, 1, 2, 3, 4].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360 + level * 360, hanging: 260 } } },
          })),
        },
      ],
    },
    styles: {
      default: {
        document: {
          run: { font: primaryFamily(tokens.fontFamily, "Microsoft YaHei"), size: tokens.fontSize * 2, color: hex(tokens.textColor) },
          paragraph: { spacing: { line: Math.round(tokens.lineHeight * 240) } },
        },
        hyperlink: { run: { color: hex(tokens.linkColor), underline: { type: UnderlineType.SINGLE } } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertMillimetersToTwip(w),
              height: convertMillimetersToTwip(h),
              orientation:
                tokens.orientation === "landscape" ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: {
              top: convertMillimetersToTwip(tokens.marginMm),
              bottom: convertMillimetersToTwip(tokens.marginMm),
              left: convertMillimetersToTwip(tokens.marginMm),
              right: convertMillimetersToTwip(tokens.marginMm),
            },
          },
        },
        headers: header ? { default: header } : undefined,
        footers: { default: footer },
        children,
      },
    ],
  });

  return { doc, paragraphs: children.length };
}

export async function exportDocx(
  markdown: string,
  tokens: ThemeTokens,
  meta: ExportMeta,
  options: DocxOptions,
  assets?: AssetMap,
): Promise<DocxResult> {
  const { doc, paragraphs } = buildDocxDocument(markdown, tokens, meta, options, assets);
  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${safeFilename(meta.title, "document")}.docx`);
  return { paragraphs };
}
