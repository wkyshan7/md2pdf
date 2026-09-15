/**
 * 从字体二进制中读取名称信息（族名 / 字重 / 斜体）。
 *
 * 支持 TrueType（.ttf）、OpenType/CFF（.otf）与 WOFF（.woff，zlib 解压后读 name 表）。
 * WOFF2 使用 Brotli，浏览器未提供原生解压接口，故退回文件名推断；
 * TTC（字体集合）取第一个字体。
 *
 * 解析失败不会抛错，始终能返回一个可用的回退值，用户也可以在面板里手动修改。
 */

import type { FontStyle } from "./assets";
import { stripExtension } from "./assets";

export interface FontMeta {
  family: string;
  /** 用于展示的样式名，例如 Regular / Bold Italic */
  subfamily: string;
  weight: number;
  style: FontStyle;
}

const SFNT_VERSIONS = new Set(["OTTO", "true", "typ1", "ttcf"]);

function readTag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

interface TableRecord {
  offset: number;
  length: number;
}

/** sfnt 顶层表目录：tag → 偏移/长度 */
function readTableDirectory(view: DataView, base: number): Map<string, TableRecord> {
  const map = new Map<string, TableRecord>();
  const numTables = view.getUint16(base + 4);
  for (let i = 0; i < numTables; i++) {
    const rec = base + 12 + i * 16;
    if (rec + 16 > view.byteLength) break;
    const tag = readTag(view, rec);
    map.set(tag, { offset: view.getUint32(rec + 8), length: view.getUint32(rec + 12) });
  }
  return map;
}

interface NameTable {
  [nameId: number]: string | undefined;
}

/** 解析 name 表，返回按优先级挑选后的各 nameID 文本 */
function readNameTable(view: DataView, tableOffset: number): NameTable {
  const out: NameTable = {};
  const scores: Record<number, number> = {};
  const count = view.getUint16(tableOffset + 2);
  const stringOffset = view.getUint16(tableOffset + 4);

  for (let i = 0; i < count; i++) {
    const rec = tableOffset + 6 + i * 12;
    if (rec + 12 > view.byteLength) break;
    const platform = view.getUint16(rec);
    const encoding = view.getUint16(rec + 2);
    const language = view.getUint16(rec + 4);
    const nameId = view.getUint16(rec + 6);
    const length = view.getUint16(rec + 8);
    const offset = view.getUint16(rec + 10);

    if (nameId !== 1 && nameId !== 2 && nameId !== 4 && nameId !== 16 && nameId !== 17) continue;

    const start = tableOffset + stringOffset + offset;
    if (start < 0 || start + length > view.byteLength) continue;

    let text = "";
    try {
      if (platform === 3 || platform === 0) {
        for (let j = 0; j + 1 < length; j += 2) {
          text += String.fromCharCode(view.getUint16(start + j));
        }
      } else {
        for (let j = 0; j < length; j++) text += String.fromCharCode(view.getUint8(start + j));
      }
    } catch {
      continue;
    }

    text = text.replace(/\u0000/g, "").trim();
    if (!text) continue;

    // 优先 Unicode / Windows + 英文
    let score = 0;
    if (platform === 3) score += 6;
    else if (platform === 0) score += 5;
    if (language === 0x0409) score += 3;
    else if (language === 0) score += 1;
    if (encoding === 1 || encoding === 10) score += 1;

    if (scores[nameId] === undefined || score > scores[nameId]) {
      scores[nameId] = score;
      out[nameId] = text;
    }
  }
  return out;
}

const WEIGHT_PATTERNS: [RegExp, number][] = [
  [/\b(hairline|thin)\b|\bthin\b/i, 100],
  [/\b(extra|ultra)[\s-]?light\b/i, 200],
  [/\blight\b/i, 300],
  [/\b(regular|normal|book|roman)\b/i, 400],
  [/\bmedium\b|\bdemi\b/i, 500],
  [/\b(semi|demi)[\s-]?bold\b/i, 600],
  [/\b(extra|ultra)[\s-]?bold\b/i, 800],
  [/\b(black|heavy)\b/i, 900],
  [/\bbold\b/i, 700],
];

function weightFromText(text: string): number | null {
  for (const [re, weight] of WEIGHT_PATTERNS) {
    if (re.test(text)) return weight;
  }
  return null;
}

