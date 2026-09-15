/**
 * 全局类型定义：主题 token、导出选项等。
 * 一个「主题」= 一组 token 值；渲染层只依赖 token，不关心具体预设。
 */

export type PageSize = "A4" | "A3" | "A5" | "Letter" | "Legal" | "Slide16x9";
export type Orientation = "portrait" | "landscape";

/** 页面物理尺寸（mm），用于预览与打印 @page 规则 */
export const PAGE_SIZES: Record<PageSize, { w: number; h: number; label: string }> = {
  A4: { w: 210, h: 297, label: "A4 (210×297mm)" },
  A3: { w: 297, h: 420, label: "A3 (297×420mm)" },
  A5: { w: 148, h: 210, label: "A5 (148×210mm)" },
  Letter: { w: 215.9, h: 279.4, label: "Letter (8.5×11in)" },
  Legal: { w: 215.9, h: 355.6, label: "Legal (8.5×14in)" },
  Slide16x9: { w: 338.7, h: 190.5, label: "幻灯片 16:9 (13.3×7.5in)" },
};

export interface ThemeTokens {
  /* ── 页面 ───────────────────────────── */
  pageSize: PageSize;
  orientation: Orientation;
  marginMm: number;
  pageBreakBeforeH1: boolean;
  pageBreakBeforeH2: boolean;

  /* ── 字体与基础配色 ─────────────────── */
  fontFamily: string;
  fontSize: number; // px
  lineHeight: number;
  textColor: string;
  bgColor: string;
  accentColor: string;
  linkColor: string;

  /* ── 标题 ───────────────────────────── */
  h1Size: number; // px
  h2Size: number;
  h3Size: number;
  h4Size: number;
  headingColor: string;
  headingWeight: number; // 400–900
  headingAlign: "left" | "center";
  h1Rule: boolean; // H1 下划线
  h2Rule: boolean;
  headingNumbered: boolean; // 预览/导出时自动给标题编号（1 / 1.2 / 1.2.2）
  headingNumberMaxLevel: number; // 编号到第几级标题（1–6）

  /* ── 段落与版心 ─────────────────────── */
  paraSpacing: number; // 段间距（em）
  maxWidth: number; // px，仅屏幕/HTML 阅读模式

  /* ── 列表 ───────────────────────────── */
  listLineHeight: number; // 列表行距；0 = 跟随正文行高
  listIndent: number; // 列表缩进（em），控制列表标记与正文的“列距”
  listAutoFit: boolean; // 自动收缩深层缩进并换行，确保不超出左右版心

  /* ── 代码 ───────────────────────────── */
  codeFontFamily: string;
  codeFontSize: number; // px
  inlineCodeBg: string;
  inlineCodeColor: string;
  codeBlockBg: string;
  codeBlockColor: string;
  codeTheme: string; // highlight.js 主题名
  codeWrap: boolean;

  /* ── 表格 ───────────────────────────── */
  tableBorderColor: string;
  tableHeaderBg: string;
  tableStripe: boolean;

  /* ── 引用 ───────────────────────────── */
  blockquoteBorder: string;
  blockquoteBg: string;
  blockquoteColor: string;

  /* ── PPTX 专属 ─────────────────────── */
  pptxSplitLevel: 1 | 2; // 以几级标题切分幻灯片
  pptxTitleColor: string;
  pptxBodyColor: string;
  pptxBg: string;
  pptxAccent: string;

  /* ── 逃生舱 ─────────────────────────── */
  customCss: string;
}

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  /** partial：基于默认 token 覆盖 */
  tokens: Partial<ThemeTokens>;
}

export interface ExportMeta {
  title: string;
  author: string;
  subject: string;
  /** 页眉/页脚（打印用，空串则不渲染） */
  header: string;
  footer: string;
  showPageNumber: boolean;
}

export interface PptxOptions {
  splitLevel: 1 | 2;
  slideSize: "16:9" | "4:3";
  includeTitleSlide: boolean;
  bulletsPerSlide: number;
  codeAsTextBox: boolean;
}

export interface DocxOptions {
  includeToc: boolean;
  headingNumbered: boolean;
  codeShading: boolean;
}

/** 所见即所得 PDF 导出（DOM → 位图 → 分页 PDF） */
export interface RasterPdfOptions {
  /** 渲染精度（等效 DPI），150 / 200 / 300 */
  dpi: number;
  imageFormat: "png" | "jpeg";
  jpegQuality: number;
  /** 是否输出页码（默认关闭，保证与预览一致） */
  pageNumbers: boolean;
}
