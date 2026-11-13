import type { RenderDiagnostic, RenderOptions } from "@qingxian/shared-types";

function isLocalOrRelativeResource(source: string) {
  return /^(?:file:|[a-z]:[\\/]|\\\\|\.{0,2}[\\/])/i.test(source);
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

export function diagnoseWechatCompatibility(
  markdown: string,
  html: string,
  resources: string[],
  options: RenderOptions
): RenderDiagnostic[] {
  const diagnostics: RenderDiagnostic[] = [];

  for (const source of resources) {
    if (/^http:\/\//i.test(source)) {
      diagnostics.push({
        code: "REMOTE_IMAGE_NOT_HTTPS",
        level: "warning",
        message: "远程图片不是 HTTPS 地址，微信公众号可能无法稳定加载。",
        source
      });
    } else if (/^https:\/\//i.test(source)) {
      diagnostics.push({
        code: "REMOTE_IMAGE_REQUIRES_NETWORK",
        level: "info",
        message: "远程图片依赖网络，断网或网络不稳定时可能无法预览，建议发布前上传并替换为稳定地址。",
        source
      });
    } else if (isLocalOrRelativeResource(source)) {
      diagnostics.push({
        code: "LOCAL_IMAGE_UNPUBLISHED",
        level: "error",
        message: "正文包含本地或相对路径图片，复制前必须上传并替换为公网 HTTPS 地址。",
        source
      });
    } else if (/^data:image\//i.test(source)) {
      diagnostics.push({
        code: "DATA_IMAGE_UNSTABLE",
        level: "warning",
        message: "内嵌 Data URL 图片体积较大，微信可能过滤，建议上传后替换。",
        source: source.slice(0, 48) + "…"
      });
    }
  }

  if (/<table\b/i.test(html)) {
    const wideTable = markdown
      .split(/\r?\n/)
      .some((line) => line.startsWith("|") && (line.match(/\|/g)?.length ?? 0) > 5);
    diagnostics.push({
      code: wideTable ? "WIDE_TABLE_MAY_OVERFLOW" : "TABLE_COMPATIBILITY_NOTICE",
      level: wideTable ? "warning" : "info",
      message: wideTable
        ? "表格超过 4 列，手机端可能横向溢出，建议精简列数或转为图片。"
        : "表格在不同微信客户端可能出现列宽差异，请发布前检查。"
    });
  }

  const codeBlocks = Array.from(markdown.matchAll(/```[\s\S]*?\n([\s\S]*?)```/g), (match) => match[1]);
  if (codeBlocks.length > 0) {
    const hasLongLine = codeBlocks.some((block) =>
      block.split(/\r?\n/).some((line) => line.length > 80)
    );
    diagnostics.push({
      code: hasLongLine ? "LONG_CODE_LINE_MAY_OVERFLOW" : "CODE_BLOCK_NOTICE",
      level: hasLongLine ? "warning" : "info",
      message: hasLongLine
        ? "代码块存在超过 80 个字符的长行，手机端可能横向溢出。"
        : "代码块粘贴后应检查字体和背景色是否被微信保留。"
    });
  }

  if (/<(?:span[^>]+class="[^"]*katex|math)\b/i.test(html)) {
    diagnostics.push({
      code: "FORMULA_SHOULD_BE_IMAGE",
      level: "warning",
      message: "公式依赖 KaTeX 样式和字体，微信可能过滤。正式发布前建议将公式转换为图片。"
    });
  }

  if (options.linkMode === "keep" && /<a\s+[^>]*href="https?:\/\//i.test(html)) {
    diagnostics.push({
      code: "EXTERNAL_LINK_MAY_BE_REMOVED",
      level: "warning",
      message: "正文包含外链，微信公众号可能移除或限制跳转，建议转换为文末引用。"
    });
  }

  if (/<img\b(?![^>]*\balt=)[^>]*>/i.test(html)) {
    diagnostics.push({
      code: "IMAGE_ALT_MISSING",
      level: "info",
      message: "存在缺少替代文本的图片，建议补充图片说明。"
    });
  }

  return uniqueDiagnostics(diagnostics);
}
