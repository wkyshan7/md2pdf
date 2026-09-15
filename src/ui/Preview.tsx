import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { PAGE_SIZES, type ThemeTokens } from "../core/types";
import { fitOverflowingLists, fitPageOverflow } from "../core/listFit";

const MM_TO_PX = 96 / 25.4;

export interface PreviewProps {
  html: string;
  tokens: ThemeTokens;
  flow: boolean;
  zoom: number;
  /** 滚动容器引用，用于与编辑器同步滚动 */
  scrollRef?: RefObject<HTMLDivElement | null>;
}

export function Preview({ html, tokens, flow, zoom, scrollRef }: PreviewProps) {
  const dims = PAGE_SIZES[tokens.pageSize];
  const [wmm, hmm] =
    tokens.orientation === "landscape" ? [dims.h, dims.w] : [dims.w, dims.h];
  const pageRef = useRef<HTMLElement>(null);

  // 列表/内容溢出兜底：渲染与布局变化后自动收缩一次
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const run = (): void => {
      fitOverflowingLists(page);
      fitPageOverflow(page);
    };
    const raf = requestAnimationFrame(run);
    window.addEventListener("resize", run);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", run);
    };
  }, [html, flow, zoom, tokens]);

  return (
    <div className={`preview-scroll${flow ? " preview-flow" : ""}`} ref={scrollRef}>
      <div className="preview-canvas" style={{ zoom }}>
        <main
          ref={pageRef}
          className={`md-page${flow ? " md-flow" : ""}`}
          style={{
            width: flow ? undefined : `${wmm}mm`,
            minHeight: flow ? undefined : `${hmm}mm`,
          }}
        >
          <article className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
        </main>
      </div>
    </div>
  );
}

export function pagePixelWidth(tokens: ThemeTokens): number {
  const dims = PAGE_SIZES[tokens.pageSize];
  const w = tokens.orientation === "landscape" ? dims.h : dims.w;
  return w * MM_TO_PX;
}
