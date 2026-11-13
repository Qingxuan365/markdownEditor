import { parseMarkdown } from "@qingxian/markdown-engine";
import type {
  RenderDiagnostic,
  RenderOptions,
  RenderResult,
  ThemeDefinition
} from "@qingxian/shared-types";
import { minimalBlueTheme } from "@qingxian/theme-engine";
import { diagnoseWechatCompatibility } from "./diagnostics";
import { sanitizeWechatHtml } from "./sanitizer";

const DEFAULT_OPTIONS: RenderOptions = { linkMode: "keep" };

function styleToString(style: Record<string, string>) {
  return Object.entries(style)
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}:${value}`)
    .join(";");
}

function applyTheme(html: string, theme: ThemeDefinition) {
  let output = html;
  for (const [tag, style] of Object.entries(theme.nodes)) {
    if (tag === "section") continue;
    output = output.replace(
      new RegExp(`<${tag}(?=\\s|>)([^>]*)>`, "g"),
      `<${tag}$1 style="${styleToString(style)}">`
    );
  }
  output = output.replace(
    /<section class="qx-align-(left|center|right)">([\s\S]*?)<\/section>/g,
    (_match, alignment: string, content: string) => {
      const aligned = content.replace(
        /<(p|h[1-6]|blockquote|table)([^>]*)>/g,
        (_tag: string, tagName: string, attributes: string) => {
          if (/style="/.test(attributes)) {
            return `<${tagName}${attributes.replace(/style="([^"]*)"/, `style="$1;text-align:${alignment}!important"`)}>`;
          }
          return `<${tagName}${attributes} style="text-align:${alignment}!important">`;
        }
      );
      return `<section style="text-align:${alignment}!important">${aligned}</section>`;
    }
  );
  const sectionStyle = styleToString(theme.nodes.section ?? {});
  return `<section style="color:${theme.tokens.textColor};font-size:${theme.tokens.fontSize};line-height:${theme.tokens.lineHeight};word-break:break-word;${sectionStyle}">${output}</section>`;
}

