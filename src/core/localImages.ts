/**
 * 本地图片链接处理。
 *
 * 很多 Markdown 是在本地写的，图片用相对/绝对路径引用，例如：
 *
 *   ![架构图](./images/arch.png)
 *   ![照片](C:\Users\me\Pictures\cat.jpg)
 *   <img src="./diagram.svg">
 *
 * 浏览器出于安全限制无法直接读取这些本地路径，预览里就只剩裂图。
 * 本模块负责：
 *   1. 从 Markdown 中找出「本地路径」的图片引用（跳过代码块 / 行内代码 / 网络地址）；
 *   2. 用文件名（basename）把引用与用户导入的图片资产对应起来；
 *   3. 把命中的引用原地改写成 `asset://<id>`，正文其他内容不变。
 */

export interface LocalImageRef {
  /** 完整匹配文本，例如 `![图](./a/b.png)` */
  raw: string;
  /** 图片地址（已去掉 `<>` 包裹） */
  src: string;
  /** 归一化后的文件名（小写），用于与本地文件匹配 */
  basename: string;
  /** src 在 Markdown 中的起止下标（[start, end)，直接替换该区间即可） */
  start: number;
  end: number;
}

const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;
/** 明确不是本地路径的协议 / 前缀 */
const REMOTE_SCHEME_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** 判断一个图片地址是否是「本地文件路径」，需要在站点内导入后才能显示 */
export function isLocalImageSrc(src: string): boolean {
  const s = src.trim();
  if (!s) return false;
  // Windows 盘符（C:\ / C:/）本质是本地路径，需在协议判断之前识别
  if (WINDOWS_DRIVE_RE.test(s)) return true;
  // file:// 也是本地文件
  if (/^file:\/\//i.test(s)) return true;
  if (REMOTE_SCHEME_RE.test(s)) return false;
  return true;
}

/**
 * 从图片地址里取归一化文件名：兼容 `\` / `/`、URL 编码、`file://`、query / hash。
 * `./images/A.PNG?x=1` → `a.png`
 */
export function imageBasename(src: string): string {
  let s = src.trim().replace(/^<|>$/g, "");
  try {
    s = decodeURIComponent(s);
  } catch {
    /* 非法编码时保持原样 */
  }
  s = s.replace(/\\/g, "/");
  s = s.split("?")[0].split("#")[0];
  const parts = s.split("/").filter(Boolean);
  return (parts[parts.length - 1] ?? s).trim().toLowerCase();
}

/** 围栏代码块（``` / ~~~）在 Markdown 中的区间，未闭合的围栏延伸到文末 */
function fenceRanges(markdown: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const lineRe = /^[ \t]*(`{3,}|~{3,})([^\n]*)$/gm;
  let open: { start: number; char: string; len: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(markdown))) {
    const marker = m[1];
    const lineStart = m.index;
    const lineEnd = m.index + m[0].length;
    if (!open) {
      open = { start: lineStart, char: marker[0], len: marker.length };
    } else if (marker[0] === open.char && marker.length >= open.len && m[2].trim() === "") {
      // 闭合围栏：同种标记、不短于开启者，且其后只有空白
      ranges.push([open.start, lineEnd]);
      open = null;
    }
  }
  if (open) ranges.push([open.start, markdown.length]);
  return ranges;
}

/** 行内代码（`code`）区间，跳过已处于围栏代码块内的反引号 */
function inlineCodeRanges(markdown: string, fences: Array<[number, number]>): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const inFence = (i: number): boolean => fences.some(([a, b]) => i >= a && i < b);
  const re = /`+/g;
  let open: { start: number; ticks: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    if (inFence(m.index)) continue;
    const ticks = m[0].length;
    if (!open) {
      open = { start: m.index, ticks };
    } else if (ticks === open.ticks) {
      ranges.push([open.start, m.index + ticks]);
      open = null;
    }
  }
  return ranges;
}

function insideRanges(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([a, b]) => index >= a && index < b);
}

/** Markdown 图片语法：`![alt](src)` / `![alt](<src>)` / `![alt](src "title")` */
const MD_IMAGE_RE = /!\[([^\]]*)\]\((\s*)(<[^<>\n]*>|[^\s()]+)((?:[ \t]+(?:"[^"]*"|'[^']*'|\([^()]*\)))?[ \t]*\))/g;
/** 原始 HTML 图片标签：`<img src="...">`（引号内的 `>` 不会提前截断） */
const HTML_IMAGE_RE = /<img\b(?:"[^"]*"|'[^']*'|[^>])*>/gi;
/** `src` 属性：必须是独立属性名，避免命中 `data-src` / `alt="src=..."` */
const HTML_SRC_RE = /(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

/**
 * 扫描 Markdown，返回其中所有指向本地文件的图片引用。
 * 代码块与行内代码里的示例不会被误判。
 */
export function findLocalImageRefs(markdown: string): LocalImageRef[] {
  const fences = fenceRanges(markdown);
  const excluded = [...fences, ...inlineCodeRanges(markdown, fences)];
  const refs: LocalImageRef[] = [];
  const seen = new Set<number>();

  const add = (src: string, rawStart: number, rawEnd: number, start: number, end: number): void => {
    if (seen.has(start)) return;
    if (insideRanges(start, excluded)) return;
    const cleaned = src.trim().replace(/^<|>$/g, "");
    if (!isLocalImageSrc(cleaned)) return;
    seen.add(start);
    refs.push({
      raw: markdown.slice(rawStart, rawEnd),
      src: cleaned,
      basename: imageBasename(cleaned),
      start,
      end,
    });
  };

  for (const m of markdown.matchAll(MD_IMAGE_RE)) {
    const srcText = m[3];
    const prefix = m[0].length - m[3].length - m[4].length;
    const start = m.index + prefix;
    add(srcText, m.index, m.index + m[0].length, start, start + srcText.length);
  }

  for (const m of markdown.matchAll(HTML_IMAGE_RE)) {
    const tag = m[0];
    const srcM = HTML_SRC_RE.exec(tag);
    if (!srcM) continue;
    const quoted = srcM[1] ?? srcM[2];
    const value = quoted ?? srcM[3] ?? "";
    if (!value) continue;
    const offset = quoted !== undefined ? srcM[0].indexOf(quoted) : srcM[0].lastIndexOf(value);
    if (offset < 0) continue;
    const start = m.index + srcM.index + offset;
    add(value, m.index, m.index + tag.length, start, start + value.length);
  }

  return refs.sort((a, b) => a.start - b.start);
}

/**
 * 按文件名把引用和图片资产对应起来。
 * `resolve` 返回 null 表示没找到同名图片，该引用会被保留为本地路径。
 */
export function rewriteLocalImageRefs(
  markdown: string,
  refs: LocalImageRef[],
  resolve: (ref: LocalImageRef) => string | null,
): { markdown: string; replaced: number; unmatched: LocalImageRef[] } {
  const unmatched: LocalImageRef[] = [];
  let replaced = 0;
  let out = markdown;
  // 从后往前替换，避免前面的改动影响后续下标
  for (const ref of [...refs].sort((a, b) => b.start - a.start)) {
    const next = resolve(ref);
    if (!next) {
      unmatched.push(ref);
      continue;
    }
    out = out.slice(0, ref.start) + next + out.slice(ref.end);
    replaced++;
  }
  unmatched.reverse();
  return { markdown: out, replaced, unmatched };
}
