import { useRef } from "react";
import type { DocxOptions, ExportMeta, PptxOptions, RasterPdfOptions, ThemeTokens } from "../core/types";
import { PAGE_SIZES } from "../core/types";
import { CODE_THEMES, getCodeTheme } from "../core/highlightThemes";
import { downloadText } from "../core/download";
import {
  ColorInput,
  Field,
  NumberInput,
  Section,
  Select,
  Slider,
  TextInput,
  Toggle,
} from "./controls";

const FONT_OPTIONS = [
  {
    value:
      '"Source Han Sans SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", -apple-system, "Segoe UI", Roboto, sans-serif',
    label: "无衬线（黑体 / 系统 UI）",
  },
  {
    value: '"Times New Roman", "Songti SC", "SimSun", "Noto Serif SC", serif',
    label: "衬线（宋体 / Times）",
  },
  {
    value: '"Noto Serif SC", "Songti SC", Georgia, "Times New Roman", serif',
    label: "文章衬线（Georgia / 宋体）",
  },
  {
    value:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
    label: "GitHub 风格",
  },
  { value: '"KaiTi", "Kaiti SC", "STKaiti", serif', label: "楷体" },
  { value: '"Microsoft YaHei", "PingFang SC", sans-serif', label: "微软雅黑 / 苹方" },
];

/** 预设 / 自定义主题在面板里统一展示的视图类型 */
export interface ThemeOption {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
}

export interface SettingsPanelProps {
  tokens: ThemeTokens;
  patch: (p: Partial<ThemeTokens>) => void;
  meta: ExportMeta;
  patchMeta: (p: Partial<ExportMeta>) => void;
  pptx: PptxOptions;
  patchPptx: (p: Partial<PptxOptions>) => void;
  docx: DocxOptions;
  patchDocx: (p: Partial<DocxOptions>) => void;
  pdf: RasterPdfOptions;
  patchPdf: (p: Partial<RasterPdfOptions>) => void;
  onPrintPdf: () => void;
  presetId: string;
  onPreset: (id: string) => void;
  /** 内置预设 + 用户自定义主题 */
  themes: ThemeOption[];
  /** 当前选中的是否是自定义主题（决定是否显示「更新 / 删除」） */
  activeIsUserTheme: boolean;
  onCreateTheme: (name: string) => void;
  onUpdateTheme: () => void;
  onDeleteTheme: (id: string) => void;
  onReset: () => void;
  /** 打开资源库（导入 / 管理字体与图片） */
  onOpenAssets: () => void;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const { tokens: t, patch, meta, patchMeta, pptx, patchPptx, docx, patchDocx, pdf, patchPdf } = props;
  const fileRef = useRef<HTMLInputElement>(null);

  const changeCodeTheme = (id: string): void => {
    const theme = getCodeTheme(id);
    patch({ codeTheme: id, codeBlockBg: theme.bg, codeBlockColor: theme.fg });
  };

  const exportThemeJson = (): void => {
    downloadText(JSON.stringify({ version: 1, tokens: t }, null, 2), "md-studio-theme.json", "application/json");
  };

