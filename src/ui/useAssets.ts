import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Asset, AssetMap, FontAsset, ImageAsset } from "../core/assets";
import {
  arrayBufferToDataUrl,
  fontFormatFromFilename,
  fontMime,
  isFontAsset,
  isImageAsset,
  newAssetId,
} from "../core/assets";
import { parseFontMeta } from "../core/fontMeta";
import {
  assetsArePersistent,
  clearAssets,
  deleteAsset,
  loadAssets,
  saveAsset,
} from "../core/assetStore";
import { readDataUrl } from "../core/download";

/** 单文件体量上限，避免一次性占用过多内存 / IndexedDB 配额 */
export const MAX_FONT_BYTES = 32 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 24 * 1024 * 1024;

export interface ImportReport<T extends Asset = Asset> {
  added: T[];
  errors: string[];
}

function measureImage(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = src;
  });
}

export interface UseAssetsResult {
  fonts: FontAsset[];
  images: ImageAsset[];
  map: AssetMap;
  ready: boolean;
  persistent: boolean;
  addFonts: (files: File[]) => Promise<ImportReport<FontAsset>>;
  addImages: (files: File[]) => Promise<ImportReport<ImageAsset>>;
  remove: (id: string) => Promise<void>;
  updateFont: (id: string, patch: Partial<FontAsset>) => void;
  /** 用文档文件里的图片替换当前文档的全部图片 */
  replaceImages: (images: ImageAsset[]) => Promise<void>;
  clearFonts: () => Promise<void>;
  clearImages: () => Promise<void>;
  clearAll: () => Promise<void>;
}

/** 管理用户导入的字体 / 图片：内存态 + IndexedDB 持久化 */
export function useAssets(): UseAssetsResult {
  const [fonts, setFonts] = useState<FontAsset[]>([]);
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [ready, setReady] = useState(false);
  const [persistent, setPersistent] = useState(true);
  /** 字体元信息（族名等）可在面板里逐字编辑；二进制可能很大，写入做防抖 */
  const saveTimers = useRef(new Map<string, number>());
  const fontsRef = useRef<FontAsset[]>([]);
  const imagesRef = useRef<ImageAsset[]>([]);

  useEffect(() => {
    fontsRef.current = fonts;
  }, [fonts]);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    let alive = true;
    void loadAssets().then((list) => {
      if (!alive) return;
      setFonts(list.filter(isFontAsset));
      setImages(list.filter(isImageAsset));
      setPersistent(assetsArePersistent());
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const map = useMemo<AssetMap>(() => {
    const m: AssetMap = {};
    for (const f of fonts) m[f.id] = f;
    for (const i of images) m[i.id] = i;
    return m;
  }, [fonts, images]);

  const addFonts = useCallback(async (files: File[]): Promise<ImportReport<FontAsset>> => {
    const added: FontAsset[] = [];
    const errors: string[] = [];
    for (const file of files) {
      try {
        if (file.size > MAX_FONT_BYTES) {
          errors.push(`${file.name}：文件过大（上限 ${Math.round(MAX_FONT_BYTES / 1024 / 1024)} MB）`);
          continue;
        }
        const buffer = await file.arrayBuffer();
        const meta = await parseFontMeta(buffer, file.name);
        const format = fontFormatFromFilename(file.name);
        const mime = fontMime(format);
        const asset: FontAsset = {
          id: newAssetId(),
          kind: "font",
          name: file.name,
          family: meta.family,
          weight: meta.weight,
          style: meta.style,
          format,
          mime,
          size: file.size,
          dataUrl: arrayBufferToDataUrl(buffer, mime),
          createdAt: Date.now(),
        };
        await saveAsset(asset);
        added.push(asset);
      } catch (err) {
        errors.push(`${file.name}：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (added.length) setFonts((prev) => [...prev, ...added]);
    return { added, errors };
  }, []);

  const addImages = useCallback(async (files: File[]): Promise<ImportReport<ImageAsset>> => {
    const added: ImageAsset[] = [];
    const errors: string[] = [];
    for (const file of files) {
      try {
        if (!file.type.startsWith("image/")) {
          errors.push(`${file.name}：不是图片文件`);
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          errors.push(`${file.name}：文件过大（上限 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB）`);
          continue;
        }
        const dataUrl = await readDataUrl(file);
        const dim = await measureImage(dataUrl);
        const asset: ImageAsset = {
          id: newAssetId(),
          kind: "image",
          name: file.name.replace(/\.[^.]+$/, ""),
          filename: file.name,
          mime: file.type || "image/png",
          size: file.size,
          width: dim.width,
          height: dim.height,
          dataUrl,
          createdAt: Date.now(),
        };
        await saveAsset(asset);
        added.push(asset);
      } catch (err) {
        errors.push(`${file.name}：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (added.length) setImages((prev) => [...prev, ...added]);
    return { added, errors };
  }, []);

  const remove = useCallback(async (id: string): Promise<void> => {
    const timer = saveTimers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      saveTimers.current.delete(id);
    }
    await deleteAsset(id);
    setFonts((prev) => prev.filter((f) => f.id !== id));
    setImages((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const updateFont = useCallback(
    (id: string, patch: Partial<FontAsset>): void => {
      const current = fonts.find((f) => f.id === id);
      if (!current) return;
      const next: FontAsset = { ...current, ...patch, id, kind: "font" };
      setFonts((prev) => prev.map((f) => (f.id === id ? next : f)));

      const timers = saveTimers.current;
      const existing = timers.get(id);
      if (existing) window.clearTimeout(existing);
      timers.set(
        id,
        window.setTimeout(() => {
          timers.delete(id);
          void saveAsset(next);
        }, 400),
      );
    },
    [fonts],
  );

  const replaceImages = useCallback(async (next: ImageAsset[]): Promise<void> => {
    const previous = imagesRef.current;
    await Promise.all(previous.map((img) => deleteAsset(img.id)));
    for (const img of next) await saveAsset(img);
    setImages(next);
  }, []);

  const clearFonts = useCallback(async (): Promise<void> => {
    for (const timer of saveTimers.current.values()) window.clearTimeout(timer);
    saveTimers.current.clear();
    await Promise.all(fontsRef.current.map((f) => deleteAsset(f.id)));
    setFonts([]);
  }, []);

  const clearImages = useCallback(async (): Promise<void> => {
    await Promise.all(imagesRef.current.map((img) => deleteAsset(img.id)));
    setImages([]);
  }, []);

  const clearAll = useCallback(async (): Promise<void> => {
    for (const timer of saveTimers.current.values()) window.clearTimeout(timer);
    saveTimers.current.clear();
    await clearAssets();
    setFonts([]);
    setImages([]);
  }, []);

  return {
    fonts,
    images,
    map,
    ready,
    persistent,
    addFonts,
    addImages,
    remove,
    updateFont,
    replaceImages,
    clearFonts,
    clearImages,
    clearAll,
  };
}
