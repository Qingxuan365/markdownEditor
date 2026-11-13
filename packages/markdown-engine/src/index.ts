import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdownLanguage from "highlight.js/lib/languages/markdown";
import typescript from "highlight.js/lib/languages/typescript";
import katex from "katex";
import "katex/contrib/mhchem";
import MarkdownIt from "markdown-it";
// @ts-expect-error 该插件未发布 TypeScript 声明。
import markdownItContainer from "markdown-it-container";
// @ts-expect-error 该插件未发布 TypeScript 声明。
import footnote from "markdown-it-footnote";
// @ts-expect-error 该插件未发布 TypeScript 声明。
import taskLists from "markdown-it-task-lists";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdownLanguage);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);

function renderMath(formula: string, displayMode: boolean) {
  return katex.renderToString(formula, {
    displayMode,
    throwOnError: false,
    errorColor: "#dc2626",
    output: "htmlAndMathml",
    strict: "ignore"
  });
}

function currentKatexPlugin(parser: MarkdownIt) {
  parser.inline.ruler.before("escape", "math_inline", (state: any, silent: boolean) => {
    if (state.src[state.pos] !== "$" || state.src[state.pos + 1] === "$") return false;
    let end = state.pos + 1;
    while ((end = state.src.indexOf("$", end)) >= 0) {
      if (state.src[end - 1] !== "\\") break;
      end += 1;
    }
    if (end < 0) return false;
    const formula = state.src.slice(state.pos + 1, end);
    if (!formula.trim()) return false;
    if (!silent) {
      const token = state.push("math_inline", "math", 0);
      token.content = formula;
    }
    state.pos = end + 1;
    return true;
  });

  parser.block.ruler.before(
    "fence",
    "math_block",
    (state: any, startLine: number, endLine: number, silent: boolean) => {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      const firstLine = state.src.slice(start, max).trim();
      if (!firstLine.startsWith("$$")) return false;

      let formula = firstLine.slice(2);
      let nextLine = startLine;
      if (formula.endsWith("$$") && formula.length > 2) {
        formula = formula.slice(0, -2);
      } else {
        const lines: string[] = [formula];
        let found = false;
        for (nextLine = startLine + 1; nextLine < endLine; nextLine += 1) {
          const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
          const line = state.src.slice(lineStart, state.eMarks[nextLine]);
          if (line.trimEnd().endsWith("$$")) {
            lines.push(line.replace(/\$\$\s*$/, ""));
            found = true;
            break;
          }
          lines.push(line);
        }
        if (!found) return false;
        formula = lines.join("\n");
      }

      if (silent) return true;
      state.line = nextLine + 1;
      const token = state.push("math_block", "math", 0);
      token.block = true;
      token.content = formula.trim();
      token.map = [startLine, state.line];
      return true;
    },
    { alt: ["paragraph", "reference", "blockquote", "list"] }
  );

  parser.renderer.rules.math_inline = (tokens, index) =>
    renderMath(tokens[index].content, false);
  parser.renderer.rules.math_block = (tokens, index) =>
    `${renderMath(tokens[index].content, true)}\n`;
}

export type MarkdownDocument = {
  html: string;
  headings: Array<{ level: number; text: string; id: string }>;
  resources: string[];
};

type RawImage = {
  placeholder: string;
  html: string;
  source: string;
};

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function readHtmlAttribute(attributes: string, name: string) {
  const match = attributes.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:["“]([^"”]*)["”]|['‘]([^'’]*)['’]|([^\\s>]+))`, "i")
  );
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function normalizeRawImages(markdown: string) {
  const images: RawImage[] = [];
  const replaceImage = (original: string, attributes: string, centered: boolean) => {
    const source = readHtmlAttribute(attributes, "src").trim();
    const safeSource =
      /^(?:https?:\/\/|data:image\/(?:png|gif|jpe?g|webp|svg\+xml);|asset:|\.{0,2}[\\/]|[a-z]:[\\/]|\\\\)/i;
    if (!source || !safeSource.test(source)) return original;

    const alt = readHtmlAttribute(attributes, "alt");
    const title = readHtmlAttribute(attributes, "title");
    const widthAttribute = readHtmlAttribute(attributes, "width");
    const styleAttribute = readHtmlAttribute(attributes, "style");
    const styleWidth = styleAttribute.match(/\bwidth\s*:\s*(\d+(?:\.\d+)?(?:px|%|em|rem))/i)?.[1];
    const width = /^(?:\d+(?:\.\d+)?(?:px|%|em|rem)|\d+)$/.test(widthAttribute)
      ? widthAttribute
      : styleWidth ?? "";
    const widthStyle = width
      ? `width:${/^\d+$/.test(width) ? `${width}px` : width};`
      : "";
    const image = `<img src="${escapeAttribute(source)}" alt="${escapeAttribute(alt)}"${title ? ` title="${escapeAttribute(title)}"` : ""} style="${widthStyle}max-width:100%;height:auto">`;
    const html = centered
      ? `<section style="text-align:center">${image}</section>`
      : image;
    const placeholder = `QXRAWIMAGE${images.length}TOKEN`;
    images.push({ placeholder, html, source });
    return `\n\n${placeholder}\n\n`;
  };

  const normalized = markdown
    .replace(
      /<center\b[^>]*>\s*<img\b([^>]*)\/?>\s*<\/center>/gi,
      (match, attributes: string) => replaceImage(match, attributes, true)
    )
    .replace(
      /<img\b([^>]*)\/?>/gi,
      (match, attributes: string) => replaceImage(match, attributes, false)
    );

  return { markdown: normalized, images };
}