  const importThemeJson = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as { tokens?: Partial<ThemeTokens> };
        if (data.tokens) patch(data.tokens);
      } catch {
        alert("主题文件解析失败");
      }
    };
    reader.readAsText(file, "utf-8");
  };

  const createTheme = (): void => {
    const name = window.prompt("新主题名称", "我的主题");
    if (name === null) return;
    props.onCreateTheme(name);
  };

  const deleteTheme = (id: string): void => {
    if (window.confirm("确定删除这个自定义主题？")) props.onDeleteTheme(id);
  };

  return (
    <div className="panel-inner">
      <Section title="主题预设" open>
        <div className="preset-grid">
          {props.themes.map((p) => (
            <button
              key={p.id}
              className={`preset-card${props.presetId === p.id ? " active" : ""}${p.builtin ? "" : " user"}`}
              onClick={() => props.onPreset(p.id)}
              title={p.description}
            >
              <div className="name">
                {p.name}
                {!p.builtin && <span className="preset-tag">自定义</span>}
              </div>
              <div className="desc">{p.description}</div>
            </button>
          ))}
        </div>
        <div className="preset-actions">
          <button className="btn primary" onClick={createTheme}>
            ＋ 新建主题
          </button>
          {props.activeIsUserTheme && (
            <>
              <button className="btn ghost" onClick={props.onUpdateTheme} title="用当前设置为该主题保存新的外观">
                更新当前主题
              </button>
              <button className="btn ghost danger" onClick={() => deleteTheme(props.presetId)}>
                删除主题
              </button>
            </>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost" onClick={exportThemeJson}>
            导出主题 JSON
          </button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>
            导入主题
          </button>
          <button className="btn ghost" onClick={props.onReset}>
            恢复默认
          </button>
        </div>
        <div className="hint">
          「新建主题」会把当前所有外观设置存成一个自定义主题，与内置预设并列，随时切换。
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importThemeJson(f);
            e.target.value = "";
          }}
        />
      </Section>

      <Section title="页面" open>
        <Select
          label="纸张"
          value={t.pageSize}
          onChange={(v) => patch({ pageSize: v })}
          options={(Object.keys(PAGE_SIZES) as (keyof typeof PAGE_SIZES)[]).map((k) => ({
            value: k,
            label: PAGE_SIZES[k].label,
          }))}
        />
        <Select
          label="方向"
          value={t.orientation}
          onChange={(v) => patch({ orientation: v })}
          options={[
            { value: "portrait", label: "纵向" },
            { value: "landscape", label: "横向" },
          ]}
        />
        <Slider label="页边距" value={t.marginMm} min={0} max={45} unit="mm" onChange={(v) => patch({ marginMm: v })} />
        <Toggle label="H1 前分页" checked={t.pageBreakBeforeH1} onChange={(v) => patch({ pageBreakBeforeH1: v })} />
        <Toggle label="H2 前分页" checked={t.pageBreakBeforeH2} onChange={(v) => patch({ pageBreakBeforeH2: v })} />
      </Section>

      <Section title="字体与配色" open>
        <button className="btn" onClick={props.onOpenAssets}>
          🗂 打开资源库（导入字体 / 图片）
        </button>
        <Select
          label="字体"
          value={FONT_OPTIONS.some((f) => f.value === t.fontFamily) ? t.fontFamily : "__custom"}
          onChange={(v) => v !== "__custom" && patch({ fontFamily: v })}
          options={[...FONT_OPTIONS, { value: "__custom", label: "自定义（下方填写）" }]}
        />
        <TextInput label="字体栈" value={t.fontFamily} onChange={(v) => patch({ fontFamily: v })} />
        <Slider label="正文字号" value={t.fontSize} min={11} max={26} unit="px" onChange={(v) => patch({ fontSize: v })} />
        <Slider label="行高" value={t.lineHeight} min={1.1} max={2.6} step={0.05} onChange={(v) => patch({ lineHeight: v })} />
        <Slider
          label="段间距"
          value={t.paraSpacing}
          min={0}
          max={2.4}
          step={0.05}
          unit="em"
          onChange={(v) => patch({ paraSpacing: v })}
        />
        <ColorInput label="正文颜色" value={t.textColor} onChange={(v) => patch({ textColor: v })} />
        <ColorInput label="背景颜色" value={t.bgColor} onChange={(v) => patch({ bgColor: v })} />
        <ColorInput label="强调色" value={t.accentColor} onChange={(v) => patch({ accentColor: v })} />
        <ColorInput label="链接颜色" value={t.linkColor} onChange={(v) => patch({ linkColor: v })} />
        <div className="hint">
          在资源库中导入 TTF / OTF / WOFF 字体后，可一键设为正文或代码字体；
          字体会内嵌进导出的 PDF / HTML，图片同理。
        </div>
      </Section>

      <Section title="标题">
        <Select
          label="对齐"
          value={t.headingAlign}
          onChange={(v) => patch({ headingAlign: v })}
          options={[
            { value: "left", label: "左对齐" },
            { value: "center", label: "居中" },
          ]}
        />
        <Select
          label="字重"
          value={String(t.headingWeight)}
          onChange={(v) => patch({ headingWeight: Number(v) })}
          options={[400, 500, 600, 700, 800, 900].map((w) => ({ value: String(w), label: String(w) }))}
        />
        <Slider label="H1 字号" value={t.h1Size} min={18} max={56} unit="px" onChange={(v) => patch({ h1Size: v })} />
        <Slider label="H2 字号" value={t.h2Size} min={16} max={44} unit="px" onChange={(v) => patch({ h2Size: v })} />
        <Slider label="H3 字号" value={t.h3Size} min={14} max={34} unit="px" onChange={(v) => patch({ h3Size: v })} />
        <Slider label="H4 字号" value={t.h4Size} min={13} max={28} unit="px" onChange={(v) => patch({ h4Size: v })} />
        <ColorInput label="标题颜色" value={t.headingColor} onChange={(v) => patch({ headingColor: v })} />
        <Toggle label="H1 下划线" checked={t.h1Rule} onChange={(v) => patch({ h1Rule: v })} />
        <Toggle label="H2 下划线" checked={t.h2Rule} onChange={(v) => patch({ h2Rule: v })} />
        <Toggle label="标题自动编号" checked={t.headingNumbered} onChange={(v) => patch({ headingNumbered: v })} />
        {t.headingNumbered && (
          <Select
            label="编号到第几级"
            value={String(t.headingNumberMaxLevel)}
            onChange={(v) => patch({ headingNumberMaxLevel: Number(v) })}
            options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `H1–H${n}` }))}
          />
        )}
        {t.headingNumbered && (
          <div className="hint">
            想要某个标题跳过编号，在标题末尾加属性即可，例如 <code>## 摘要 {"{.no-number}"}</code>
            （也支持 <code>.unnumbered</code>）。被标记的标题不显示序号，也不占用编号，下一个标题序号保持连续。
          </div>
        )}
      </Section>

      <Section title="代码">
        <Select
          label="高亮主题"
          value={t.codeTheme}
          onChange={changeCodeTheme}
          options={CODE_THEMES.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Slider label="代码字号" value={t.codeFontSize} min={10} max={20} unit="px" onChange={(v) => patch({ codeFontSize: v })} />
        <ColorInput label="代码块背景" value={t.codeBlockBg} onChange={(v) => patch({ codeBlockBg: v })} />
        <ColorInput label="代码块文字" value={t.codeBlockColor} onChange={(v) => patch({ codeBlockColor: v })} />
        <ColorInput label="行内代码背景" value={t.inlineCodeBg} onChange={(v) => patch({ inlineCodeBg: v })} />
        <ColorInput label="行内代码文字" value={t.inlineCodeColor} onChange={(v) => patch({ inlineCodeColor: v })} />
        <Toggle label="代码自动换行" checked={t.codeWrap} onChange={(v) => patch({ codeWrap: v })} />
      </Section>

      <Section title="表格与引用">
        <ColorInput label="表格边框" value={t.tableBorderColor} onChange={(v) => patch({ tableBorderColor: v })} />
        <ColorInput label="表头背景" value={t.tableHeaderBg} onChange={(v) => patch({ tableHeaderBg: v })} />
        <Toggle label="斑马纹" checked={t.tableStripe} onChange={(v) => patch({ tableStripe: v })} />
        <ColorInput label="引用边框" value={t.blockquoteBorder} onChange={(v) => patch({ blockquoteBorder: v })} />
        <ColorInput label="引用背景" value={t.blockquoteBg} onChange={(v) => patch({ blockquoteBg: v })} />
        <ColorInput label="引用文字" value={t.blockquoteColor} onChange={(v) => patch({ blockquoteColor: v })} />
      </Section>

      <Section title="PDF 选项" open>
        <Select
          label="渲染精度"
          value={String(pdf.dpi)}
          onChange={(v) => patchPdf({ dpi: Number(v) })}
          options={[
            { value: "150", label: "150 DPI · 体积小" },
            { value: "200", label: "200 DPI · 推荐" },
            { value: "300", label: "300 DPI · 印刷级" },
          ]}
        />
        <Select
          label="图像编码"
          value={pdf.imageFormat}
          onChange={(v) => patchPdf({ imageFormat: v })}
          options={[
            { value: "jpeg", label: "JPEG（体积小）" },
            { value: "png", label: "PNG（无损、体积大）" },
          ]}
        />
        {pdf.imageFormat === "jpeg" && (
          <Slider
            label="JPEG 画质"
            value={pdf.jpegQuality}
            min={0.7}
            max={1}
            step={0.01}
            onChange={(v) => patchPdf({ jpegQuality: v })}
          />
        )}
        <Toggle
          label="输出页码（默认关闭）"
          checked={pdf.pageNumbers}
          onChange={(v) => patchPdf({ pageNumbers: v })}
        />
        <div className="hint">
          「导出 PDF」会把预览的真实渲染结果分页后写入 PDF，因此版式与预览完全一致；
          代价是文字为位图，不可选中 / 搜索。需要矢量文字时改用下方按钮（浏览器打印）。
          300 DPI 更清晰但渲染较慢、文件较大。
        </div>
        <button className="btn" onClick={props.onPrintPdf}>
          用浏览器打印（矢量文字）
        </button>
      </Section>

      <Section title="文档元信息">
        <TextInput label="标题" value={meta.title} onChange={(v) => patchMeta({ title: v })} />
        <TextInput label="作者" value={meta.author} onChange={(v) => patchMeta({ author: v })} />
        <TextInput label="摘要 / 主题" value={meta.subject} onChange={(v) => patchMeta({ subject: v })} />
        <TextInput label="页眉（打印）" value={meta.header} onChange={(v) => patchMeta({ header: v })} />
        <TextInput label="页脚（打印）" value={meta.footer} onChange={(v) => patchMeta({ footer: v })} />
        <div className="hint">
          页眉 / 页脚在 PDF 打印时以固定元素重复出现；页码请使用打印对话框的「页眉和页脚」选项，
          或导出 DOCX（自动带页码）。
        </div>
      </Section>

      <Section title="PPTX 选项">
        <Select
          label="分页依据"
          value={String(pptx.splitLevel)}
          onChange={(v) => patchPptx({ splitLevel: Number(v) as 1 | 2 })}
          options={[
            { value: "1", label: "按一级标题" },
            { value: "2", label: "按二级标题" },
          ]}
        />
        <Select
          label="画幅"
          value={pptx.slideSize}
          onChange={(v) => patchPptx({ slideSize: v })}
          options={[
            { value: "16:9", label: "16:9 宽屏" },
            { value: "4:3", label: "4:3 传统" },
          ]}
        />
        <Toggle label="章节页" checked={pptx.includeTitleSlide} onChange={(v) => patchPptx({ includeTitleSlide: v })} />
        <Toggle
          label="代码块作为文本框"
          checked={pptx.codeAsTextBox}
          onChange={(v) => patchPptx({ codeAsTextBox: v })}
        />
        <NumberInput
          label="每页最多条目"
          value={pptx.bulletsPerSlide}
          min={3}
          max={14}
          onChange={(v) => patchPptx({ bulletsPerSlide: v })}
        />
        <ColorInput label="PPT 背景" value={t.pptxBg} onChange={(v) => patch({ pptxBg: v })} />
        <ColorInput label="PPT 标题色" value={t.pptxTitleColor} onChange={(v) => patch({ pptxTitleColor: v })} />
        <ColorInput label="PPT 正文色" value={t.pptxBodyColor} onChange={(v) => patch({ pptxBodyColor: v })} />
        <ColorInput label="PPT 强调色" value={t.pptxAccent} onChange={(v) => patch({ pptxAccent: v })} />
      </Section>

      <Section title="DOCX 选项">
        <Toggle label="生成目录（Word 打开时更新）" checked={docx.includeToc} onChange={(v) => patchDocx({ includeToc: v })} />
        <Toggle label="标题自动编号" checked={docx.headingNumbered} onChange={(v) => patchDocx({ headingNumbered: v })} />
        <Toggle label="代码块底纹" checked={docx.codeShading} onChange={(v) => patchDocx({ codeShading: v })} />
        <div className="hint">
          DOCX 保留真正的标题层级、列表、表格与页码；数学公式会以 LaTeX 源码形式给出。
        </div>
      </Section>

      <Section title="高级：自定义 CSS">
        <Field label="注入到预览与 HTML 导出的 CSS（作用域 .md-body）">
          <textarea
            className="small"
            value={t.customCss}
            spellCheck={false}
            placeholder={".md-body h1 { letter-spacing: -0.01em; }"}
            onChange={(e) => patch({ customCss: e.target.value })}
          />
        </Field>
      </Section>
    </div>
  );
}
