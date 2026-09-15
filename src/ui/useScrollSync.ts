import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import type { Heading } from "../core/parser";

/**
 * 编辑器（textarea）与预览区之间的双向同步滚动。
 *
 * 做法：以 Markdown 标题为锚点，把两侧滚动位置归一化成 0–1 的进度，
 * 在锚点之间做分段线性插值。没有标题时自动退化为等比映射。
 * 用「预期值」而不是布尔锁来屏蔽程序化滚动产生的回环事件。
 */

interface Anchor {
  e: number;
  p: number;
}

export interface ScrollSyncOptions {
  editorRef: RefObject<HTMLTextAreaElement | null>;
  previewRef: RefObject<HTMLElement | null>;
  headings: Heading[];
  enabled: boolean;
  /** 布局相关依赖（如缩放、纸张、渲染后的 HTML），变化时重建锚点 */
  layoutKey: string;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 在按 fromKey 排序的锚点间做分段线性插值 */
function interpolate(anchors: Anchor[], from: "e" | "p", x: number): number {
  const to = from === "e" ? "p" : "e";
  if (anchors.length === 0) return x;
  const list = from === "e" ? anchors : [...anchors].sort((a, b) => a.p - b.p);

  const first = list[0];
  if (x <= first[from]) {
    return first[from] > 0 ? (x / first[from]) * first[to] : first[to];
  }

  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const b = list[i];
    if (x <= b[from]) {
      const span = b[from] - a[from];
      const t = span > 0 ? (x - a[from]) / span : 0;
      return a[to] + t * (b[to] - a[to]);
    }
  }

  const last = list[list.length - 1];
  if (last[from] < 1) {
    const t = (x - last[from]) / (1 - last[from]);
    return last[to] + t * (1 - last[to]);
  }
  return last[to];
}

export function useScrollSync({
  editorRef,
  previewRef,
  headings,
  enabled,
  layoutKey,
}: ScrollSyncOptions): void {
  const anchors = useRef<Anchor[]>([]);
  /** 程序化滚动写入的预期位置，用于忽略由此触发的 scroll 事件 */
  const expected = useRef<{ e: number; p: number }>({ e: NaN, p: NaN });

  const rebuild = useCallback(() => {
    const ed = editorRef.current;
    const pv = previewRef.current;
    if (!ed || !pv) return;

    const totalLines = Math.max(1, ed.value.split("\n").length);
    const edMax = Math.max(1, ed.scrollHeight - ed.clientHeight);
    const pvMax = Math.max(1, pv.scrollHeight - pv.clientHeight);
    const pvRect = pv.getBoundingClientRect();

    const els = pv.querySelectorAll<HTMLElement>(
      ".md-body h1, .md-body h2, .md-body h3, .md-body h4, .md-body h5, .md-body h6",
    );
    const count = Math.min(els.length, headings.length);
    const list: Anchor[] = [];
    for (let i = 0; i < count; i++) {
      // 编辑器：用行号占比估算内容偏移（textarea 存在软换行，只能近似）
      const editorOffset = ((headings[i].line ?? 0) / totalLines) * ed.scrollHeight;
      const e = clamp01(editorOffset / edMax);
      // 预览：用相对滚动容器的真实偏移
      const previewOffset = els[i].getBoundingClientRect().top - pvRect.top + pv.scrollTop;
      const p = clamp01(previewOffset / pvMax);
      list.push({ e, p });
    }
    list.sort((a, b) => a.e - b.e);
    anchors.current = list;
  }, [editorRef, previewRef, headings]);

  /* 布局 / 内容变化后重建锚点 */
  useLayoutEffect(() => {
    rebuild();
  }, [rebuild, layoutKey, enabled]);

  /* 图片等异步资源加载会改变预览高度，用 ResizeObserver 兜底 */
  useEffect(() => {
    const pv = previewRef.current;
    if (!pv || typeof ResizeObserver === "undefined") return;
    const inner = pv.querySelector(".md-page");
    const ro = new ResizeObserver(() => rebuild());
    if (inner) ro.observe(inner);
    ro.observe(pv);
    return () => ro.disconnect();
  }, [previewRef, rebuild, layoutKey]);

  /* 双向滚动监听 */
  useEffect(() => {
    const ed = editorRef.current;
    const pv = previewRef.current;
    if (!ed || !pv || !enabled) return;

    const onEditorScroll = (): void => {
      if (Math.abs(ed.scrollTop - expected.current.e) < 1.5) {
        expected.current.e = NaN;
        return;
      }
      const edMax = Math.max(1, ed.scrollHeight - ed.clientHeight);
      const pvMax = Math.max(1, pv.scrollHeight - pv.clientHeight);
      const progress = clamp01(ed.scrollTop / edMax);
      const target = interpolate(anchors.current, "e", progress) * pvMax;
      if (Math.abs(pv.scrollTop - target) > 0.5) {
        pv.scrollTop = target;
        expected.current.p = pv.scrollTop;
      }
    };

    const onPreviewScroll = (): void => {
      if (Math.abs(pv.scrollTop - expected.current.p) < 1.5) {
        expected.current.p = NaN;
        return;
      }
      const edMax = Math.max(1, ed.scrollHeight - ed.clientHeight);
      const pvMax = Math.max(1, pv.scrollHeight - pv.clientHeight);
      const progress = clamp01(pv.scrollTop / pvMax);
      const target = interpolate(anchors.current, "p", progress) * edMax;
      if (Math.abs(ed.scrollTop - target) > 0.5) {
        ed.scrollTop = target;
        expected.current.e = ed.scrollTop;
      }
    };

    ed.addEventListener("scroll", onEditorScroll, { passive: true });
    pv.addEventListener("scroll", onPreviewScroll, { passive: true });
    return () => {
      ed.removeEventListener("scroll", onEditorScroll);
      pv.removeEventListener("scroll", onPreviewScroll);
    };
  }, [enabled, editorRef, previewRef]);

  /* 关闭同步时清空预期值，避免下次开启时误判 */
  useEffect(() => {
    if (!enabled) expected.current = { e: NaN, p: NaN };
  }, [enabled]);
}
