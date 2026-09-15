/**
 * 标题多级编号：生成 `1` / `1.2` / `1.2.2` 形式的序号。
 *
 * 同一套逻辑同时用于预览、HTML/PDF、DOCX 与 PPTX，保证各导出的编号完全一致。
 * 通过 `{#...}` / `{.no-number}` 属性可以让某个标题跳过编号：
 *
 *     # 摘要 {.no-number}
 *     ## 参考文献 {.unnumbered}
 */

export const MAX_HEADING_LEVEL = 6;

/** 带有这些 class 的标题不参与编号（也不推进计数器） */
export const UNNUMBERED_CLASSES = ["no-number", "unnumbered", "md-no-number"];

/** 判断标题 token 是否被标记为「不编号」 */
export function isHeadingUnnumbered(token: { attrGet?: (name: string) => unknown } | undefined | null): boolean {
  if (!token || typeof token.attrGet !== "function") return false;
  const cls = token.attrGet("class");
  if (!cls) return false;
  return String(cls)
    .split(/\s+/)
    .some((name) => UNNUMBERED_CLASSES.includes(name));
}

export class HeadingNumberer {
  private counters: number[];

  constructor(private readonly maxLevel: number = MAX_HEADING_LEVEL) {
    this.counters = new Array<number>(MAX_HEADING_LEVEL).fill(0);
  }

  /**
   * 处理一个标题层级，返回它的序号。
   * - 超过 maxLevel（或非法层级）的标题返回 null，表示不编号；
   * - `skip === true` 时既不编号、也不推进计数器（用于 `.no-number`）。
   */
  next(level: number, skip = false): string | null {
    if (skip) return null;
    if (!Number.isInteger(level) || level < 1 || level > MAX_HEADING_LEVEL) return null;
    if (level > this.maxLevel) return null;
    this.counters[level - 1] += 1;
    for (let i = level; i < MAX_HEADING_LEVEL; i++) this.counters[i] = 0;
    return this.counters.slice(0, level).join(".");
  }

  reset(): void {
    this.counters.fill(0);
  }
}

/** 批量计算一组标题层级的序号（便于测试与复用） */
export function computeHeadingNumbers(
  levels: number[],
  maxLevel: number = MAX_HEADING_LEVEL,
): (string | null)[] {
  const numberer = new HeadingNumberer(maxLevel);
  return levels.map((level) => numberer.next(level));
}
