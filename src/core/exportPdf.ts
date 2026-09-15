import type { ExportMeta, ThemeTokens } from "./types";
import { renderMarkdown } from "./render";
import { buildStandaloneHtml } from "./document";

async function waitForAssets(doc: Document): Promise<void> {
  try {
    if (doc.fonts?.ready) await doc.fonts.ready;
  } catch {
    /* 忽略字体等待失败 */
  }
  const images = Array.from(doc.images);
  await Promise.all(
    images.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
    ),
  );
  await new Promise((r) => setTimeout(r, 120));
}

/**
 * 通过隐藏 iframe + 浏览器打印引擎导出 PDF。
 * 优点：矢量文字、跨平台一致、无额外依赖；用户在打印对话框选择「另存为 PDF」。
 */
export function printHtmlDocument(html: string): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText =
      "position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;pointer-events:none;";
    iframe.srcdoc = html;

    iframe.onload = () => {
      void (async () => {
        const win = iframe.contentWindow;
        const doc = iframe.contentDocument;
        if (win && doc) {
          await waitForAssets(doc);
          try {
            win.focus();
            win.print();
          } catch (err) {
            console.error("[md-studio] 打印失败", err);
          }
        }
        setTimeout(() => iframe.remove(), 800);
        resolve();
      })();
    };

    document.body.appendChild(iframe);
  });
}

/** 在新标签页打开打印视图（部分环境下比 iframe 更稳） */
export function openPrintWindow(html: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    URL.revokeObjectURL(url);
    throw new Error("弹窗被拦截，请允许后重试");
  }
  const timer = window.setInterval(() => {
    if (win.closed) {
      window.clearInterval(timer);
      URL.revokeObjectURL(url);
    }
  }, 1000);
}

export interface PdfResult {
  mode: "print";
}

/** 生成打印文档并唤起打印对话框 */
export async function exportPdf(
  markdown: string,
  tokens: ThemeTokens,
  meta: ExportMeta,
): Promise<PdfResult> {
  const { html } = renderMarkdown(markdown, { numbered: tokens.headingNumbered });
  const doc = buildStandaloneHtml({
    tokens,
    meta,
    bodyHtml: html,
    flow: false,
    includeKatex: /\$[^$\n]+\$|\$\$/.test(markdown),
    forPrint: true,
  });
  await printHtmlDocument(doc);
  return { mode: "print" };
}
