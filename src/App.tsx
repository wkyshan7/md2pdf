import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { DEFAULT_TOKENS, THEME_PRESETS, resolveTokens } from "./core/themes";
import type { DocxOptions, ExportMeta, PptxOptions, RasterPdfOptions, ThemeTokens } from "./core/types";
import { renderMarkdown } from "./core/render";
import { buildThemeStyle } from "./core/themeCss";
import { getCodeTheme } from "./core/highlightThemes";
import {
  assetRef,
  buildFontFaceCss,
  prependFamily,
  removeFamily,
  stripExtension,
  stripKnownFamilies,
  type FontAsset,
  type ImageAsset,
} from "./core/assets";
import { exportHtml } from "./core/exportHtml";
import { exportPdf as exportPdfViaPrint } from "./core/exportPdf";
import { exportRasterPdf } from "./core/exportPdfRaster";
import { exportPptx } from "./core/exportPptx";
import { exportDocx } from "./core/exportDocx";
import { downloadText, readTextFile, safeFilename } from "./core/download";
import { SAMPLE_MARKDOWN } from "./core/sample";
import { SettingsPanel } from "./ui/SettingsPanel";
import { AssetsPanel } from "./ui/AssetsPanel";
import { useAssets } from "./ui/useAssets";
import { Preview } from "./ui/Preview";
import { useScrollSync } from "./ui/useScrollSync";
import { useMediaQuery } from "./ui/useMediaQuery";
import { usePwaInstall } from "./ui/usePwaInstall";

const STORAGE_KEY = "md-studio:v1";
/** 状态结构版本：用于一次性迁移默认值 */
const STORAGE_VERSION = 2;

interface PersistedState {
  markdown: string;
  tokens: ThemeTokens;
  presetId: string;
  meta: ExportMeta;
  flow: boolean;
  zoom: number;
  syncScroll: boolean;
  pptx: PptxOptions;
  docx: DocxOptions;
  pdf: RasterPdfOptions;
  editorW: number;
  panelW: number;
  /** 状态结构版本，用于一次性迁移默认值 */
  version?: number;
  /** 当前启用为正文 / 代码的自定义字体 id（字体本体存在 IndexedDB） */
  bodyFontId?: string;
  codeFontId?: string;
}

const SPLITTER = 6;
const MIN_EDITOR_W = 220;
const MIN_PANEL_W = 230;
const MIN_PREVIEW_W = 300;
const DEFAULT_EDITOR_W = 420;
const DEFAULT_PANEL_W = 340;

const DEFAULT_META: ExportMeta = {
  title: "MD Studio 使用示例",
  author: "",
  subject: "",
  header: "",
  footer: "",
  showPageNumber: false,
};

const DEFAULT_PPTX: PptxOptions = {
  splitLevel: 2,
  slideSize: "16:9",
  includeTitleSlide: true,
  bulletsPerSlide: 7,
  codeAsTextBox: true,
};

const DEFAULT_DOCX: DocxOptions = {
  includeToc: false,
  headingNumbered: true,
  codeShading: true,
};

const DEFAULT_PDF: RasterPdfOptions = {
  dpi: 200,
  imageFormat: "jpeg",
  jpegQuality: 0.92,
  pageNumbers: false,
};

const INITIAL_STATE: PersistedState = {
  markdown: SAMPLE_MARKDOWN,
  tokens: resolveTokens(THEME_PRESETS[0]),
  presetId: THEME_PRESETS[0].id,
  meta: DEFAULT_META,
  flow: false,
  zoom: 0.78,
  syncScroll: true,
  pptx: DEFAULT_PPTX,
  docx: DEFAULT_DOCX,
  pdf: DEFAULT_PDF,
  editorW: DEFAULT_EDITOR_W,
  panelW: DEFAULT_PANEL_W,
  version: STORAGE_VERSION,
};

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL_STATE;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const tokens: ThemeTokens = { ...DEFAULT_TOKENS, ...(parsed.tokens ?? {}) };
    // v1 → v2：标题自动编号改为默认开启，并补上编号层级默认值
    if ((parsed.version ?? 1) < 2) {
      tokens.headingNumbered = true;
      tokens.headingNumberMaxLevel = tokens.headingNumberMaxLevel ?? 6;
    }
    return {
      ...INITIAL_STATE,
      ...parsed,
      version: STORAGE_VERSION,
      tokens,
      meta: { ...DEFAULT_META, ...(parsed.meta ?? {}) },
      pptx: { ...DEFAULT_PPTX, ...(parsed.pptx ?? {}) },
      docx: { ...DEFAULT_DOCX, ...(parsed.docx ?? {}) },
      pdf: { ...DEFAULT_PDF, ...(parsed.pdf ?? {}) },
      editorW: parsed.editorW ?? DEFAULT_EDITOR_W,
      panelW: parsed.panelW ?? DEFAULT_PANEL_W,
    };
  } catch {
    return INITIAL_STATE;
  }
}

