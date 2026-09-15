import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { DEFAULT_TOKENS, THEME_PRESETS, resolveTokens } from "./core/themes";
import type { DocxOptions, ExportMeta, PptxOptions, RasterPdfOptions, ThemeTokens } from "./core/types";
import { renderMarkdown } from "./core/render";
import { buildThemeStyle } from "./core/themeCss";
import { getCodeTheme } from "./core/highlightThemes";
import { exportHtml } from "./core/exportHtml";
import { exportPdf as exportPdfViaPrint } from "./core/exportPdf";
import { exportRasterPdf } from "./core/exportPdfRaster";
import { exportPptx } from "./core/exportPptx";
import { exportDocx } from "./core/exportDocx";
import { downloadText, readTextFile, safeFilename } from "./core/download";
import { SAMPLE_MARKDOWN } from "./core/sample";
import { SettingsPanel } from "./ui/SettingsPanel";
import { Preview } from "./ui/Preview";
import { useScrollSync } from "./ui/useScrollSync";
import { useMediaQuery } from "./ui/useMediaQuery";
import { usePwaInstall } from "./ui/usePwaInstall";

const STORAGE_KEY = "md-studio:v1";

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
  headingNumbered: false,
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
};

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL_STATE;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      ...INITIAL_STATE,
      ...parsed,
      tokens: { ...DEFAULT_TOKENS, ...(parsed.tokens ?? {}) },
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
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const { markdown, tokens, presetId, meta, flow, zoom, syncScroll, pptx, docx, pdf, editorW, panelW } = state;

  /* 持久化 */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        /* 配额溢出忽略 */
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
      setState((prev) => ({ ...prev, presetId: id, tokens: resolveTokens(preset) }));
    },
    [],
  );

  const resetTokens = useCallback(() => {
    setState((prev) => ({ ...prev, tokens: { ...DEFAULT_TOKENS, customCss: prev.tokens.customCss } }));
  }, []);

  /* 预览：延迟渲染，避免大文档卡顿 */
  const deferredMarkdown = useDeferredValue(markdown);
  const rendered = useMemo(
    () => renderMarkdown(deferredMarkdown, { numbered: tokens.headingNumbered }),
    [deferredMarkdown, tokens.headingNumbered],
  );
  const themeStyle = useMemo(() => buildThemeStyle(tokens, ":root"), [tokens]);
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
      exportHtml(markdown, tokens, meta, { flow });
      toast("已生成单文件 HTML", "success");
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
      await exportPdfViaPrint(markdown, tokens, meta);
      toast("已打开打印对话框，请选择「另存为 PDF」", "success");
    });

  const doExportPptx = () =>
    withBusy("PPTX 导出", async () => {
      const res = await exportPptx(markdown, tokens, meta, pptx);
      toast(`已生成 PPTX（${res.slideCount} 页）`, "success");
    });

  const doExportDocx = () =>
    withBusy("DOCX 导出", async () => {
      const res = await exportDocx(markdown, tokens, meta, docx);
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
