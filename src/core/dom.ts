/** 通用 DOM / 单位工具 */

export const MM_TO_PX = 96 / 25.4;

export function mmToPx(mm: number): number {
  return mm * MM_TO_PX;
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** 等待字体与图片就绪，避免导出时缺字/缺图 */
export async function waitForAssets(root: ParentNode = document): Promise<void> {
  try {
    if (document.fonts?.ready) await document.fonts.ready;
  } catch {
    /* 忽略字体等待失败 */
  }
  const images = Array.from(root.querySelectorAll?.("img") ?? []);
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
  await nextFrame();
}
