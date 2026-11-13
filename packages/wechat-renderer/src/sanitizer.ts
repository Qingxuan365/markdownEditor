import sanitizeHtml from "sanitize-html";
import type { RenderDiagnostic } from "@qingxian/shared-types";

const ALLOWED_TAGS = [
  "section", "article", "div", "p", "span", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "s", "del", "u",
  "blockquote", "ul", "ol", "li", "input",
  "pre", "code", "table", "thead", "tbody", "tr", "th", "td",
  "a", "img", "sup", "sub",
  "math", "semantics", "annotation", "mrow", "mi", "mo", "mn",
  "msup", "msub", "msubsup", "mfrac", "msqrt", "mroot",
  "mtext", "mspace", "mtable", "mtr", "mtd", "mover", "munder", "munderover"
];

const ALLOWED_STYLE_PROPERTIES = new Set([
  "color", "background", "background-color",
  "font-size", "font-weight", "font-style", "font-family",
  "-webkit-text-fill-color",
  "line-height", "letter-spacing", "text-align", "text-decoration",
  "word-break", "overflow-wrap", "white-space",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border", "border-top", "border-right", "border-bottom", "border-left",
  "border-color", "border-style", "border-width", "border-radius",
  "width", "max-width", "min-width", "height", "max-height",
  "display", "vertical-align", "box-sizing", "opacity"
]);

const UNSAFE_STYLE_VALUE = /(?:expression\s*\(|javascript:|vbscript:|url\s*\(\s*['"]?\s*(?!https?:|data:image\/))/i;
const WECHAT_UNSTABLE_STYLE = /^(?:position|float|z-index|transform|animation|transition|filter|grid|grid-template|grid-area|flex|flex-flow|flex-grow|flex-shrink|gap|columns?|object-fit)$/;

export type SanitizeResult = {
  html: string;
  diagnostics: RenderDiagnostic[];
};

function cleanStyle(style: string, diagnostics: RenderDiagnostic[]) {
  const declarations = style
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  const safe: string[] = [];

  for (const declaration of declarations) {
    const separator = declaration.indexOf(":");
    if (separator < 1) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();

    if (UNSAFE_STYLE_VALUE.test(value)) {
      diagnostics.push({
        code: "DANGEROUS_CSS_VALUE_REMOVED",
        level: "error",
        message: `已移除危险 CSS 值：${property}。`,
        source: declaration
      });
      continue;
    }
    if (WECHAT_UNSTABLE_STYLE.test(property) || !ALLOWED_STYLE_PROPERTIES.has(property)) {
      diagnostics.push({
        code: "UNSUPPORTED_CSS_REMOVED",
        level: "warning",
        message: `已移除微信兼容性不稳定的样式：${property}。`,
        source: declaration
      });
      continue;
    }
    if (property === "display" && !/^(?:block|inline|inline-block|none|table|table-row|table-cell)$/i.test(value)) {
      diagnostics.push({
        code: "UNSUPPORTED_DISPLAY_REMOVED",
        level: "warning",
        message: `已移除微信不稳定的 display 值：${value}。`,
        source: declaration
      });
      continue;
    }
    safe.push(`${property}:${value}`);
  }

  return safe.join(";");
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

export function sanitizeWechatHtml(input: string): SanitizeResult {
  const diagnostics: RenderDiagnostic[] = [];

  if (/<(?:script|iframe|object|embed|form|video|audio|style|link)\b/i.test(input)) {
    diagnostics.push({
      code: "DANGEROUS_TAG_REMOVED",
      level: "error",
      message: "已移除脚本、嵌入对象、表单或外部样式等危险标签。"
    });
  }
  if (/\son[a-z]+\s*=/i.test(input)) {
    diagnostics.push({
      code: "EVENT_HANDLER_REMOVED",
      level: "error",
      message: "已移除 HTML 事件属性。"
    });
  }

  const html = sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      "*": ["class", "style", "title", "aria-hidden", "role"],
      a: ["href", "title"],
      img: ["src", "alt", "title", "width", "height"],
      input: ["type", "checked", "disabled"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
      annotation: ["encoding"],
      math: ["xmlns", "display"]
    },
    allowedSchemes: ["http", "https", "mailto", "data"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
      a: ["http", "https", "mailto"]
    },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    transformTags: {
      "*": (tagName, attribs) => {
        const cleaned = { ...attribs };
        for (const name of Object.keys(cleaned)) {
          if (/^on/i.test(name) || /^data-/i.test(name)) delete cleaned[name];
        }
        if (cleaned.style) {
          cleaned.style = cleanStyle(cleaned.style, diagnostics);
          if (!cleaned.style) delete cleaned.style;
        }
        return { tagName, attribs: cleaned };
      },
      a: (tagName, attribs) => {
        const cleaned = { ...attribs };
        if (cleaned.href && /^(?:javascript|vbscript|file):/i.test(cleaned.href.trim())) {
          diagnostics.push({
            code: "DANGEROUS_LINK_REMOVED",
            level: "error",
            message: "已移除危险链接地址。",
            source: cleaned.href
          });
          delete cleaned.href;
        }
        return { tagName, attribs: cleaned };
      },
      img: (tagName, attribs) => {
        const cleaned = { ...attribs };
        if (cleaned.src && /^(?:javascript|vbscript|file):/i.test(cleaned.src.trim())) {
          diagnostics.push({
            code: "DANGEROUS_IMAGE_SOURCE_REMOVED",
            level: "error",
            message: "已移除危险图片地址。",
            source: cleaned.src
          });
          delete cleaned.src;
        }
        return { tagName, attribs: cleaned };
      }
    }
  });

  return { html, diagnostics: uniqueDiagnostics(diagnostics) };
}
