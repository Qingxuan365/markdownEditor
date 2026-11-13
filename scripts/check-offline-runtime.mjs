import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceTargets = [
  "apps/desktop/index.html",
  "apps/desktop/src",
  "packages/markdown-engine/src",
  "packages/shared-types/src",
  "packages/wechat-renderer/src"
];
const buildTarget = "apps/desktop/dist";
const textExtensions = new Set([".css", ".html", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const forbiddenPatterns = [
  { name: "远程脚本", pattern: /<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//gi },
  { name: "远程样式或预加载资源", pattern: /<link\b[^>]*\bhref\s*=\s*["']https?:\/\//gi },
  { name: "CSS 远程导入", pattern: /@import\s+(?:url\()?["']?https?:\/\//gi },
  { name: "CSS 远程字体或图片", pattern: /url\(\s*["']?https?:\/\//gi },
  { name: "远程模块导入", pattern: /\b(?:import|export)\s+(?:[^"'`]*?\sfrom\s*)?["']https?:\/\//gi },
  { name: "远程动态模块", pattern: /\bimport\(\s*["']https?:\/\//gi }
];

function collectFiles(target) {
  const absolute = join(root, target);
  if (!existsSync(absolute)) return [];
  if (!statSync(absolute).isDirectory()) return [absolute];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = join(absolute, entry.name);
    return entry.isDirectory() ? collectFiles(relative(root, child)) : [child];
  });
}

const files = [...sourceTargets, buildTarget]
  .flatMap(collectFiles)
  .filter((file) => textExtensions.has(extname(file)));
const violations = [];

for (const file of files) {
  const content = readFileSync(file, "utf8");
  for (const rule of forbiddenPatterns) {
    rule.pattern.lastIndex = 0;
    for (const match of content.matchAll(rule.pattern)) {
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      violations.push(`${relative(root, file)}:${line} ${rule.name}: ${match[0]}`);
    }
  }
}

if (violations.length > 0) {
  console.error("离线资源检查失败：发现运行时远程依赖。");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`离线资源检查通过：已检查 ${files.length} 个源码及构建文件，未发现远程脚本、样式、字体或模块引用。`);