function createSlugger() {
  const slugCounts = new Map<string, number>();
  return (value: string) => {
  const base =
    value
      .trim()
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
      .replace(/\s+/g, "-") || "section";
  const count = slugCounts.get(base) ?? 0;
  slugCounts.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
  };
}

export function createMarkdownParser() {
  const escapeHtml = new MarkdownIt().utils.escapeHtml;
  const parser = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    highlight(code, language): string {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(code, { language }).value;
      }
      return escapeHtml(code);
    }
  })
    .use(markdownItContainer, "align", {
      validate: (params: string) => /^align\s+(left|center|right)$/.test(params.trim()),
      render: (tokens: Array<{ nesting: number; info: string }>, index: number) => {
        if (tokens[index].nesting === 1) {
          const alignment = tokens[index].info.trim().split(/\s+/)[1];
          return `<section class="qx-align-${alignment}">\n`;
        }
        return "</section>\n";
      }
    })
    .use(footnote)
    .use(currentKatexPlugin)
    .use(taskLists, { enabled: true, label: true });

  const defaultFenceRenderer = parser.renderer.rules.fence;
  parser.renderer.rules.fence = (tokens, index, options, environment, renderer) => {
    const token = tokens[index];
    const language = token.info.trim().split(/\s+/)[0]?.toLowerCase();
    if (language === "mermaid") {
      return `<section class="qx-mermaid"><pre class="qx-mermaid-source">${escapeHtml(token.content.trim())}</pre><div class="qx-mermaid-canvas"></div></section>\n`;
    }
    return defaultFenceRenderer
      ? defaultFenceRenderer(tokens, index, options, environment, renderer)
      : renderer.renderToken(tokens, index, options);
  };

  return parser;
}

function normalizeLatexDelimiters(markdown: string) {
  const protectedFragments: string[] = [];
  const protectedMarkdown = markdown.replace(
    /```[\s\S]*?```|`[^`\r\n]*`/g,
    (fragment) => {
      const placeholder = `QXPROTECTED${protectedFragments.length}TOKEN`;
      protectedFragments.push(fragment);
      return placeholder;
    }
  );

  const normalized = protectedMarkdown
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, formula: string) =>
      `\n$$\n${formula.trim()}\n$$\n`
    )
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, formula: string) =>
      `$${formula.trim()}$`
    );

  return normalized.replace(
    /QXPROTECTED(\d+)TOKEN/g,
    (_match, index: string) => protectedFragments[Number(index)] ?? ""
  );
}

export function parseMarkdown(markdown: string): MarkdownDocument {
  const rawImages = normalizeRawImages(markdown);
  const normalizedMarkdown = normalizeLatexDelimiters(rawImages.markdown)
    .replace(
      /^:::tip(?:\s+(.+))?\r?\n([\s\S]*?)\r?\n:::$/gm,
      (_match, title: string | undefined, body: string) =>
        `> **💡 ${title ?? "提示"}**\n>\n${body
          .split(/\r?\n/)
          .map((line) => `> ${line}`)
          .join("\n")}`
    );
  const headings: MarkdownDocument["headings"] = [];
  const slugify = createSlugger();
  const resources = [
    ...rawImages.images.map((image) => image.source),
    ...Array.from(
      normalizedMarkdown.matchAll(/!\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g),
      (match) => match[1]
    )
  ];

  for (const match of normalizedMarkdown.matchAll(/^(#{1,6})\s+(.+)$/gm)) {
    headings.push({
      level: match[1].length,
      text: match[2].replace(/\s+#+\s*$/, ""),
      id: slugify(match[2])
    });
  }

  const markdownWithToc = normalizedMarkdown.replace(
    /^\s*\[TOC\]\s*$/gim,
    headings.length > 0
      ? headings
          .map((heading) =>
            `${"  ".repeat(Math.max(0, heading.level - 1))}- [${heading.text}](#${heading.id})`
          )
          .join("\n")
      : "> 当前文档暂无标题，无法生成目录。"
  );
  let headingIndex = 0;
  let html = createMarkdownParser()
    .render(markdownWithToc)
    .replace(
      /\{\{color:(#[0-9a-fA-F]{6})\}\}([\s\S]*?)\{\{\/color\}\}/g,
      '<span style="color:$1">$2</span>'
    )
    .replace(/\{\{sup\}\}([\s\S]*?)\{\{\/sup\}\}/g, "<sup>$1</sup>")
    .replace(/\{\{sub\}\}([\s\S]*?)\{\{\/sub\}\}/g, "<sub>$1</sub>")
    .replace(/<h([1-6])>/g, (tag) => {
      const heading = headings[headingIndex++];
      return heading ? tag.replace(">", ` id="${heading.id}">`) : tag;
    });

  for (const image of rawImages.images) {
    html = html
      .replace(`<p>${image.placeholder}</p>`, image.html)
      .replace(image.placeholder, image.html);
  }

  return {
    html,
    headings,
    resources
  };
}