function uniqueDiagnostics(diagnostics: RenderDiagnostic[]) {
  const seen = new Set<string>();
  return diagnostics.filter((item) => {
    const key = `${item.code}|${item.source ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applyContentOptions(html: string, options: RenderOptions) {
  let output = html;
  const codePalettes = {
    "github-light": { background: "#f6f8fa", color: "#24292f", border: "#d0d7de" },
    "github-dark": { background: "#0d1117", color: "#e6edf3", border: "#30363d" },
    "atom-dark": { background: "#282c34", color: "#abb2bf", border: "#3e4451" },
    dracula: { background: "#282a36", color: "#f8f8f2", border: "#44475a" },
    monokai: { background: "#272822", color: "#f8f8f2", border: "#49483e" },
    nord: { background: "#2e3440", color: "#d8dee9", border: "#4c566a" },
    "solarized-light": { background: "#fdf6e3", color: "#586e75", border: "#eee8d5" },
    "solarized-dark": { background: "#002b36", color: "#93a1a1", border: "#073642" },
    "one-dark": { background: "#282c34", color: "#abb2bf", border: "#3b4048" },
    "material-dark": { background: "#263238", color: "#eeffff", border: "#37474f" },
    "vscode-dark": { background: "#1e1e1e", color: "#d4d4d4", border: "#3c3c3c" },
    "tomorrow-night": { background: "#1d1f21", color: "#c5c8c6", border: "#373b41" }
  } satisfies Record<NonNullable<RenderOptions["codeTheme"]>, {
    background: string;
    color: string;
    border: string;
  }>;
  const codePalette = codePalettes[options.codeTheme ?? "github-dark"];

  output = output.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g, (_match, attrs, code) => {
    const numbered = options.codeLineNumbers
      ? code
          .split("\n")
          .map((line: string, index: number) =>
            `<span style="display:table;width:100%"><span style="display:table-cell;width:28px;padding-right:12px;color:#8b949e;text-align:right;vertical-align:top;white-space:nowrap">${index + 1}</span><span style="display:table-cell;word-break:break-all;overflow-wrap:anywhere;white-space:pre-wrap">${line || " "}</span></span>`
          )
          .join("")
      : code;
    const macHeader = options.macCodeBlock
      ? '<span style="display:block;margin-bottom:10px;color:#ff5f57;letter-spacing:5px">● <span style="color:#febc2e">●</span> <span style="color:#28c840">●</span></span>'
      : "";
    return `<pre style="max-width:100%;overflow-x:hidden;padding:14px;border:1px solid ${codePalette.border};border-radius:8px;background:${codePalette.background};color:${codePalette.color};white-space:pre-wrap;word-break:break-all;overflow-wrap:anywhere;box-sizing:border-box"><code${attrs} style="display:block;max-width:100%;white-space:pre-wrap;word-break:break-all;overflow-wrap:anywhere">${macHeader}${numbered}</code></pre>`;
  });

  if (options.paragraphIndent || options.textJustify) {
    const paragraphStyle = [
      options.paragraphIndent ? "text-indent:2em" : "",
      options.textJustify ? "text-align:justify" : ""
    ].filter(Boolean).join(";");
    output = output.replace(/<p(?![^>]*style=)([^>]*)>/g, `<p$1 style="${paragraphStyle}">`);
    output = output.replace(/<p([^>]*?)style="([^"]*)"/g, `<p$1 style="$2;${paragraphStyle}"`);
  }

  if (options.imageCaption && options.imageCaption !== "none") {
    output = output.replace(
      /<img([^>]*?)src="([^"]+)"([^>]*?)alt="([^"]*)"([^>]*?)(?:title="([^"]*)")?([^>]*)>/g,
      (_match, before, src, middle, alt, after, title = "", tail) => {
        const filename = src.split(/[\\/]/).pop()?.split("?")[0] ?? "";
        const caption =
          options.imageCaption === "title-first" ? title || alt :
          options.imageCaption === "alt-first" ? alt || title :
          options.imageCaption === "title" ? title :
          options.imageCaption === "alt" ? alt :
          filename;
        const image = `<img${before}src="${src}"${middle}alt="${alt}"${after}${title ? `title="${title}"` : ""}${tail}>`;
        return caption
          ? `<section style="margin:16px 0;text-align:center">${image}<p style="margin:6px 0 0;color:#8b8b8b;font-size:13px;text-align:center">${caption}</p></section>`
          : image;
      }
    );
  }

  return output;
}

export function renderForWechat(
  markdown: string,
  theme: ThemeDefinition = minimalBlueTheme,
  options: RenderOptions = DEFAULT_OPTIONS
): RenderResult {
  const document = parseMarkdown(markdown);
  let themedHtml = applyTheme(document.html, theme);

  if (options.linkMode === "footnote") {
    const references: string[] = [];
    themedHtml = themedHtml.replace(
      /<a\s+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_match, url: string, label: string) => {
        references.push(url);
        return `${label}<sup style="color:${theme.tokens.primaryColor}">[${references.length}]</sup>`;
      }
    );
    if (references.length > 0) {
      themedHtml += `<section style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280">${references
        .map((url, index) => `<p style="margin:6px 0">[${index + 1}] ${url}</p>`)
        .join("")}</section>`;
    }
  }

  themedHtml = applyContentOptions(themedHtml, options);
  const sanitized = sanitizeWechatHtml(themedHtml);
  const compatibilityDiagnostics = diagnoseWechatCompatibility(
    markdown,
    sanitized.html,
    document.resources,
    options
  );

  return {
    previewHtml: themedHtml,
    wechatHtml: sanitized.html,
    diagnostics: uniqueDiagnostics([
      ...sanitized.diagnostics,
      ...compatibilityDiagnostics
    ]),
    headings: document.headings,
    resources: document.resources
  };
}

export { diagnoseWechatCompatibility } from "./diagnostics";
export { sanitizeWechatHtml } from "./sanitizer";
