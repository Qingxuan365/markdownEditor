import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./index";

describe("parseMarkdown", () => {
  it("提取标题和图片资源", () => {
    const result = parseMarkdown("# 标题\n\n![图](./assets/a.png)");
    expect(result.html).toContain('id="标题"');
    expect(result.headings).toEqual([{ level: 1, text: "标题", id: "标题" }]);
    expect(result.resources).toEqual(["./assets/a.png"]);
  });

  it("渲染块级数学公式", () => {
    const result = parseMarkdown("$$\nE = mc^2\n$$");
    expect(result.html).toContain("katex-display");
    expect(result.html).toContain("mord");
  });

  it("渲染化学方程式与物理单位", () => {
    const result = parseMarkdown(
      "$$\n\\ce{2H2 + O2 -> 2H2O}\n$$\n\n$\\pu{9.8 m s^-2}$"
    );
    expect(result.html).toContain("katex-display");
    expect(result.html).toContain("H");
    expect(result.html).toContain("9.8");
    expect(result.html).not.toContain("ParseError");
  });

  it("渲染块级对齐容器", () => {
    const result = parseMarkdown(":::align center\n## 居中标题\n\n居中正文\n:::");
    expect(result.html).toContain('class="qx-align-center"');
    expect(result.html).toContain("居中正文");
  });

  it("安全渲染居中的 HTML 图片且不把地址识别为链接", () => {
    const result = parseMarkdown(
      '<center><img src="https://cdn.example.com/qrcode.png" alt="qr code" style="width: 100px;"></center>'
    );
    expect(result.html).toContain('<section style="text-align:center">');
    expect(result.html).toContain('src="https://cdn.example.com/qrcode.png"');
    expect(result.html).toContain("width:100px");
    expect(result.html).not.toContain("&lt;center&gt;");
    expect(result.html).not.toContain("<a href=");
    expect(result.resources).toContain("https://cdn.example.com/qrcode.png");
  });

  it("不会渲染危险协议的 HTML 图片", () => {
    const result = parseMarkdown('<img src="javascript:alert(1)" alt="危险">');
    expect(result.html).not.toContain("<img");
    expect(result.html).not.toContain('src="javascript:');
  });

  it("识别 Mermaid 代码块并保留安全图表源码", () => {
    const result = parseMarkdown(
      ["```mermaid", "flowchart TD", "A[开始] --> B[结束]", "```"].join("\n")
    );
    expect(result.html).toContain('class="qx-mermaid"');
    expect(result.html).toContain('class="qx-mermaid-source"');
    expect(result.html).toContain("A[开始] --&gt; B[结束]");
    expect(result.html).not.toContain("language-mermaid");
  });

  it("兼容标准 LaTeX 行内和块级分隔符", () => {
    const result = parseMarkdown(
      "行内公式：\\(a^2+b^2=c^2\\)\n\n\\[\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}\\]"
    );
    expect(result.html).toContain("katex-display");
    expect(result.html).toContain("katex");
    expect(result.html).not.toContain("\\[");
    expect(result.html).not.toContain("\\(");
    expect(result.html).toContain("∞");
  });

  it("支持 aligned 多行公式和列表中的复杂公式", () => {
    const result = parseMarkdown(
      [
        "$$",
        "\\begin{aligned}",
        "d_{i,j} &\\leftarrow d_{i,j}+1 \\\\",
        "d_{i,j+1} &\\leftarrow d_{i,j+1}-1",
        "\\end{aligned}",
        "$$",
        "",
        "1. 列表内公式",
        "",
        "   $$",
        "   \\chi^2 = \\sum \\frac{(O-E)^2}{E}",
        "   $$"
      ].join("\n")
    );
    expect(result.html).toContain("mtable");
    expect(result.html).toContain("<ol>");
    expect(result.html.match(/katex-display/g)?.length).toBeGreaterThanOrEqual(2);
    expect(result.html).toContain("χ");
  });

  it("反引号中的公式分隔符保持代码展示", () => {
    const result = parseMarkdown(
      "使用 `\\(...\\)` 表示行内公式，使用 `\\[...\\]` 表示块级公式。"
    );
    expect(result.html).toContain("<code>\\(...\\)</code>");
    expect(result.html).toContain("<code>\\[...\\]</code>");
    expect(result.html).not.toContain("katex-display");
  });

  it("生成目录并渲染上标和下标", () => {
    const result = parseMarkdown(
      ["[TOC]", "", "# 第一章", "", "面积 m{{sup}}2{{/sup}}，化学式 H{{sub}}2{{/sub}}O。"].join("\n")
    );
    expect(result.html).toContain('href="#%E7%AC%AC%E4%B8%80%E7%AB%A0"');
    expect(result.html).toContain("<sup>2</sup>");
    expect(result.html).toContain("<sub>2</sub>");
  });
});
