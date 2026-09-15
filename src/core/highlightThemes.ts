/**
 * highlight.js 主题：`?inline` 静态导入 CSS 文本，既能注入到预览页，
 * 也能原样内联进导出的单文件 HTML。
 */
import a11yDark from "highlight.js/styles/a11y-dark.min.css?inline";
import a11yLight from "highlight.js/styles/a11y-light.min.css?inline";
import agate from "highlight.js/styles/agate.min.css?inline";
import atomOneDark from "highlight.js/styles/atom-one-dark.min.css?inline";
import atomOneLight from "highlight.js/styles/atom-one-light.min.css?inline";
import dark from "highlight.js/styles/dark.min.css?inline";
import foundation from "highlight.js/styles/foundation.min.css?inline";
import github from "highlight.js/styles/github.min.css?inline";
import githubDark from "highlight.js/styles/github-dark.min.css?inline";
import githubDarkDimmed from "highlight.js/styles/github-dark-dimmed.min.css?inline";
import idea from "highlight.js/styles/idea.min.css?inline";
import monokai from "highlight.js/styles/monokai.min.css?inline";
import nightOwl from "highlight.js/styles/night-owl.min.css?inline";
import nord from "highlight.js/styles/nord.min.css?inline";
import obsidian from "highlight.js/styles/obsidian.min.css?inline";
import pandaSyntaxDark from "highlight.js/styles/panda-syntax-dark.min.css?inline";
import rainbow from "highlight.js/styles/rainbow.min.css?inline";
import shadesOfPurple from "highlight.js/styles/shades-of-purple.min.css?inline";
import stackoverflowDark from "highlight.js/styles/stackoverflow-dark.min.css?inline";
import stackoverflowLight from "highlight.js/styles/stackoverflow-light.min.css?inline";
import tokyoNightDark from "highlight.js/styles/tokyo-night-dark.min.css?inline";
import tomorrowNightBlue from "highlight.js/styles/tomorrow-night-blue.min.css?inline";
import tomorrowNightBright from "highlight.js/styles/tomorrow-night-bright.min.css?inline";
import vs from "highlight.js/styles/vs.min.css?inline";
import vs2015 from "highlight.js/styles/vs2015.min.css?inline";
import xcode from "highlight.js/styles/xcode.min.css?inline";
import xt256 from "highlight.js/styles/xt256.min.css?inline";

export interface CodeTheme {
  id: string;
  name: string;
  css: string;
  /** 推荐配色，切换代码主题时自动写入 token，避免对比度错误 */
  bg: string;
  fg: string;
  dark: boolean;
}

export const CODE_THEMES: CodeTheme[] = [
  { id: "github", name: "GitHub Light", css: github, bg: "#f6f8fa", fg: "#24292f", dark: false },
  { id: "github-dark", name: "GitHub Dark", css: githubDark, bg: "#0d1117", fg: "#c9d1d9", dark: true },
  {
    id: "github-dark-dimmed",
    name: "GitHub Dark Dimmed",
    css: githubDarkDimmed,
    bg: "#22272e",
    fg: "#adbac7",
    dark: true,
  },
  { id: "atom-one-light", name: "Atom One Light", css: atomOneLight, bg: "#fafafa", fg: "#383a42", dark: false },
  { id: "atom-one-dark", name: "Atom One Dark", css: atomOneDark, bg: "#282c34", fg: "#abb2bf", dark: true },
  { id: "vs", name: "Visual Studio", css: vs, bg: "#ffffff", fg: "#000000", dark: false },
  { id: "vs2015", name: "VS 2015", css: vs2015, bg: "#1e1e1e", fg: "#dcdcdc", dark: true },
  { id: "idea", name: "IntelliJ IDEA", css: idea, bg: "#ffffff", fg: "#000000", dark: false },
  { id: "xcode", name: "Xcode", css: xcode, bg: "#ffffff", fg: "#000000", dark: false },
  { id: "monokai", name: "Monokai", css: monokai, bg: "#272822", fg: "#f8f8f2", dark: true },
  { id: "nord", name: "Nord", css: nord, bg: "#2e3440", fg: "#d8dee9", dark: true },
  { id: "agate", name: "Agate", css: agate, bg: "#333333", fg: "#ffffff", dark: true },
  { id: "obsidian", name: "Obsidian", css: obsidian, bg: "#282b2e", fg: "#e0e2e4", dark: true },
  { id: "night-owl", name: "Night Owl", css: nightOwl, bg: "#011627", fg: "#d6deeb", dark: true },
  { id: "tokyo-night-dark", name: "Tokyo Night", css: tokyoNightDark, bg: "#1a1b26", fg: "#9aa5ce", dark: true },
  { id: "panda-syntax-dark", name: "Panda Dark", css: pandaSyntaxDark, bg: "#2a2c2d", fg: "#e6e6e6", dark: true },
  { id: "shades-of-purple", name: "Shades of Purple", css: shadesOfPurple, bg: "#2d2b55", fg: "#ffffff", dark: true },
  { id: "xt256", name: "xt256", css: xt256, bg: "#000000", fg: "#eaeaea", dark: true },
  { id: "stackoverflow-light", name: "StackOverflow Light", css: stackoverflowLight, bg: "#ffffff", fg: "#2f3337", dark: false },
  { id: "stackoverflow-dark", name: "StackOverflow Dark", css: stackoverflowDark, bg: "#1c1b1b", fg: "#ffffff", dark: true },
  { id: "a11y-light", name: "A11y Light", css: a11yLight, bg: "#ffffff", fg: "#545454", dark: false },
  { id: "a11y-dark", name: "A11y Dark", css: a11yDark, bg: "#2b2b2b", fg: "#f8f8f2", dark: true },
  { id: "rainbow", name: "Rainbow", css: rainbow, bg: "#ffffff", fg: "#000000", dark: false },
  { id: "foundation", name: "Foundation", css: foundation, bg: "#eeeeee", fg: "#000000", dark: false },
  { id: "dark", name: "Dark", css: dark, bg: "#1e1e1e", fg: "#dcdcdc", dark: true },
  { id: "tomorrow-night-blue", name: "Tomorrow Night Blue", css: tomorrowNightBlue, bg: "#002451", fg: "#ffffff", dark: true },
  { id: "tomorrow-night-bright", name: "Tomorrow Night Bright", css: tomorrowNightBright, bg: "#000000", fg: "#eaeaea", dark: true },
];

const CODE_THEME_MAP = new Map(CODE_THEMES.map((t) => [t.id, t]));

export function getCodeTheme(id: string): CodeTheme {
  return CODE_THEME_MAP.get(id) ?? CODE_THEMES[0];
}
