/**
 * 用户自定义主题：在设置面板里一键把当前 token 存成新主题，
 * 与内置预设并列显示。主题只包含 token（不含字体二进制），因此存 localStorage 足够。
 */

import type { ThemeTokens } from "./types";

export interface UserTheme {
  id: string;
  name: string;
  description?: string;
  tokens: ThemeTokens;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "md-studio:user-themes:v1";

/** 预设 id 前缀，用于区分内置预设与自定义主题，避免 id 冲突 */
export const USER_THEME_PREFIX = "user:";

export function isUserThemeId(presetId: string): boolean {
  return presetId.startsWith(USER_THEME_PREFIX);
}

export function toUserThemeId(id: string): string {
  return `${USER_THEME_PREFIX}${id}`;
}

export function fromUserThemeId(presetId: string): string {
  return isUserThemeId(presetId) ? presetId.slice(USER_THEME_PREFIX.length) : presetId;
}

export function newUserThemeId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function isUserTheme(value: unknown): value is UserTheme {
  if (!value || typeof value !== "object") return false;
  const t = value as Partial<UserTheme>;
  return typeof t.id === "string" && typeof t.name === "string" && !!t.tokens && typeof t.tokens === "object";
}

export function loadUserThemes(): UserTheme[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(isUserTheme);
  } catch {
    return [];
  }
}

export function saveUserThemes(themes: UserTheme[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(themes));
  } catch {
    /* 配额溢出时静默忽略（token 体积很小，几乎不会发生） */
  }
}
