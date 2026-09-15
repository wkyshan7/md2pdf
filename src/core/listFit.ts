/**
 * 列表「不超出版心」的运行时兜底。
 *
 * CSS 已经按嵌套层级自动收窄缩进并强制长内容换行；但用户可能使用超大字号、
 * 极窄纸张或超长不可断词，这里再实测一次：只要列表内容仍然宽于其可用宽度，
 * 就给该列表加上 `.md-list-tight`（更小的缩进 + 代码块换行），确保不超出左右版心。
 */

/** 返回被收缩的列表数量 */
export function fitOverflowingLists(root: ParentNode): number {
  const lists = Array.from(root.querySelectorAll<HTMLElement>("ul, ol"));
  if (lists.length === 0) return 0;

  for (const list of lists) list.classList.remove("md-list-tight");

  // 一次性读取全部布局，避免读写交错导致多次强制重排
  const overflowing = lists.filter((list) => list.scrollWidth > list.clientWidth + 1);

  for (const list of overflowing) {
    list.classList.add("md-list-tight");
    list.querySelectorAll<HTMLElement>("pre.md-code-block").forEach((pre) => pre.classList.add("md-wrap"));
  }
  return overflowing.length;
}

/**
 * 页面级兜底：正文整体仍横向溢出时，允许在任意字符处断行。
 * 用于极端情况（超长 URL、超宽表格）保证内容不被右侧裁掉。
 */
export function fitPageOverflow(page: HTMLElement): boolean {
  const body = page.querySelector<HTMLElement>(".md-body");
  if (!body) return false;
  if (body.scrollWidth > body.clientWidth + 1) {
    body.classList.add("md-overflow-compact");
    return true;
  }
  body.classList.remove("md-overflow-compact");
  return false;
}
