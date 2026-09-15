import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import type { FontAsset, FontStyle, ImageAsset } from "../core/assets";
import { assetRef, humanSize, stripExtension } from "../core/assets";

export type AssetToastKind = "info" | "success" | "error";
export type AssetToast = (text: string, kind?: AssetToastKind) => void;

export interface AssetsPanelProps {
  open: boolean;
  onClose: () => void;
  /** 当前标签页由外部控制，便于从工具栏分别打开「字体」「图片」 */
  tab: AssetsTab;
  onTabChange: (tab: AssetsTab) => void;
  fonts: FontAsset[];
  images: ImageAsset[];
  bodyFontId?: string;
  codeFontId?: string;
  /** IndexedDB 是否可用（隐私模式下退化为内存存储） */
  persistent: boolean;
  onImportFonts: (files: File[]) => void | Promise<void>;
  onImportImages: (files: File[]) => void | Promise<void>;
  onDelete: (id: string) => void;
  onUpdateFont: (id: string, patch: Partial<FontAsset>) => void;
  onApplyBodyFont: (id: string | null) => void;
  onApplyCodeFont: (id: string | null) => void;
  onInsertImage: (asset: ImageAsset, mode: "ref" | "dataUrl") => void;
  /** 把当前文档（含图片）保存为 .mdstudio.json */
  onSaveDocument: () => void;
  onClearFonts: () => void;
  onClearImages: () => void;
  onToast: AssetToast;
}

export type AssetsTab = "fonts" | "images";

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const FONT_ACCEPT = ".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2";
const FONT_EXT_RE = /\.(ttf|otf|woff2?)$/i;

const FONT_FORMAT_LABEL: Record<FontAsset["format"], string> = {
  truetype: "TTF",
  opentype: "OTF",
  woff: "WOFF",
  woff2: "WOFF2",
};

