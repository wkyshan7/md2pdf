export const SAMPLE_MARKDOWN = `# MD Studio 使用示例

这是一个 **Markdown 排版工作台**：左侧书写、右侧实时预览，随时切换主题并导出为
PDF / PPTX / DOCX / HTML。

> 提示：右上角切换「页面 / 阅读」模式，右侧面板可微调字体、字号、配色、页边距等细节。

## 一、基础排版

普通段落支持 **加粗**、*斜体*、~~删除线~~、\`行内代码\`、[链接](https://example.com)
以及键盘按键 <kbd>Ctrl</kbd> + <kbd>S</kbd>。

- 无序列表项
  - 嵌套子项
  - 再来一个
- 第二项

1. 有序列表
2. 第二项
3. 第三项

### 任务清单

- [x] 完成的需求
- [ ] 待办事项
- [ ] 另一个待办

## 二、代码与数学

\`\`\`typescript
interface Theme {
  id: string;
  name: string;
  tokens: Record<string, string | number>;
}

export function applyTheme(theme: Theme): void {
  for (const [key, value] of Object.entries(theme.tokens)) {
    document.documentElement.style.setProperty(\`--md-\${key}\`, String(value));
  }
}
\`\`\`

\`\`\`python
def fib(n: int) -> int:
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
\`\`\`

行内公式 $E = mc^2$，独立公式：

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

## 三、表格与引用

| 导出格式 | 依赖 | 保真度 | 适用场景 |
| --- | --- | --- | --- |
| PDF | 浏览器打印 | ★★★★★ | 论文、报告、打印 |
| PPTX | pptxgenjs | ★★★☆☆ | 演示、汇报 |
| DOCX | docx | ★★★★☆ | 二次编辑、批注 |
| HTML | 无 | ★★★★★ | 网页发布、分享 |

> 引用块适合放结论、注意事项或摘录。
> 可以包含多个段落。

---

## 四、图片

支持标准图片语法（建议使用本地图片或 data URL）：

![示意图](https://placehold.co/960x320/2563eb/ffffff?text=MD+Studio)

## 五、脚注

这里有一个脚注引用[^1]。

[^1]: 脚注内容会渲染在文档末尾。
`;

export const EMPTY_MARKDOWN = `# 新建文档

开始书写你的 Markdown 内容……
`;