function styleFromText(text: string): FontStyle | null {
  if (/\bitalic\b/i.test(text)) return "italic";
  if (/\boblique\b/i.test(text)) return "oblique";
  if (/\b(regular|normal|roman)\b/i.test(text)) return "normal";
  return null;
}

function metaFromNames(names: NameTable, filename: string): FontMeta {
  const family =
    names[16] || names[1] || filenameFallbackFamily(filename);
  const subfamily = names[17] || names[2] || (names[4] ?? "").replace(family, "").trim();
  const style = styleFromText(subfamily) ?? styleFromText(names[4] ?? "") ?? "normal";
  const weight = weightFromText(subfamily) ?? weightFromText(names[4] ?? "") ?? 400;
  return {
    family,
    subfamily: subfamily || "Regular",
    weight,
    style,
  };
}

function filenameFallbackFamily(filename: string): string {
  const base = stripExtension(filename)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return base || "Imported Font";
}

function fallbackMeta(filename: string): FontMeta {
  const base = stripExtension(filename);
  const weight = weightFromText(base) ?? 400;
  const style = styleFromText(base) ?? "normal";
  return {
    family: filenameFallbackFamily(filename),
    subfamily: base.replace(/-/g, " ").trim() || "Regular",
    weight,
    style,
  };
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

async function readWoffName(view: DataView, filename: string): Promise<FontMeta | null> {
  const numTables = view.getUint16(12);
  for (let i = 0; i < numTables; i++) {
    const rec = 44 + i * 20;
    if (rec + 20 > view.byteLength) break;
    if (readTag(view, rec) !== "name") continue;
    const offset = view.getUint32(rec + 4);
    const compLength = view.getUint32(rec + 8);
    const origLength = view.getUint32(rec + 12);
    if (offset + compLength > view.byteLength) break;
    const raw = new Uint8Array(view.buffer, view.byteOffset + offset, compLength);
    try {
      const data = compLength === origLength ? raw : await inflate(raw);
      const nameView = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const names = readNameTable(nameView, 0);
      return metaFromNames(names, filename);
    } catch {
      return null;
    }
  }
  return null;
}

function readOs2(view: DataView, tables: Map<string, TableRecord>): { weight?: number; italic?: boolean } {
  const rec = tables.get("OS/2");
  if (!rec || rec.offset + 8 > view.byteLength) return {};
  const out: { weight?: number; italic?: boolean } = {};
  try {
    const weight = view.getUint16(rec.offset + 4);
    if (weight >= 100 && weight <= 900) out.weight = weight;
    const fsSelection = view.getUint16(rec.offset + 62);
    if (fsSelection & 0x01) out.italic = true;
  } catch {
    /* 表太短则忽略 */
  }
  return out;
}

function readHeadItalic(view: DataView, tables: Map<string, TableRecord>): boolean {
  const rec = tables.get("head");
  if (!rec || rec.offset + 46 > view.byteLength) return false;
  try {
    return (view.getUint16(rec.offset + 44) & 0x02) !== 0;
  } catch {
    return false;
  }
}

/** 解析字体元信息（族名 / 字重 / 斜体），失败时回退到文件名推断 */
export async function parseFontMeta(buffer: ArrayBuffer, filename: string): Promise<FontMeta> {
  const fallback = fallbackMeta(filename);
  try {
    const view = new DataView(buffer);
    const magic = readTag(view, 0);

    if (magic === "wOFF") {
      return (await readWoffName(view, filename)) ?? fallback;
    }

    let base = 0;
    if (magic === "ttcf") {
      if (view.byteLength < 16) return fallback;
      base = view.getUint32(12);
      const inner = readTag(view, base);
      if (inner !== "OTTO" && inner !== "true" && inner !== "typ1" && view.getUint32(base) !== 0x00010000) {
        return fallback;
      }
    } else if (!SFNT_VERSIONS.has(magic) && view.getUint32(0) !== 0x00010000) {
      return fallback;
    }

    const tables = readTableDirectory(view, base);
    const nameRec = tables.get("name");
    if (!nameRec) return fallback;

    const names = readNameTable(view, nameRec.offset);
    const meta = metaFromNames(names, filename);

    const os2 = readOs2(view, tables);
    if (os2.weight) meta.weight = os2.weight;
    if (os2.italic) meta.style = "italic";
    else if (readHeadItalic(view, tables)) meta.style = "italic";

    return meta;
  } catch {
    return fallback;
  }
}