/** 资源库面板：集中导入 / 管理自定义字体与图片 */
export function AssetsPanel(props: AssetsPanelProps) {
  const { open, onClose, fonts, images, tab } = props;
  const [dragging, setDragging] = useState(false);
  const [sample, setSample] = useState("汉字排版 Aa Bb 0123");
  const fontInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleInput = (e: ChangeEvent<HTMLInputElement>, kind: "fonts" | "images"): void => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    void (kind === "fonts" ? props.onImportFonts(files) : props.onImportImages(files));
  };

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!files.length) return;
    if (tab === "fonts") {
      const picked = files.filter((f) => FONT_EXT_RE.test(f.name));
      if (!picked.length) {
        props.onToast("请拖入 .ttf / .otf / .woff / .woff2 字体文件", "error");
        return;
      }
      void props.onImportFonts(picked);
    } else {
      const picked = files.filter((f) => f.type.startsWith("image/"));
      if (!picked.length) {
        props.onToast("请拖入图片文件", "error");
        return;
      }
      void props.onImportImages(picked);
    }
  };

  const copyText = async (text: string, label: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      props.onToast(`${label}已复制到剪贴板`, "success");
    } catch {
      props.onToast("复制失败，请手动选择文本", "error");
    }
  };

  const confirmDelete = (label: string, fn: () => void): void => {
    if (window.confirm(`确定删除「${label}」？此操作不可撤销。`)) fn();
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal assets-modal" role="dialog" aria-modal="true" aria-label="资源库">
        <div className="assets-head">
          <h3>资源库</h3>
          <span className="hint">导入自己的字体与图片，预览与所有导出格式都会自动内嵌</span>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="assets-tabs seg">
          <button className={tab === "fonts" ? "active" : ""} onClick={() => props.onTabChange("fonts")}>
            字体库 {fonts.length ? `(${fonts.length})` : ""}
          </button>
          <button className={tab === "images" ? "active" : ""} onClick={() => props.onTabChange("images")}>
            文档图片 {images.length ? `(${images.length})` : ""}
          </button>
        </div>

        {!props.persistent && (
          <div className="assets-warn">
            当前浏览器无法持久化存储（可能处于隐私模式），刷新页面后已导入的资源会丢失。
          </div>
        )}

        <div
          className={`assets-body${dragging ? " dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDragging(false);
          }}
          onDrop={onDrop}
        >
          {dragging && <div className="assets-drop">松开以导入{tab === "fonts" ? "字体" : "图片"}</div>}

          {tab === "fonts" ? (
            <>
              <div className="assets-toolbar">
                <button className="btn primary" onClick={() => fontInputRef.current?.click()}>
                  ＋ 导入字体文件
                </button>
                <span className="hint">
                  TTF / OTF / WOFF / WOFF2，可多选；字体是全局资源，保存在本机供所有文档使用
                </span>
                <span className="spacer" />
                <label className="assets-sample-input">
                  预览文本
                  <input value={sample} onChange={(e) => setSample(e.target.value)} />
                </label>
              </div>

              {fonts.length === 0 ? (
                <div className="assets-empty">
                  还没有导入字体。点击上方按钮或把字体文件拖到这里。
                  <br />
                  导入后可以「设为正文」，预览、PDF、HTML、PPTX、DOCX 都会使用它。
                </div>
              ) : (
                <div className="asset-list">
                  {fonts.map((f) => (
                    <div className="asset-font" key={f.id}>
                      <div
                        className="asset-font-sample"
                        style={{ fontFamily: `"${f.family.replace(/"/g, "")}"` }}
                      >
                        {sample || "Aa"}
                      </div>
                      <div className="asset-font-main">
                        <input
                          className="asset-family-input"
                          value={f.family}
                          spellCheck={false}
                          aria-label="字体族名"
                          onChange={(e) => props.onUpdateFont(f.id, { family: e.target.value })}
                        />
                        <div className="asset-font-row">
                          <select
                            value={String(f.weight)}
                            aria-label="字重"
                            onChange={(e) => props.onUpdateFont(f.id, { weight: Number(e.target.value) })}
                          >
                            {WEIGHTS.map((w) => (
                              <option key={w} value={w}>
                                {w}
                              </option>
                            ))}
                          </select>
                          <select
                            value={f.style}
                            aria-label="字形"
                            onChange={(e) => props.onUpdateFont(f.id, { style: e.target.value as FontStyle })}
                          >
                            <option value="normal">常规</option>
                            <option value="italic">斜体</option>
                            <option value="oblique">倾斜</option>
                          </select>
                          <span className="asset-meta">
                            {FONT_FORMAT_LABEL[f.format]} · {humanSize(f.size)}
                          </span>
                        </div>
                        <div className="asset-filename" title={f.name}>
                          {f.name}
                        </div>
                      </div>
                      <div className="asset-actions">
                        <button
                          className={`btn ghost${props.bodyFontId === f.id ? " active" : ""}`}
                          onClick={() => props.onApplyBodyFont(props.bodyFontId === f.id ? null : f.id)}
                          title="把该字体设为主正文字体"
                        >
                          {props.bodyFontId === f.id ? "正文字体 ✓" : "设为正文"}
                        </button>
                        <button
                          className={`btn ghost${props.codeFontId === f.id ? " active" : ""}`}
                          onClick={() => props.onApplyCodeFont(props.codeFontId === f.id ? null : f.id)}
                          title="把该字体设为代码字体"
                        >
                          {props.codeFontId === f.id ? "代码字体 ✓" : "设为代码"}
                        </button>
                        <button
                          className="btn ghost danger"
                          onClick={() => confirmDelete(f.family || f.name, () => props.onDelete(f.id))}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="assets-toolbar">
                <button className="btn primary" onClick={() => imageInputRef.current?.click()}>
                  ＋ 导入图片
                </button>
                <button className="btn" onClick={props.onSaveDocument} title="把文档与图片打包为 .mdstudio.json">
                  ⤓ 保存文档
                </button>
                <span className="hint">
                  PNG / JPEG / GIF / WebP / SVG。图片属于当前文档，会在「保存文档」时一起打包，
                  打开该文件后 <code>asset://</code> 引用会自动指回图片。
                </span>
              </div>

              {images.length === 0 ? (
                <div className="assets-empty">
                  还没有导入图片。点击上方按钮或把图片拖到这里。
                  <br />
                  「插入引用」会在 Markdown 里写入 <code>asset://…</code>，正文更清爽。
                </div>
              ) : (
                <div className="asset-grid">
                  {images.map((img) => (
                    <figure className="asset-card" key={img.id}>
                      <div className="asset-thumb">
                        <img src={img.dataUrl} alt={img.name} loading="lazy" />
                      </div>
                      <figcaption>
                        <div className="asset-card-name" title={img.filename}>
                          {img.name}
                        </div>
                        <div className="asset-meta">
                          {img.width}×{img.height} · {humanSize(img.size)}
                        </div>
                        <div className="asset-card-actions">
                          <button className="btn ghost" onClick={() => props.onInsertImage(img, "ref")}>
                            插入引用
                          </button>
                          <button className="btn ghost" onClick={() => props.onInsertImage(img, "dataUrl")}>
                            插入内嵌
                          </button>
                          <button
                            className="btn ghost"
                            onClick={() => void copyText(`![${stripExtension(img.name)}](${assetRef(img.id)})`, "Markdown")}
                          >
                            复制
                          </button>
                          <button
                            className="btn ghost danger"
                            onClick={() => confirmDelete(img.name, () => props.onDelete(img.id))}
                          >
                            删除
                          </button>
                        </div>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="assets-foot">
          <span className="hint">
            {tab === "fonts"
              ? `字体库（全局）：${fonts.length} 个 · ${humanSize(fonts.reduce((sum, f) => sum + f.size, 0))}`
              : `文档图片（随文档）：${images.length} 张 · ${humanSize(images.reduce((sum, img) => sum + img.size, 0))}`}
          </span>
          <span className="spacer" />
          {tab === "fonts" && fonts.length > 0 && (
            <button
              className="btn ghost danger"
              onClick={() => {
                if (window.confirm("确定清空字体库？正文/代码字体设置也会一并清除。")) props.onClearFonts();
              }}
            >
              清空字体库
            </button>
          )}
          {tab === "images" && images.length > 0 && (
            <button
              className="btn ghost danger"
              onClick={() => {
                if (window.confirm("确定清空当前文档的全部图片？已插入正文的引用会显示为占位图。")) {
                  props.onClearImages();
                }
              }}
            >
              清空文档图片
            </button>
          )}
        </div>

        <input
          ref={fontInputRef}
          type="file"
          accept={FONT_ACCEPT}
          multiple
          style={{ display: "none" }}
          onChange={(e) => handleInput(e, "fonts")}
        />
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => handleInput(e, "images")}
        />
      </div>
    </div>
  );
}