interface Toast {
  id: number;
  text: string;
  kind: "info" | "success" | "error";
}

export default function App() {
  const [state, setState] = useState<PersistedState>(loadState);
  const [showEditor, setShowEditor] = useState(true);
  const [showPanel, setShowPanel] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [pdfProgress, setPdfProgress] = useState<{ done: number; total: number } | null>(null);
  const [mobileTab, setMobileTab] = useState<"editor" | "preview" | "panel">("preview");
  const [dragging, setDragging] = useState<"editor" | "panel" | null>(null);
  const dragRef = useRef<{ kind: "editor" | "panel"; startX: number; startW: number } | null>(null);
  const isMobile = useMediaQuery("(max-width: 900px)");
  const pwa = usePwaInstall();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showAssets, setShowAssets] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const quotaWarnedRef = useRef(false);

  const assets = useAssets();

  const {
    markdown,
    tokens,
    presetId,
    meta,
    flow,
    zoom,
    syncScroll,
    pptx,
    docx,
    pdf,
    editorW,
    panelW,
    bodyFontId,
    codeFontId,
  } = state;

  /* 持久化 */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        if (!quotaWarnedRef.current) {
          quotaWarnedRef.current = true;
          const id = Date.now();
          setToasts((prev) => [
            ...prev,
            {
              id,
              text: "本地存储空间不足，文档与设置可能无法自动保存。建议用资源库引用图片，而不是把 data URL 直接粘进正文。",
              kind: "error",
            },
          ]);
          window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 7000);
        }
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [state]);

  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, kind }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  const update = useCallback((patch: Partial<PersistedState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);
  const patchTokens = useCallback(
    (p: Partial<ThemeTokens>) => setState((prev) => ({ ...prev, tokens: { ...prev.tokens, ...p } })),
    [],
  );
  const patchMeta = useCallback(
    (p: Partial<ExportMeta>) => setState((prev) => ({ ...prev, meta: { ...prev.meta, ...p } })),
    [],
  );
  const patchPptx = useCallback(
    (p: Partial<PptxOptions>) => setState((prev) => ({ ...prev, pptx: { ...prev.pptx, ...p } })),
    [],
  );
  const patchDocx = useCallback(
    (p: Partial<DocxOptions>) => setState((prev) => ({ ...prev, docx: { ...prev.docx, ...p } })),
    [],
  );
  const patchPdf = useCallback(
    (p: Partial<RasterPdfOptions>) => setState((prev) => ({ ...prev, pdf: { ...prev.pdf, ...p } })),
    [],
  );

  const applyPreset = useCallback(
    (id: string) => {
      const preset = THEME_PRESETS.find((p) => p.id === id);
      if (!preset) return;
      setState((prev) => {
        let next = resolveTokens(preset);
        const body = prev.bodyFontId ? assets.fonts.find((f) => f.id === prev.bodyFontId) : undefined;
        if (body) next = { ...next, fontFamily: prependFamily(body.family, next.fontFamily) };
        const code = prev.codeFontId ? assets.fonts.find((f) => f.id === prev.codeFontId) : undefined;
        if (code) next = { ...next, codeFontFamily: prependFamily(code.family, next.codeFontFamily) };
        return { ...prev, presetId: id, tokens: next };
      });
    },
    [assets.fonts],
  );

  const resetTokens = useCallback(() => {
    setState((prev) => {
      let next: ThemeTokens = { ...DEFAULT_TOKENS, customCss: prev.tokens.customCss };
      const body = prev.bodyFontId ? assets.fonts.find((f) => f.id === prev.bodyFontId) : undefined;
      if (body) next = { ...next, fontFamily: prependFamily(body.family, next.fontFamily) };
      const code = prev.codeFontId ? assets.fonts.find((f) => f.id === prev.codeFontId) : undefined;
      if (code) next = { ...next, codeFontFamily: prependFamily(code.family, next.codeFontFamily) };
      return { ...prev, tokens: next };
    });
  }, [assets.fonts]);

  /* ── 自定义字体：启用 / 关闭 / 重命名 ─────────── */
  const setBodyFontAsset = useCallback(
    (asset: FontAsset | null) => {
      setState((prev) => {
        let stack = stripKnownFamilies(prev.tokens.fontFamily, assets.fonts);
        if (asset) stack = prependFamily(asset.family, stack);
        return { ...prev, bodyFontId: asset?.id, tokens: { ...prev.tokens, fontFamily: stack } };
      });
    },
    [assets.fonts],
  );

  const setCodeFontAsset = useCallback(
    (asset: FontAsset | null) => {
      setState((prev) => {
        let stack = stripKnownFamilies(prev.tokens.codeFontFamily, assets.fonts);
        if (asset) stack = prependFamily(asset.family, stack);
        return { ...prev, codeFontId: asset?.id, tokens: { ...prev.tokens, codeFontFamily: stack } };
      });
    },
    [assets.fonts],
  );

  const applyBodyFont = useCallback(
    (id: string | null) => {
      setBodyFontAsset(id ? assets.fonts.find((f) => f.id === id) ?? null : null);
    },
    [assets.fonts, setBodyFontAsset],
  );

  const applyCodeFont = useCallback(
    (id: string | null) => {
      setCodeFontAsset(id ? assets.fonts.find((f) => f.id === id) ?? null : null);
    },
    [assets.fonts, setCodeFontAsset],
  );

  const handleImportFonts = useCallback(
    async (files: File[]) => {
      const report = await assets.addFonts(files);
      if (report.added.length) {
        toast(`已导入 ${report.added.length} 个字体`, "success");
        if (!bodyFontId) setBodyFontAsset(report.added[0]);
      }
      for (const err of report.errors) toast(err, "error");
    },
    [assets, bodyFontId, setBodyFontAsset, toast],
  );

  const handleImportImages = useCallback(
    async (files: File[]) => {
      const report = await assets.addImages(files);
      if (report.added.length) toast(`已导入 ${report.added.length} 张图片，可在资源库插入到正文`, "success");
      for (const err of report.errors) toast(err, "error");
    },
    [assets, toast],
  );

  const handleDeleteAsset = useCallback(
    (id: string) => {
      if (bodyFontId === id) applyBodyFont(null);
      if (codeFontId === id) applyCodeFont(null);
      void assets.remove(id);
      toast("已删除资源", "info");
    },
    [bodyFontId, codeFontId, applyBodyFont, applyCodeFont, assets, toast],
  );

  const handleUpdateFont = useCallback(
    (id: string, patch: Partial<FontAsset>) => {
      const current = assets.fonts.find((f) => f.id === id);
      if (current && patch.family && patch.family !== current.family) {
        const newFamily = patch.family;
        const oldFamily = current.family;
        setState((prev) => {
          let next = prev.tokens;
          if (prev.bodyFontId === id) {
            next = { ...next, fontFamily: prependFamily(newFamily, removeFamily(oldFamily, next.fontFamily)) };
          }
          if (prev.codeFontId === id) {
            next = {
              ...next,
              codeFontFamily: prependFamily(newFamily, removeFamily(oldFamily, next.codeFontFamily)),
            };
          }
          return { ...prev, tokens: next };
        });
      }
      void assets.updateFont(id, patch);
    },
    [assets],
  );

  const handleClearAllAssets = useCallback(() => {
    setState((prev) => ({
      ...prev,
      bodyFontId: undefined,
      codeFontId: undefined,
      tokens: {
        ...prev.tokens,
        fontFamily: stripKnownFamilies(prev.tokens.fontFamily, assets.fonts),
        codeFontFamily: stripKnownFamilies(prev.tokens.codeFontFamily, assets.fonts),
      },
    }));
    void assets.clearAll();
    toast("已清空全部资源", "info");
  }, [assets, toast]);

  /* ── 图片插入 ─────────────────────────────── */
  const insertAtCursor = useCallback(
    (snippet: string) => {
      const el = editorRef.current;
      const start = el?.selectionStart ?? markdown.length;
      const end = el?.selectionEnd ?? start;
      const next = markdown.slice(0, start) + snippet + markdown.slice(end);
      update({ markdown: next });
      requestAnimationFrame(() => {
        if (!el) return;
        el.focus();
        const pos = start + snippet.length;
        try {
          el.setSelectionRange(pos, pos);
        } catch {
          /* 部分环境不支持，忽略 */
        }
      });
    },
    [markdown, update],
  );

  const handleInsertImage = useCallback(
    (asset: ImageAsset, mode: "ref" | "dataUrl") => {
      const alt = stripExtension(asset.name) || "图片";
      const src = mode === "ref" ? assetRef(asset.id) : asset.dataUrl;
      insertAtCursor(`![${alt}](${src})`);
      toast(mode === "ref" ? "已插入图片引用（导出时自动内嵌）" : "已插入内嵌图片", "success");
      if (isMobile) setMobileTab("editor");
    },
    [insertAtCursor, toast, isMobile],
  );

  /* 预览：延迟渲染，避免大文档卡顿 */
  const deferredMarkdown = useDeferredValue(markdown);
  const rendered = useMemo(
    () =>
      renderMarkdown(deferredMarkdown, {
        numbered: tokens.headingNumbered,
        numberMaxLevel: tokens.headingNumberMaxLevel,
        assets: assets.map,
      }),
    [deferredMarkdown, tokens.headingNumbered, tokens.headingNumberMaxLevel, assets.map],
  );
  const themeStyle = useMemo(() => buildThemeStyle(tokens, ":root"), [tokens]);
  const fontFacesCss = useMemo(() => buildFontFaceCss(assets.fonts, "swap"), [assets.fonts]);
  const codeTheme = useMemo(() => getCodeTheme(tokens.codeTheme), [tokens.codeTheme]);

  /* 编辑器 ↔ 预览 同步滚动 */
  const layoutKey = useMemo(
    () =>
      [
        flow,
        zoom,
        tokens.pageSize,
        tokens.orientation,
        tokens.marginMm,
        tokens.fontSize,
        tokens.lineHeight,
        isMobile ? `m:${mobileTab}` : "d",
      ].join("|"),
    [
      flow,
      zoom,
      tokens.pageSize,
      tokens.orientation,
      tokens.marginMm,
      tokens.fontSize,
      tokens.lineHeight,
      isMobile,
      mobileTab,
    ],
  );
  useScrollSync({
    editorRef,
    previewRef,
    headings: rendered.headings,
    enabled: syncScroll,
    layoutKey,
  });

  /* ── 文件操作 ─────────────────────────────── */
  const openFile = useCallback(
    async (file: File) => {
      const text = await readTextFile(file);
      const base = file.name.replace(/\.(md|markdown|txt)$/i, "");
      setState((prev) => ({ ...prev, markdown: text, meta: { ...prev.meta, title: base } }));
      toast(`已打开 ${file.name}`, "success");
    },
    [toast],
  );

  const saveMarkdown = useCallback(() => {
    downloadText(markdown, `${safeFilename(meta.title, "document")}.md`, "text/markdown");
    toast("Markdown 已保存", "success");
  }, [markdown, meta.title, toast]);

  /* ── 导出 ─────────────────────────────────── */
  const withBusy = useCallback(
    async (label: string, fn: () => Promise<void> | void) => {
      setBusy(label);
      try {
        await fn();
      } catch (err) {
        console.error(err);
        toast(`${label}失败：${err instanceof Error ? err.message : String(err)}`, "error");
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  const doExportHtml = () =>
    withBusy("HTML 导出", () => {
      exportHtml(markdown, tokens, meta, { flow, assets: assets.map, fonts: assets.fonts });
      toast("已生成单文件 HTML（含字体与图片）", "success");
    });

  const doExportPdf = () =>
    withBusy("PDF 导出", async () => {
      const page = previewRef.current?.querySelector<HTMLElement>(".md-page");
      if (!page) throw new Error("未找到预览页面");
      setPdfProgress({ done: 0, total: 0 });
      const res = await exportRasterPdf(page, tokens, meta, pdf, (p) => setPdfProgress(p));
      toast(
        `PDF 已导出：${res.pages} 页 · ${res.widthMm.toFixed(0)}×${res.heightMm.toFixed(0)}mm · ${pdf.dpi}DPI`,
        "success",
      );
    }).finally(() => setPdfProgress(null));

  /** 备选：走浏览器打印（矢量文字，可选中/搜索） */
  const doPrintPdf = () =>
    withBusy("PDF 打印", async () => {
      await exportPdfViaPrint(markdown, tokens, meta, { assets: assets.map, fonts: assets.fonts });
      toast("已打开打印对话框，请选择「另存为 PDF」", "success");
    });

  const doExportPptx = () =>
    withBusy("PPTX 导出", async () => {
      const res = await exportPptx(markdown, tokens, meta, pptx, assets.map);
      toast(`已生成 PPTX（${res.slideCount} 页）`, "success");
    });

  const doExportDocx = () =>
    withBusy("DOCX 导出", async () => {
      const res = await exportDocx(markdown, tokens, meta, docx, assets.map);
      toast(`已生成 DOCX（${res.paragraphs} 个块）`, "success");
    });

  /* ── 面板拖拽调整宽度 ─────────────────────── */
  const maxFor = useCallback(
    (kind: "editor" | "panel"): number => {
      const others = kind === "editor" ? (showPanel ? panelW : 0) : showEditor ? editorW : 0;
      return Math.max(
        kind === "editor" ? MIN_EDITOR_W : MIN_PANEL_W,
        window.innerWidth - MIN_PREVIEW_W - others - SPLITTER * 2,
      );
    },
    [showPanel, panelW, showEditor, editorW],
  );

  const onSplitterDown = (kind: "editor" | "panel") => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      kind,
      startX: e.clientX,
      startW: kind === "editor" ? editorW : panelW,
    };
    setDragging(kind);
    document.body.classList.add("resizing");
  };

  const onSplitterMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = e.clientX - drag.startX;
    if (drag.kind === "editor") {
      const next = Math.min(maxFor("editor"), Math.max(MIN_EDITOR_W, drag.startW + delta));
      update({ editorW: Math.round(next) });
    } else {
      const next = Math.min(maxFor("panel"), Math.max(MIN_PANEL_W, drag.startW - delta));
      update({ panelW: Math.round(next) });
    }
  };

  const onSplitterUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
    setDragging(null);
    document.body.classList.remove("resizing");
  };

  /* 窗口变小时自动压缩两侧宽度，避免预览被挤没 */
  useEffect(() => {
    if (isMobile) return;
    const clampWidths = (): void => {
      setState((prev) => {
        const overflow = prev.editorW + prev.panelW + SPLITTER * 2 + MIN_PREVIEW_W - window.innerWidth;
        if (overflow <= 0) return prev;
        const editorW = Math.max(MIN_EDITOR_W, prev.editorW - overflow);
        const panelW = Math.max(MIN_PANEL_W, prev.panelW - (overflow - (prev.editorW - editorW)));
        return editorW === prev.editorW && panelW === prev.panelW ? prev : { ...prev, editorW, panelW };
      });
    };
    clampWidths();
    window.addEventListener("resize", clampWidths);
    return () => window.removeEventListener("resize", clampWidths);
  }, [isMobile]);

  /* 安装为桌面/主屏应用 */
  const onInstallClick = useCallback(() => {
    if (pwa.canInstall) {
      void pwa.install();
      return;
    }
    toast("iOS / iPadOS：点浏览器底部的「分享」→「添加到主屏幕」", "info");
  }, [pwa, toast]);

  /* Ctrl/Cmd + S 保存 markdown */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveMarkdown();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveMarkdown]);

  const stats = useMemo(() => {
    const chars = markdown.length;
    const words = markdown.replace(/\s+/g, "").length;
    const lines = markdown.split("\n").length;
    return { chars, words, lines };
  }, [markdown]);

  const mainClass = "main";

  const gridTemplate = isMobile
    ? "minmax(0, 1fr)"
    : [
        showEditor ? `${editorW}px` : "0px",
        showEditor ? `${SPLITTER}px` : "0px",
        "minmax(0, 1fr)",
        showPanel ? `${SPLITTER}px` : "0px",
        showPanel ? `${panelW}px` : "0px",
      ].join(" ");

  const paneVisible = (tab: "editor" | "preview" | "panel"): boolean =>
    !isMobile || mobileTab === tab;

  const splitter = (kind: "editor" | "panel", shown: boolean): ReactNode => (
    <div
      className={`splitter${dragging === kind ? " dragging" : ""}`}
      data-hidden={!shown}
      role="separator"
      aria-orientation="vertical"
      title="拖动调整宽度，双击恢复默认"
      onPointerDown={shown ? onSplitterDown(kind) : undefined}
      onPointerMove={shown ? onSplitterMove : undefined}
      onPointerUp={shown ? onSplitterUp : undefined}
      onPointerCancel={shown ? onSplitterUp : undefined}
      onLostPointerCapture={shown ? onSplitterUp : undefined}
      onDoubleClick={
        shown
          ? () => update(kind === "editor" ? { editorW: DEFAULT_EDITOR_W } : { panelW: DEFAULT_PANEL_W })
          : undefined
      }
    />
  );

  return (
    <div className="app">
      <style id="md-theme" dangerouslySetInnerHTML={{ __html: themeStyle }} />
      <style id="md-hljs" dangerouslySetInnerHTML={{ __html: codeTheme.css }} />
      {fontFacesCss && <style id="md-fonts" dangerouslySetInnerHTML={{ __html: fontFacesCss }} />}

      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          MD Studio
        </div>
        <input
          className="doc-title-input"
          value={meta.title}
          placeholder="文档标题"
          onChange={(e) => patchMeta({ title: e.target.value })}
        />
        <button className="btn" onClick={() => fileRef.current?.click()}>
          打开 MD
        </button>
        <button className="btn" onClick={saveMarkdown}>
          保存 MD
        </button>
        {!pwa.installed && (pwa.canInstall || pwa.needsManualInstall) && (
          <button className="btn" onClick={onInstallClick} title="安装为应用，可离线使用">
            ⤓ 安装应用
          </button>
        )}
        <span className="spacer" />
        <button
          className={`btn${showAssets ? " active" : ""}`}
          onClick={() => setShowAssets(true)}
          title="导入并管理自定义字体与图片"
        >
          🗂 资源库
          {assets.fonts.length + assets.images.length > 0 ? ` ${assets.fonts.length + assets.images.length}` : ""}
        </button>
        <button className="btn" onClick={() => update({ markdown: SAMPLE_MARKDOWN })}>
          载入示例
        </button>
        <button className="btn primary" disabled={!!busy} onClick={doExportPdf}>
          {busy === "PDF 导出"
            ? pdfProgress && pdfProgress.total > 0
              ? `PDF ${pdfProgress.done}/${pdfProgress.total}`
              : "渲染中…"
            : "导出 PDF"}
        </button>
        <button className="btn" disabled={!!busy} onClick={doExportPptx}>
          {busy === "PPTX 导出" ? "生成中…" : "导出 PPTX"}
        </button>
        <button className="btn" disabled={!!busy} onClick={doExportDocx}>
          {busy === "DOCX 导出" ? "生成中…" : "导出 DOCX"}
        </button>
        <button className="btn" disabled={!!busy} onClick={doExportHtml}>
          导出 HTML
        </button>
      </header>

      {isMobile && (
        <div className="mobile-tabs">
          <div className="seg">
            <button
              className={mobileTab === "editor" ? "active" : ""}
              onClick={() => setMobileTab("editor")}
            >
              Markdown
            </button>
            <button
              className={mobileTab === "preview" ? "active" : ""}
              onClick={() => setMobileTab("preview")}
            >
              预览
            </button>
            <button
              className={mobileTab === "panel" ? "active" : ""}
              onClick={() => setMobileTab("panel")}
            >
              设置
            </button>
          </div>
        </div>
      )}

      <div className={mainClass} style={{ gridTemplateColumns: gridTemplate }}>
        <section
          className="pane editor-pane"
          style={{ display: paneVisible("editor") ? undefined : "none" }}
        >
          <textarea
            ref={editorRef}
            value={markdown}
            spellCheck={false}
            placeholder="在此编写 Markdown…"
            onChange={(e) => update({ markdown: e.target.value })}
          />
        </section>

        {splitter("editor", showEditor)}

        <section
          className="pane preview-pane"
          style={{ display: paneVisible("preview") ? undefined : "none" }}
        >
          <div className="preview-toolbar">
            <div className="seg">
              <button className={!flow ? "active" : ""} onClick={() => update({ flow: false })}>
                页面
              </button>
              <button className={flow ? "active" : ""} onClick={() => update({ flow: true })}>
                阅读
              </button>
            </div>
            <span>缩放</span>
            <input
              type="range"
              min={0.4}
              max={1.5}
              step={0.02}
              value={zoom}
              style={{ width: 130 }}
              onChange={(e) => update({ zoom: Number(e.target.value) })}
            />
            <span className="value-badge">{Math.round(zoom * 100)}%</span>
            <span className="spacer" style={{ flex: 1 }} />
            <button
              className={`btn ghost${syncScroll ? " active" : ""}`}
              title="编辑器与预览滚动位置互相同步"
              onClick={() => update({ syncScroll: !syncScroll })}
            >
              ⇅ 同步滚动
            </button>
            {!isMobile && (
              <>
                <button className="btn ghost" onClick={() => setShowEditor((v) => !v)}>
                  {showEditor ? "隐藏编辑" : "显示编辑"}
                </button>
                <button className="btn ghost" onClick={() => setShowPanel((v) => !v)}>
                  {showPanel ? "隐藏面板" : "显示面板"}
                </button>
              </>
            )}
          </div>
          <Preview html={rendered.html} tokens={tokens} flow={flow} zoom={zoom} scrollRef={previewRef} />
        </section>

        {splitter("panel", showPanel)}

        <aside
          className="pane panel-pane"
          style={{ display: paneVisible("panel") ? undefined : "none" }}
        >
          <SettingsPanel
            tokens={tokens}
            patch={patchTokens}
            meta={meta}
            patchMeta={patchMeta}
            pptx={pptx}
            patchPptx={patchPptx}
            docx={docx}
            patchDocx={patchDocx}
            pdf={pdf}
            patchPdf={patchPdf}
            onPrintPdf={doPrintPdf}
            presetId={presetId}
            onPreset={applyPreset}
            onReset={resetTokens}
            onOpenAssets={() => setShowAssets(true)}
          />
        </aside>
      </div>

      <footer className="statusbar">
        <span>{stats.lines} 行</span>
        <span>{stats.chars} 字符</span>
        <span>{rendered.headings.length} 个标题</span>
        <span className="spacer" />
        <span>
          {tokens.pageSize} · {tokens.orientation === "portrait" ? "纵向" : "横向"} · {tokens.fontSize}px ·{" "}
          {codeTheme.name}
        </span>
        <span>{busy ? `⏳ ${busy}${pdfProgress && pdfProgress.total > 0 ? ` ${pdfProgress.done}/${pdfProgress.total}` : ""}` : "就绪"}</span>
      </footer>

      <input
        ref={fileRef}
        type="file"
        accept=".md,.markdown,.txt,text/markdown"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openFile(f);
          e.target.value = "";
        }}
      />

      <AssetsPanel
        open={showAssets}
        onClose={() => setShowAssets(false)}
        fonts={assets.fonts}
        images={assets.images}
        bodyFontId={bodyFontId}
        codeFontId={codeFontId}
        persistent={assets.persistent}
        onImportFonts={handleImportFonts}
        onImportImages={handleImportImages}
        onDelete={handleDeleteAsset}
        onUpdateFont={handleUpdateFont}
        onApplyBodyFont={applyBodyFont}
        onApplyCodeFont={applyCodeFont}
        onInsertImage={handleInsertImage}
        onClearAll={handleClearAllAssets}
        onToast={toast}
      />

      <div className="toast-host">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
