import { describe, expect, it } from "vitest";
import { renderForWechat, sanitizeWechatHtml } from "./index";
import { getThemeById } from "@qingxian/theme-engine";

describe("renderForWechat", () => {
  it("为节点应用内联样式", () => {
    const result = renderForWechat("# 标题");
    expect(result.wechatHtml).toMatch(/<h1[^>]+style=/);
  });

  it("诊断非 HTTPS 图片", () => {
    const result = renderForWechat("![图](http://example.com/a.png)");
    expect(result.diagnostics[0]?.code).toBe("REMOTE_IMAGE_NOT_HTTPS");
  });

  it("提示 HTTPS 图片仍依赖网络", () => {
    const result = renderForWechat("![图](https://example.com/a.png)");
    expect(result.diagnostics.map((item) => item.code)).toContain("REMOTE_IMAGE_REQUIRES_NETWORK");
  });

  it("HTML 图片不会被转换成文末链接引用", () => {
    const result = renderForWechat(
      '<center><img src="https://cdn.example.com/qrcode.png" alt="qr code" style="width:100px"></center>',
      undefined,
      { linkMode: "footnote", imageCaption: "none" }
    );
    expect(result.previewHtml).toContain('src="https://cdn.example.com/qrcode.png"');
    expect(result.previewHtml).not.toContain("&lt;center&gt;");
    expect(result.previewHtml).not.toContain("[1]");
  });

  it("移除危险标签、事件和脚本链接", () => {
    const result = sanitizeWechatHtml(
      '<section onclick="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">危险</a></section>'
    );
    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain("onclick");
    expect(result.html).not.toContain("javascript:");
    expect(result.diagnostics.map((item) => item.code)).toContain("DANGEROUS_TAG_REMOVED");
  });

  it("过滤微信不稳定 CSS 并保留安全内联样式", () => {
    const result = sanitizeWechatHtml(
      '<section style="color:#222;display:grid;position:fixed;padding:12px">正文</section>'
    );
    expect(result.html).toContain("color:#222");
    expect(result.html).toContain("padding:12px");
    expect(result.html).not.toContain("display:grid");
    expect(result.html).not.toContain("position:fixed");
    expect(result.diagnostics.some((item) => item.code === "UNSUPPORTED_CSS_REMOVED")).toBe(true);
  });

  it("诊断本地图片、宽表格、长代码和公式", () => {
    const markdown = [
      "![本地图片](./assets/a.png)",
      "",
      "| A | B | C | D | E |",
      "|---|---|---|---|---|",
      "| 1 | 2 | 3 | 4 | 5 |",
      "",
      "```text",
      "x".repeat(81),
      "```",
      "",
      "$$",
      "E = mc^2",
      "$$"
    ].join("\n");
    const result = renderForWechat(markdown);
    const codes = result.diagnostics.map((item) => item.code);
    expect(codes).toContain("LOCAL_IMAGE_UNPUBLISHED");
    expect(codes).toContain("WIDE_TABLE_MAY_OVERFLOW");
    expect(codes).toContain("LONG_CODE_LINE_MAY_OVERFLOW");
    expect(codes).toContain("FORMULA_SHOULD_BE_IMAGE");
  });

  it("色块标题保留可见文字与强制文字颜色", () => {
    const theme = getThemeById("qingxian-china-red");
    theme.nodes.h2 = {
      ...theme.nodes.h2,
      color: "#ffffff !important",
      WebkitTextFillColor: "#ffffff",
      background: "#cf300d"
    };
    const result = renderForWechat("## 可见的子标题", theme);
    expect(result.previewHtml).toContain("可见的子标题");
    expect(result.previewHtml).toContain("-webkit-text-fill-color:#ffffff");
    expect(result.wechatHtml).toContain("可见的子标题");
  });

  it("选区对齐覆盖标题原有对齐样式", () => {
    const result = renderForWechat(":::align right\n## 右对齐标题\n\n右对齐正文\n:::");
    expect(result.previewHtml).toMatch(/text-align:right\s*!important/);
    expect(result.wechatHtml).toMatch(/text-align:right\s*!important/);
  });

  it("胶囊小标题通过自动外边距水平居中", () => {
    const theme = getThemeById("qingxian-china-red");
    theme.nodes.h2 = {
      ...theme.nodes.h2,
      display: "table",
      marginLeft: "auto",
      marginRight: "auto",
      textAlign: "center"
    };
    const result = renderForWechat("## 居中的小标题", theme);
    expect(result.previewHtml).toContain("display:table");
    expect(result.previewHtml).toContain("margin-left:auto");
    expect(result.previewHtml).toContain("margin-right:auto");
  });

  it("二级标题使用表格宽度和自动外边距可靠居中", () => {
    const theme = getThemeById("qingxian-tech-blue");
    theme.nodes.h2 = {
      ...theme.nodes.h2,
      display: "table",
      width: "auto",
      textAlign: "center",
      marginLeft: "auto",
      marginRight: "auto"
    };
    const result = renderForWechat("## 居中的二级标题", theme);
    expect(result.previewHtml).toContain("display:table");
    expect(result.previewHtml).toContain("width:auto");
    expect(result.previewHtml).toContain("text-align:center");
    expect(result.previewHtml).toContain("margin-left:auto");
    expect(result.previewHtml).toContain("margin-right:auto");
    expect(result.wechatHtml).toContain("margin-left:auto");
  });

  it("居中二级标题使用主题色背景和白色文字", () => {
    const theme = getThemeById("qingxian-tech-blue");
    theme.nodes.h2 = {
      ...theme.nodes.h2,
      display: "table",
      width: "auto",
      color: "#ffffff !important",
      WebkitTextFillColor: "#ffffff",
      background: theme.tokens.primaryColor,
      backgroundColor: theme.tokens.primaryColor,
      textAlign: "center",
      marginLeft: "auto",
      marginRight: "auto"
    };
    const result = renderForWechat("## 主题色二级标题", theme);
    expect(result.previewHtml).toContain(`background:${theme.tokens.primaryColor}`);
    expect(result.previewHtml).toContain("-webkit-text-fill-color:#ffffff");
    expect(result.wechatHtml).toContain(`background:${theme.tokens.primaryColor}`);
  });

  it("字体设置直接应用到正文和标题节点", () => {
    const theme = getThemeById("qingxian-tech-blue");
    theme.nodes = {
      ...theme.nodes,
      section: { fontFamily: "'NSimSun','新宋体',monospace" },
      p: { fontFamily: "'NSimSun','新宋体',monospace" },
      h2: {
        ...theme.nodes.h2,
        fontFamily: "'NSimSun','新宋体',monospace"
      }
    };
    const result = renderForWechat("## 标题\n\n正文", theme);
    expect(result.previewHtml).toContain("font-family:'NSimSun','新宋体',monospace");
    expect(result.wechatHtml).toContain("font-family:'NSimSun','新宋体',monospace");
  });

  it("支持 12 种代码块主题并应用对应配色", () => {
    const themes = {
      "github-light": "#f6f8fa",
      "github-dark": "#0d1117",
      "atom-dark": "#282c34",
      dracula: "#282a36",
      monokai: "#272822",
      nord: "#2e3440",
      "solarized-light": "#fdf6e3",
      "solarized-dark": "#002b36",
      "one-dark": "#282c34",
      "material-dark": "#263238",
      "vscode-dark": "#1e1e1e",
      "tomorrow-night": "#1d1f21"
    } as const;
    for (const [codeTheme, background] of Object.entries(themes)) {
      const result = renderForWechat("```ts\nconst value = 1;\n```", undefined, {
        linkMode: "keep",
        codeTheme: codeTheme as keyof typeof themes
      });
      expect(result.previewHtml).toContain(`background:${background}`);
      expect(result.wechatHtml).toContain(`background:${background}`);
    }
  });

  it("正文 p 标签字体样式不会误匹配 pre 代码块", () => {
    const theme = getThemeById("qingxian-tech-blue");
    theme.nodes = {
      ...theme.nodes,
      p: { fontFamily: "'Microsoft YaHei',sans-serif" }
    };
    const result = renderForWechat("```ts\nconst value = 1;\n```", theme, {
      linkMode: "keep",
      codeTheme: "dracula"
    });
    expect(result.previewHtml).toContain("background:#282a36");
    expect(result.previewHtml).not.toContain("<pre style=\"font-family:");
  });

  it("长代码和中文提示词自动换行且行号列保持固定", () => {
    const result = renderForWechat(
      `\`\`\`text\n${"这是一段很长的中文提示词".repeat(20)}\n\`\`\``,
      undefined,
      { linkMode: "keep", codeTheme: "github-dark", codeLineNumbers: true }
    );
    expect(result.previewHtml).toContain("white-space:pre-wrap");
    expect(result.previewHtml).toContain("word-break:break-all");
    expect(result.previewHtml).toContain("overflow-wrap:anywhere");
    expect(result.previewHtml).toContain("display:table-cell;width:28px");
    expect(result.previewHtml).toContain("overflow-x:hidden");
    expect(result.wechatHtml).toContain("white-space:pre-wrap");
  });
});
