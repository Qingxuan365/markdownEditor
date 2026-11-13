import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useEditorStore } from "@qingxian/editor-core";
import type { CodeTheme, RenderOptions, ThemeDefinition } from "@qingxian/shared-types";
import { builtinThemes, getThemeById, mergeThemeTokens } from "@qingxian/theme-engine";
import { renderForWechat } from "@qingxian/wechat-renderer";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { confirm, message, open, save } from "@tauri-apps/plugin-dialog";
import {
  MarkdownEditor,
  type EditorCommand,
  type MarkdownEditorHandle
} from "./components/MarkdownEditor";
import { Preview } from "./components/Preview";
import { TablePopover } from "./components/TablePopover";
import { createDocxBytes, createPdfBytes, createStandaloneHtml } from "./lib/document-export";
import { convertMermaidToWechatImages } from "./lib/mermaid";
import { exportPdfPagesAsPng } from "./lib/page-image-export";
import {
  clampSidebarWidth,
  getPreviewDelay,
  LAST_ARTICLE_KEY,
  loadSidebarWidth,
  loadWindowSize,
  saveSidebarWidth,
  saveWindowSize
} from "./lib/app-preferences";
import {
  createArticleId,
  getArticleTitle,
  loadArticleLibrary,
  saveArticleLibrary,
  type ArticleRecord,
  type ArticleStatus
} from "./lib/article-library";

const SAMPLE = `# 青弦编辑器

一款**本地优先**、面向微信公众号创作者的 Markdown 编辑器。

## 阶段 0 目标

- [x] React + TypeScript + Vite
- [x] CodeMirror 6 编辑器
- [x] Markdown 实时预览
- [ ] Tauri 文件读写
- [ ] 微信富文本复制验证
- [ ] Pandoc Word 导出

> Markdown 是文章正文的唯一真相源，主题切换不会修改正文。

\`\`\`ts
export function hello(name: string) {
  return \`你好，\${name}\`;
}
\`\`\`
`;

function saveStatusText(status: string) {
  const labels: Record<string, string> = {
    saved: "已保存",
    dirty: "未保存",
    saving: "正在保存",
    error: "保存失败"
  };
  return labels[status] ?? status;
}

type ColorMode = "light" | "dark";
type MenuName = "file" | "edit" | "view" | "insert" | "format" | "tools";
type LibraryView = "draft" | "recent" | "published" | "trash";
type StyleSettings = {
  layout: "classic" | "elegant" | "simple";
  font: "sans" | "serif" | "mono";
  fontSize: "smaller" | "small" | "recommended" | "large" | "larger";
  primaryColor: string;
  headingLevel: "h1" | "h2" | "h3";
  headingStyle: "default" | "underline" | "solid" | "center";
  codeTheme: CodeTheme;
  imageCaption: "title-first" | "alt-first" | "title" | "alt" | "filename" | "none";
  macCodeBlock: boolean;
  codeLineNumbers: boolean;
  paragraphIndent: boolean;
  textJustify: boolean;
};

type MenuItem = {
  label: string;
  icon?: string;
  shortcut?: string;
  action?: () => void | Promise<void>;
  separator?: boolean;
  checked?: boolean;
  colors?: string[];
  tablePicker?: boolean;
};

const EDITOR_TOOLBAR_GROUPS: {
  label: string;
  command: EditorCommand;
  icon: string;
  shortcut?: string;
}[][] = [
  [
    { label: "一级标题", command: "heading1", icon: "H1" },
    { label: "二级标题", command: "heading2", icon: "H2" },
    { label: "三级标题", command: "heading3", icon: "H3" },
    { label: "四级标题", command: "heading4", icon: "H4" },
    { label: "五级标题", command: "heading5", icon: "H5" },
    { label: "六级标题", command: "heading6", icon: "H6" }
  ],
  [
    { label: "加粗", command: "bold", icon: "B", shortcut: "Ctrl+B" },
    { label: "斜体", command: "italic", icon: "I", shortcut: "Ctrl+I" },
    { label: "删除线", command: "strike", icon: "S" },
    { label: "代码块", command: "codeBlock", icon: "</>" },
    { label: "行内代码", command: "inlineCode", icon: "`" },
    { label: "上标", command: "superscript", icon: "X²" },
    { label: "下标", command: "subscript", icon: "X₂" },
    { label: "文字颜色", command: "textColor", icon: "A色" }
  ],
  [
    { label: "引用", command: "quote", icon: "❯" },
    { label: "无序列表", command: "bulletList", icon: "•≡" },
    { label: "有序列表", command: "orderedList", icon: "1≡" },
    { label: "任务列表", command: "taskList", icon: "☑" },
    { label: "分隔线", command: "horizontalRule", icon: "—" }
  ],
  [
    { label: "超链接", command: "link", icon: "↗" },
    { label: "图片", command: "image", icon: "图" },
    { label: "公式", command: "formula", icon: "ƒx" },
    { label: "表格", command: "table", icon: "▦" },
    { label: "脚注", command: "footnote", icon: "[1]" },
    { label: "目录", command: "toc", icon: "目录" },
    { label: "插入当前时间", command: "dateTime", icon: "时间" },
    { label: "插入预计阅读时间", command: "readingTime", icon: "阅读" },
    { label: "Mermaid 图表", command: "mermaid", icon: "M图" },
    { label: "PlantUML 图表", command: "plantuml", icon: "UML" }
  ],
  [
    { label: "左对齐", command: "alignLeft", icon: "≡←" },
    { label: "居中对齐", command: "alignCenter", icon: "≡" },
    { label: "右对齐", command: "alignRight", icon: "→≡" }
  ]
];

function getInitialColorMode(): ColorMode {
  const savedMode = window.localStorage.getItem("qingxian-color-mode");
  if (savedMode === "light" || savedMode === "dark") return savedMode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialThemeId() {
  return window.localStorage.getItem("qingxian-theme-id") ?? "qingxian-tech-blue";
}

const DEFAULT_STYLE_SETTINGS: StyleSettings = {
  layout: "classic",
  font: "sans",
  fontSize: "recommended",
  primaryColor: "#2563eb",
  headingLevel: "h2",
  headingStyle: "default",
  codeTheme: "github-dark",
  imageCaption: "alt",
  macCodeBlock: true,
  codeLineNumbers: false,
  paragraphIndent: false,
  textJustify: false
};

function getInitialStyleSettings(): StyleSettings {
  try {
    return {
      ...DEFAULT_STYLE_SETTINGS,
      ...JSON.parse(window.localStorage.getItem("qingxian-style-settings") ?? "{}")
    };
  } catch {
    return DEFAULT_STYLE_SETTINGS;
  }
}

function SettingButtons({
  title,
  value,
  options,
  onChange,
  columns = 3
}: {
  title: string;
  value: string;
  options: string[][];
  onChange: (value: string) => void;
  columns?: number;
}) {
  return (
    <section className="setting-section">
      <h3>{title}</h3>
      <div className="setting-button-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {options.map(([optionValue, label]) => (
          <button
            className={value === optionValue ? "active" : ""}
            key={optionValue}
            onClick={() => onChange(optionValue)}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

function SettingSwitch({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="setting-switch">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i />
    </label>
  );
}

export function App() {
  const content = useEditorStore((state) => state.content);
  const setContent = useEditorStore((state) => state.setContent);
  const loadDocument = useEditorStore((state) => state.loadDocument);
  const loadLocalDocument = useEditorStore((state) => state.loadLocalDocument);
  const newDocumentState = useEditorStore((state) => state.newDocument);
  const setSaveStatus = useEditorStore((state) => state.setSaveStatus);
  const markSaved = useEditorStore((state) => state.markSaved);
  const filePath = useEditorStore((state) => state.filePath);
  const saveStatus = useEditorStore((state) => state.saveStatus);
  const [previewMode, setPreviewMode] = useState<"mobile" | "desktop">("mobile");
  const [statusMessage, setStatusMessage] = useState("");
  const [colorMode, setColorMode] = useState<ColorMode>(getInitialColorMode);
  const [themeId, setThemeId] = useState(getInitialThemeId);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [styleDrawerOpen, setStyleDrawerOpen] = useState(false);
  const [styleSettings, setStyleSettings] = useState<StyleSettings>(getInitialStyleSettings);
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null);
  const [linkAsFootnote, setLinkAsFootnote] = useState(true);
  const [tableSize, setTableSize] = useState({ rows: 3, columns: 3 });
  const [conversionStatus, setConversionStatus] = useState("");
  const [libraryView, setLibraryView] = useState<LibraryView>("draft");
  const [articles, setArticles] = useState<ArticleRecord[]>(loadArticleLibrary);
  const [currentArticleId, setCurrentArticleId] = useState(() => {
    const savedId = window.localStorage.getItem(LAST_ARTICLE_KEY);
    const savedArticle = articles.find((article) => article.id === savedId && article.status !== "trash");
    return savedArticle?.id ?? articles.find((article) => article.status !== "trash")?.id ?? createArticleId();
  });
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [previewMarkdown, setPreviewMarkdown] = useState(
    () => filePath === null && content === "" ? SAMPLE : content
  );
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const menuRef = useRef<HTMLElement>(null);
  const themePickerRef = useRef<HTMLDivElement>(null);
  const restoredArticleRef = useRef(false);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const markdown = filePath === null && content === "" ? SAMPLE : content;
  const selectedTheme = useMemo(() => getThemeById(themeId), [themeId]);
  const customizedTheme = useMemo<ThemeDefinition>(() => {
    const fontSizeMap = {
      smaller: "14px",
      small: "15px",
      recommended: "16px",
      large: "17px",
      larger: "18px"
    };
    const fontMap = {
      sans: "'Microsoft YaHei','Microsoft YaHei UI','PingFang SC',sans-serif",
      serif: "'SimSun','Songti SC','STSong',serif",
      mono: "'NSimSun','新宋体','SimSun','Cascadia Mono','Consolas',monospace"
    };
    const layoutLineHeight = styleSettings.layout === "elegant" ? "1.95" : styleSettings.layout === "simple" ? "1.7" : "1.85";
    const theme = mergeThemeTokens(selectedTheme, {
      primaryColor: styleSettings.primaryColor,
      fontSize: fontSizeMap[styleSettings.fontSize],
      lineHeight: layoutLineHeight
    });
    const layoutHeadingStyles: Record<StyleSettings["layout"], Record<"h2" | "h3", Record<string, string>>> = {
      classic: {
        h2: {
          display: "table",
          color: "#ffffff !important",
          WebkitTextFillColor: "#ffffff",
          background: styleSettings.primaryColor,
          padding: "7px 18px",
          marginLeft: "auto",
          marginRight: "auto",
          border: "0",
          borderRadius: "18px",
          textAlign: "center"
        },
        h3: {
          display: "block",
          color: theme.tokens.textColor,
          background: "#f3f6fa",
          padding: "8px 12px",
          border: "0",
          borderLeft: `4px solid ${styleSettings.primaryColor}`,
          borderRadius: "4px",
          textAlign: "left"
        }
      },
      elegant: {
        h2: {
          display: "block",
          color: styleSettings.primaryColor,
          background: "transparent",
          padding: "0 0 8px",
          border: "0",
          borderBottom: `2px solid ${styleSettings.primaryColor}`,
          borderRadius: "0",
          textAlign: "center"
        },
        h3: {
          display: "block",
          color: styleSettings.primaryColor,
          background: "transparent",
          padding: "0 0 6px",
          border: "0",
          borderBottom: "1px solid #d9dee7",
          borderRadius: "0",
          textAlign: "left"
        }
      },
      simple: {
        h2: {
          display: "block",
          color: theme.tokens.textColor,
          background: "#f5f7fa",
          padding: "9px 14px",
          border: "0",
          borderLeft: `5px solid ${styleSettings.primaryColor}`,
          borderRadius: "6px",
          textAlign: "left"
        },
        h3: {
          display: "block",
          color: styleSettings.primaryColor,
          background: "transparent",
          padding: "0",
          border: "0",
          borderRadius: "0",
          textAlign: "left"
        }
      }
    };
    const headingStyle: Record<string, string> =
      styleSettings.headingStyle === "solid"
        ? { color: "#ffffff !important", WebkitTextFillColor: "#ffffff", backgroundColor: styleSettings.primaryColor, padding: "7px 12px", borderRadius: "6px", borderLeft: "0" }
        : styleSettings.headingStyle === "underline"
          ? { color: styleSettings.primaryColor, borderBottom: `2px solid ${styleSettings.primaryColor}`, paddingBottom: "7px", borderLeft: "0" }
          : styleSettings.headingStyle === "center"
            ? {
                display: "table",
                width: "auto",
                color: "#ffffff !important",
                WebkitTextFillColor: "#ffffff",
                background: styleSettings.primaryColor,
                backgroundColor: styleSettings.primaryColor,
                padding: "7px 18px",
                borderRadius: "18px",
                textAlign: "center",
                marginLeft: "auto",
                marginRight: "auto",
                border: "0",
                borderLeft: "0"
              }
            : {};
    const nodes: Record<string, Record<string, string>> = { ...theme.nodes };
    const selectedFont = fontMap[styleSettings.font];
    nodes.section = { ...theme.nodes.section, fontFamily: selectedFont };
    for (const tag of ["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "th", "td"]) {
      nodes[tag] = { ...nodes[tag], fontFamily: selectedFont };
    }
    nodes.h2 = {
      ...theme.nodes.h2,
      ...layoutHeadingStyles[styleSettings.layout].h2
    };
    nodes.h3 = {
      ...theme.nodes.h3,
      ...layoutHeadingStyles[styleSettings.layout].h3
    };
    nodes[styleSettings.headingLevel] = {
      ...nodes[styleSettings.headingLevel],
      ...headingStyle
    };
    nodes.blockquote = {
      ...theme.nodes.blockquote,
      borderLeft: `4px solid ${styleSettings.primaryColor}`
    };
    nodes.a = { color: styleSettings.primaryColor, textDecoration: "none" };
    return { ...theme, nodes };
  }, [selectedTheme, styleSettings]);
  const renderOptions = useMemo<RenderOptions>(
    () => ({
      linkMode: linkAsFootnote ? "footnote" : "keep",
      codeTheme: styleSettings.codeTheme,
      imageCaption: styleSettings.imageCaption,
      macCodeBlock: styleSettings.macCodeBlock,
      codeLineNumbers: styleSettings.codeLineNumbers,
      paragraphIndent: styleSettings.paragraphIndent,
      textJustify: styleSettings.textJustify
    }),
    [linkAsFootnote, styleSettings]
  );
  const result = useMemo(
    () => renderForWechat(previewMarkdown, customizedTheme, renderOptions),
    [customizedTheme, previewMarkdown, renderOptions]
  );
  const previewPending = previewMarkdown !== markdown;
  const words = markdown.replace(/\s/g, "").length;
  const fileName = filePath
    ? filePath.split(/[\\/]/).pop() ?? "未命名文章.md"
    : content === ""
      ? "青弦编辑器"
      : "未命名文章.md";
  const visibleArticles = useMemo(() => {
    const available = articles.filter((article) => {
      if (libraryView === "recent") return article.status !== "trash";
      return article.status === libraryView;
    });
    return available
      .sort((left, right) =>
        libraryView === "recent"
          ? right.lastOpenedAt - left.lastOpenedAt
          : right.updatedAt - left.updatedAt
      )
      .slice(0, libraryView === "recent" ? 20 : undefined);
  }, [articles, libraryView]);
  const libraryCounts = useMemo(
    () => ({
      draft: articles.filter((article) => article.status === "draft").length,
      recent: articles.filter((article) => article.status !== "trash").length,
      published: articles.filter((article) => article.status === "published").length,
      trash: articles.filter((article) => article.status === "trash").length
    }),
    [articles]
  );

  useEffect(() => {
    window.localStorage.setItem("qingxian-color-mode", colorMode);
  }, [colorMode]);

  useEffect(() => {
    window.localStorage.setItem("qingxian-theme-id", selectedTheme.id);
  }, [selectedTheme.id]);

  useEffect(() => {
    window.localStorage.setItem("qingxian-style-settings", JSON.stringify(styleSettings));
  }, [styleSettings]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setPreviewMarkdown(markdown),
      getPreviewDelay(markdown.length)
    );
    return () => window.clearTimeout(timer);
  }, [markdown]);

  useEffect(() => {
    saveArticleLibrary(articles);
  }, [articles]);

  useEffect(() => {
    window.localStorage.setItem(LAST_ARTICLE_KEY, currentArticleId);
  }, [currentArticleId]);

  useEffect(() => {
    saveSidebarWidth(sidebarWidth);
  }, [sidebarWidth]);

  useEffect(() => {
    if (restoredArticleRef.current) return;
    restoredArticleRef.current = true;
    const article = articles.find(
      (item) => item.id === currentArticleId && item.status !== "trash"
    );
    if (!article) {
      setPreviewMarkdown(markdown);
      return;
    }
    if (article.filePath) loadDocument(article.content, article.filePath);
    else loadLocalDocument(article.content);
    setPreviewMarkdown(article.content);
    setLibraryView(article.status === "published" ? "published" : "draft");
    setArticles((current) =>
      current.map((item) =>
        item.id === article.id ? { ...item, lastOpenedAt: Date.now() } : item
      )
    );
  }, [articles, currentArticleId, loadDocument, loadLocalDocument, markdown]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten = () => {};
    let saveTimer = 0;

    void (async () => {
      const appWindow = getCurrentWindow();
      const savedSize = loadWindowSize();
      if (savedSize) {
        await appWindow.setSize(new LogicalSize(savedSize.width, savedSize.height));
      }
      const scaleFactor = await appWindow.scaleFactor();
      unlisten = await appWindow.onResized(({ payload }) => {
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => {
          const logical = payload.toLogical(scaleFactor);
          saveWindowSize(logical);
        }, 250);
      });
    })().catch(() => {
      // 浏览器预览或窗口权限不可用时保持默认尺寸。
    });

    return () => {
      window.clearTimeout(saveTimer);
      unlisten();
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const now = Date.now();
      setArticles((current) => {
        const existing = current.find((article) => article.id === currentArticleId);
        const nextArticle: ArticleRecord = existing
          ? {
              ...existing,
              title: getArticleTitle(markdown, filePath),
              filePath,
              content: markdown,
              updatedAt: now
            }
          : {
              id: currentArticleId,
              title: getArticleTitle(markdown, filePath),
              filePath,
              content: markdown,
              status: "draft",
              createdAt: now,
              updatedAt: now,
              lastOpenedAt: now,
              publishedAt: null,
              deletedAt: null
            };
        return [...current.filter((article) => article.id !== currentArticleId), nextArticle];
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [currentArticleId, filePath, markdown]);

  useEffect(() => {
    function closeMenu(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpenMenu(null);
      if (!themePickerRef.current?.contains(event.target as Node)) setThemePickerOpen(false);
    }
    window.addEventListener("mousedown", closeMenu);
    return () => window.removeEventListener("mousedown", closeMenu);
  }, []);

  function showStatus(message: string) {
    setStatusMessage(message);
    window.setTimeout(() => setStatusMessage(""), 2600);
  }

  function updateStyle<K extends keyof StyleSettings>(key: K, value: StyleSettings[K]) {
    setStyleSettings((current) => ({ ...current, [key]: value }));
  }

  function renderCurrentDocument() {
    return renderForWechat(markdown, customizedTheme, renderOptions);
  }

  function startSidebarResize(event: React.PointerEvent<HTMLDivElement>) {
    sidebarResizeRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-sidebar");
  }

  function resizeSidebar(event: React.PointerEvent<HTMLDivElement>) {
    const resize = sidebarResizeRef.current;
    if (!resize) return;
    setSidebarWidth(clampSidebarWidth(resize.startWidth + event.clientX - resize.startX));
  }

  function stopSidebarResize(event: React.PointerEvent<HTMLDivElement>) {
    if (!sidebarResizeRef.current) return;
    sidebarResizeRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.classList.remove("resizing-sidebar");
    saveSidebarWidth(sidebarWidth);
  }

  async function importMarkdown() {
    if (saveStatus === "dirty") {
      showStatus("当前文章尚未保存，请先保存后再导入");
      return;
    }

    try {
      const selectedPath = await open({
        multiple: false,
        directory: false,
        title: "导入 Markdown 文件",
        filters: [
          {
            name: "Markdown",
            extensions: ["md", "markdown"]
          }
        ]
      });

      if (!selectedPath) return;

      const importedContent = await invoke<string>("document_open", {
        path: selectedPath
      });
      const existingArticle = articles.find((article) => article.filePath === selectedPath);
      const nextId = existingArticle?.id ?? createArticleId();
      setCurrentArticleId(nextId);
      loadDocument(importedContent, selectedPath);
      setArticles((current) => {
        const now = Date.now();
        const existing = current.find((article) => article.id === nextId);
        const nextArticle: ArticleRecord = {
          id: nextId,
          title: getArticleTitle(importedContent, selectedPath),
          filePath: selectedPath,
          content: importedContent,
          status: existing?.status === "trash" ? "draft" : existing?.status ?? "draft",
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          lastOpenedAt: now,
          publishedAt: existing?.publishedAt ?? null,
          deletedAt: null
        };
        return [...current.filter((article) => article.id !== nextId), nextArticle];
      });
      showStatus(`已导入 ${selectedPath.split(/[\\/]/).pop() ?? "Markdown 文件"}`);
    } catch (error) {
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? String(error.message)
          : "导入失败，请检查文件是否可读";
      showStatus(message);
    }
  }

  async function canReplaceCurrentDocument() {
    if (saveStatus !== "dirty") return true;
    return confirm("当前文章尚未保存，继续操作会丢失修改。", {
      title: "未保存的修改",
      kind: "warning"
    });
  }

  async function createDocument() {
    if (!(await canReplaceCurrentDocument())) return;
    setCurrentArticleId(createArticleId());
    setLibraryView("draft");
    newDocumentState();
    editorRef.current?.focus();
    showStatus("已新建空白文章");
  }

  async function saveDocument(saveAs = false) {
    let targetPath = saveAs ? null : filePath;
    if (!targetPath) {
      targetPath = await save({
        title: "保存 Markdown 文件",
        defaultPath: fileName.endsWith(".md") ? fileName : "未命名文章.md",
        filters: [{ name: "Markdown", extensions: ["md", "markdown"] }]
      });
    }
    if (!targetPath) return;

    setSaveStatus("saving");
    try {
      await invoke("document_save", { path: targetPath, content: markdown });
      markSaved(targetPath);
      setArticles((current) =>
        current.map((article) =>
          article.id === currentArticleId
            ? {
                ...article,
                title: getArticleTitle(markdown, targetPath),
                filePath: targetPath,
                content: markdown,
                updatedAt: Date.now()
              }
            : article
        )
      );
      showStatus(`已保存 ${targetPath.split(/[\\/]/).pop() ?? "Markdown 文件"}`);
    } catch (error) {
      setSaveStatus("error");
      showStatus(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function exportHtml() {
    const targetPath = await save({
      title: "导出 HTML",
      defaultPath: fileName.replace(/\.(md|markdown)$/i, "") + ".html",
      filters: [{ name: "HTML", extensions: ["html"] }]
    });
    if (!targetPath) return;
    try {
      const currentResult = renderCurrentDocument();
      const converted = await convertMermaidToWechatImages(currentResult.wechatHtml);
      const html = createStandaloneHtml(fileName, converted.html);
      await invoke("export_html", { path: targetPath, html });
      await message(
        converted.convertedCount > 0
          ? `HTML 文件已导出，并将 ${converted.convertedCount} 张 Mermaid 图表转换为 PNG。`
          : "HTML 文件已导出。",
        { title: "导出成功", kind: "info" }
      );
    } catch {
      await message("HTML 导出失败，请检查目标路径。", { title: "导出失败", kind: "error" });
    }
  }

  async function exportPdf() {
    const targetPath = await save({
      title: "导出 PDF",
      defaultPath: fileName.replace(/\.(md|markdown)$/i, "") + ".pdf",
      filters: [{ name: "PDF 文档", extensions: ["pdf"] }]
    });
    if (!targetPath) return;

    try {
      showStatus("正在生成 PDF…");
      const currentResult = renderCurrentDocument();
      const converted = await convertMermaidToWechatImages(currentResult.previewHtml);
      const data = await createPdfBytes(converted.html);
      await invoke("export_pdf", { path: targetPath, data });
      await message(
        converted.convertedCount > 0
          ? `PDF 文件已导出，并包含 ${converted.convertedCount} 张 Mermaid 图表。`
          : "PDF 文件已导出。",
        { title: "导出成功", kind: "info" }
      );
    } catch (error) {
      await message(
        `PDF 导出失败：${error instanceof Error ? error.message : String(error)}`,
        { title: "导出失败", kind: "error" }
      );
    }
  }

  async function exportWord() {
    const targetPath = await save({
      title: "导出 Word",
      defaultPath: fileName.replace(/\.(md|markdown)$/i, "") + ".docx",
      filters: [{ name: "Word 文档", extensions: ["docx"] }]
    });
    if (!targetPath) return;

    try {
      showStatus("正在生成 Word…");
      const currentResult = renderCurrentDocument();
      const converted = await convertMermaidToWechatImages(currentResult.previewHtml);
      const data = await createDocxBytes(fileName, converted.html);
      await invoke("export_docx", { path: targetPath, data });
      await message(
        converted.convertedCount > 0
          ? `Word 文件已导出，包含页码和 ${converted.convertedCount} 张 Mermaid 图表。`
          : "Word 文件已导出，并已添加页码。",
        { title: "导出成功", kind: "info" }
      );
    } catch (error) {
      await message(
        `Word 导出失败：${error instanceof Error ? error.message : String(error)}`,
        { title: "导出失败", kind: "error" }
      );
    }
  }

  async function convertWordToPdf() {
    if (conversionStatus) {
      showStatus("已有文档正在转换，请等待完成");
      return;
    }
    const sourcePath = await open({
      multiple: false,
      directory: false,
      title: "导入 Word 并转换为 PDF",
      filters: [{
        name: "Word 文档",
        extensions: ["doc", "docx", "docm", "rtf", "odt"]
      }]
    });
    if (!sourcePath) return;
    const sourceName = sourcePath.split(/[\\/]/).pop() ?? "文档.docx";
    const targetPath = await save({
      title: "导出 PDF",
      defaultPath: sourceName.replace(/\.(docx?|docm|rtf|odt)$/i, "") + ".pdf",
      filters: [{ name: "PDF 文档", extensions: ["pdf"] }]
    });
    if (!targetPath) return;

    try {
      setConversionStatus("正在高保真转换 Word → PDF，可继续编辑…");
      const resultMessage = await invoke<string>("convert_word_to_pdf", {
        sourcePath,
        targetPath
      });
      await message(`${resultMessage}\n\n复杂排版、公式、表格和图片将按 Word 原始排版输出。`, {
        title: "转换成功",
        kind: "info"
      });
    } catch (error) {
      await message(
        `Word 转 PDF 失败：${error instanceof Error ? error.message : String(error)}`,
        { title: "转换失败", kind: "error" }
      );
    } finally {
      setConversionStatus("");
    }
  }

  async function convertPdfToWord() {
    if (conversionStatus) {
      showStatus("已有文档正在转换，请等待完成");
      return;
    }
    const sourcePath = await open({
      multiple: false,
      directory: false,
      title: "导入 PDF 并转换为 Word",
      filters: [{ name: "PDF 文档", extensions: ["pdf"] }]
    });
    if (!sourcePath) return;
    const sourceName = sourcePath.split(/[\\/]/).pop() ?? "文档.pdf";
    const targetPath = await save({
      title: "导出 Word",
      defaultPath: sourceName.replace(/\.pdf$/i, "") + ".docx",
      filters: [{ name: "Word 文档", extensions: ["docx"] }]
    });
    if (!targetPath) return;

    try {
      setConversionStatus("正在后台重排 PDF → Word，可继续编辑…");
      const resultMessage = await invoke<string>("convert_pdf_to_word", {
        sourcePath,
        targetPath
      });
      await message(
        `${resultMessage}\n\n文本型 PDF 会尽量恢复为可编辑内容；扫描件和难以重排的复杂元素会优先保持视觉完整。`,
        { title: "转换成功", kind: "info" }
      );
    } catch (error) {
      await message(
        `PDF 转 Word 失败：${error instanceof Error ? error.message : String(error)}`,
        { title: "转换失败", kind: "error" }
      );
    } finally {
      setConversionStatus("");
    }
  }

  async function exportDocumentPagesAsImages() {
    if (conversionStatus) {
      showStatus("已有文档正在转换，请等待完成");
      return;
    }
    const sourcePath = await open({
      multiple: false,
      directory: false,
      title: "选择要导出为分页图片的 Word 或 PDF",
      filters: [{
        name: "Word 或 PDF",
        extensions: ["pdf", "doc", "docx", "docm", "rtf", "odt"]
      }]
    });
    if (!sourcePath) return;
    const outputDirectory = await open({
      multiple: false,
      directory: true,
      title: "选择分页图片输出目录"
    });
    if (!outputDirectory) return;

    const sourceName = sourcePath.split(/[\\/]/).pop() ?? "文档";
    const sanitizedBaseName = sourceName
      .replace(/\.(pdf|docx?|docm|rtf|odt)$/i, "")
      .replace(/[<>:"/\\|?*]/g, "_");
    const baseName = Array.from(sanitizedBaseName)
      .filter((character) => character.charCodeAt(0) >= 32)
      .join("")
      .trim() || "文档";
    const isPdf = /\.pdf$/i.test(sourcePath);

    try {
      setConversionStatus(isPdf
        ? "正在读取 PDF 并生成分页图片…"
        : "正在后台转换 Word，随后生成分页图片…"
      );
      const bytes = await invoke<number[]>(
        isPdf ? "read_pdf_for_page_export" : "convert_word_to_pdf_data",
        { sourcePath }
      );
      const totalPages = await exportPdfPagesAsPng(
        new Uint8Array(bytes),
        outputDirectory,
        baseName,
        ({ current, total }) => {
          setConversionStatus(`正在导出分页图片 ${current} / ${total}，可继续编辑…`);
        }
      );
      await message(
        `已导出 ${totalPages} 张高清 PNG 图片。\n\n输出目录：${outputDirectory}`,
        { title: "导出成功", kind: "info" }
      );
    } catch (error) {
      await message(
        `分页图片导出失败：${error instanceof Error ? error.message : String(error)}`,
        { title: "导出失败", kind: "error" }
      );
    } finally {
      setConversionStatus("");
    }
  }

  function executeEditor(command: EditorCommand, value?: string) {
    window.requestAnimationFrame(() => editorRef.current?.execute(command, value));
  }

  function insertTable(rows: number, columns: number) {
    const headers = Array.from({ length: columns }, (_, index) => `列 ${index + 1}`);
    const separator = Array.from({ length: columns }, () => "---");
    const bodyRows = Array.from({ length: rows }, () =>
      `| ${Array.from({ length: columns }, () => "内容").join(" | ")} |`
    );
    const markdownTable = [
      `| ${headers.join(" | ")} |`,
      `| ${separator.join(" | ")} |`,
      ...bodyRows
    ].join("\n");
    setOpenMenu(null);
    window.requestAnimationFrame(() => {
      editorRef.current?.execute("insertText", `\n${markdownTable}\n`, "table");
    });
  }

  async function showDocumentStatistics() {
    const characters = markdown.length;
    const charactersWithoutSpaces = markdown.replace(/\s/g, "").length;
    const lines = markdown.split(/\r?\n/).length;
    const readingMinutes = Math.max(1, Math.ceil(charactersWithoutSpaces / 400));
    await message(
      `字符数：${characters}\n不含空格：${charactersWithoutSpaces}\n行数：${lines}\n预计阅读：${readingMinutes} 分钟`,
      { title: "字数与阅读时间", kind: "info" }
    );
  }

  async function resetDocument() {
    const accepted = await confirm("确定撤销当前所有修改，恢复为上次保存的内容吗？", {
      title: "重置文章",
      kind: "warning"
    });
    if (!accepted) return;

    if (filePath) {
      try {
        const savedContent = await invoke<string>("document_open", { path: filePath });
        loadDocument(savedContent, filePath);
        showStatus("已恢复到上次保存的内容");
      } catch {
        showStatus("无法读取上次保存的文件");
      }
    } else {
      newDocumentState();
      showStatus("已重置空白文章");
    }
  }

  async function clearDocument() {
    const accepted = await confirm("确定清空当前文章全部内容吗？此操作可以通过撤销恢复。", {
      title: "清空文章",
      kind: "warning"
    });
    if (accepted) executeEditor("clear");
  }

  async function openLibraryArticle(article: ArticleRecord) {
    if (article.id === currentArticleId) return;
    if (!(await canReplaceCurrentDocument())) return;
    let articleContent = article.content;
    if (article.filePath && article.status !== "trash") {
      try {
        articleContent = await invoke<string>("document_open", { path: article.filePath });
      } catch {
        showStatus("原文件无法读取，已打开文章库中的备份");
      }
    }
    setCurrentArticleId(article.id);
    if (article.filePath) loadDocument(articleContent, article.filePath);
    else loadLocalDocument(articleContent);
    setArticles((current) =>
      current.map((item) =>
        item.id === article.id
          ? { ...item, content: articleContent, lastOpenedAt: Date.now() }
          : item
      )
    );
  }

  function updateArticleStatus(articleId: string, status: ArticleStatus) {
    const now = Date.now();
    setArticles((current) =>
      current.map((article) =>
        article.id === articleId
          ? {
              ...article,
              status,
              updatedAt: now,
              publishedAt: status === "published" ? now : article.publishedAt,
              deletedAt: status === "trash" ? now : null
            }
          : article
      )
    );
  }

  async function publishArticle(articleId: string) {
    updateArticleStatus(articleId, "published");
    setLibraryView("published");
    showStatus("文章已标记为已发布");
  }

  async function moveArticleToTrash(articleId: string) {
    const accepted = await confirm("确定将这篇文章移入回收站吗？磁盘上的原文件不会被删除。", {
      title: "移入回收站",
      kind: "warning"
    });
    if (!accepted) return;
    updateArticleStatus(articleId, "trash");
    setLibraryView("trash");
    showStatus("文章已移入回收站");
  }

  function restoreArticle(articleId: string) {
    updateArticleStatus(articleId, "draft");
    setLibraryView("draft");
    showStatus("文章已恢复到草稿");
  }

  async function deleteArticleForever(articleId: string) {
    const accepted = await confirm("确定从文章库永久删除这条记录吗？磁盘上的原文件不会被删除。", {
      title: "永久删除",
      kind: "warning"
    });
    if (!accepted) return;
    setArticles((current) => current.filter((article) => article.id !== articleId));
    if (articleId === currentArticleId) {
      setCurrentArticleId(createArticleId());
      newDocumentState();
    }
    showStatus("文章库记录已永久删除");
  }

  function formatArticleTime(timestamp: number) {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(timestamp);
  }

  async function runCompatibilityCheck() {
    const currentResult = renderCurrentDocument();
    if (currentResult.diagnostics.length === 0) {
      await message("当前文章未发现微信兼容性问题。", {
        title: "兼容性检查通过",
        kind: "info"
      });
      return;
    }
    await message(
      currentResult.diagnostics
        .map((item, index) => `${index + 1}. ${item.message}${item.source ? `\n   ${item.source}` : ""}`)
        .join("\n\n"),
      { title: `发现 ${currentResult.diagnostics.length} 项问题`, kind: "warning" }
    );
  }

  async function copyWechatHtml() {
    try {
      showStatus("正在转换图表并复制…");
      const currentResult = renderCurrentDocument();
      const converted = await convertMermaidToWechatImages(currentResult.wechatHtml);
      const blob = new Blob([converted.html], { type: "text/html" });
      const textBlob = new Blob([markdown], { type: "text/plain" });
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": blob, "text/plain": textBlob })
      ]);
      await message(
        converted.convertedCount > 0
          ? `已复制到剪贴板，${converted.convertedCount} 张 Mermaid 图表已转换为高清 PNG，可直接粘贴到微信公众号编辑器。`
          : "已复制到剪贴板，可直接粘贴到微信公众号编辑器。",
        {
        title: "复制成功",
        kind: "info"
        }
      );
    } catch (error) {
      if (/^(?:`{3,}|~{3,})\s*mermaid\b/im.test(markdown)) {
        await message(
          `Mermaid 图表转换失败：${error instanceof Error ? error.message : String(error)}\n\n请修正图表语法后重新复制。`,
          { title: "复制失败", kind: "error" }
        );
        return;
      }
      try {
        await navigator.clipboard.writeText(markdown);
        await message("富文本复制不可用，已复制 Markdown 原文。", {
          title: "已复制",
          kind: "warning"
        });
      } catch {
        await message("无法访问剪贴板，请稍后重试。", {
          title: "复制失败",
          kind: "error"
        });
      }
    }
  }

  const menus: Record<MenuName, MenuItem[]> = {
    file: [
      { label: "新建", shortcut: "Ctrl+N", action: createDocument },
      { label: "打开", shortcut: "Ctrl+O", action: importMarkdown },
      { separator: true, label: "" },
      { label: "保存", shortcut: "Ctrl+S", action: () => saveDocument() },
      { label: "另存为", shortcut: "Ctrl+Shift+S", action: () => saveDocument(true) },
      { separator: true, label: "" },
      { label: "导入 Word → 导出 PDF", shortcut: "Ctrl+Alt+P", action: convertWordToPdf },
      { label: "导入 PDF → 导出 Word", shortcut: "Ctrl+Alt+W", action: convertPdfToWord },
      { label: "Word/PDF → 分页图片", shortcut: "Ctrl+Alt+I", action: exportDocumentPagesAsImages },
      { separator: true, label: "" },
      { label: "导出 HTML", shortcut: "Ctrl+Shift+H", action: exportHtml },
      { label: "导出 Word", shortcut: "Ctrl+Shift+W", action: exportWord },
      { label: "导出 PDF", shortcut: "Ctrl+Shift+P", action: exportPdf }
    ],
    edit: [
      { icon: "↶", label: "撤销", shortcut: "Ctrl Z", action: () => executeEditor("undo") },
      { icon: "↷", label: "重做", shortcut: "Ctrl Y", action: () => executeEditor("redo") },
      { separator: true, label: "" },
      { icon: "▣", label: "复制", shortcut: "Ctrl C", action: () => executeEditor("copy") },
      { icon: "✂", label: "剪切", shortcut: "Ctrl X", action: () => executeEditor("cut") },
      { icon: "▧", label: "粘贴", shortcut: "Ctrl V", action: () => executeEditor("paste") },
      { separator: true, label: "" },
      { icon: "⌁", label: "格式化", shortcut: "Alt Shift F", action: () => executeEditor("format") },
      { separator: true, label: "" },
      { icon: "⟳", label: "重置", action: resetDocument },
      { icon: "♜", label: "清空", action: clearDocument },
      { separator: true, label: "" },
      { icon: "⌕", label: "查找", shortcut: "Ctrl F", action: () => executeEditor("find") },
      { icon: "♙", label: "替换", shortcut: "Ctrl H", action: () => executeEditor("replace") }
    ],
    view: [
      {
        label: "手机预览",
        checked: previewMode === "mobile",
        action: () => setPreviewMode("mobile")
      },
      {
        label: "电脑预览",
        checked: previewMode === "desktop",
        action: () => setPreviewMode("desktop")
      },
      { separator: true, label: "" },
      {
        label: colorMode === "light" ? "切换到黑夜模式" : "切换到白天模式",
        action: () => setColorMode((mode) => (mode === "light" ? "dark" : "light"))
      }
    ],
    insert: [
      { icon: "▧", label: "图片", action: () => executeEditor("image") },
      { icon: "ƒ", label: "公式", action: () => executeEditor("formula") },
      { icon: "▦", label: "表格", tablePicker: true }
    ],
    format: [
      { icon: "B", label: "加粗", shortcut: "Ctrl+B", action: () => executeEditor("bold") },
      { icon: "I", label: "斜体", shortcut: "Ctrl+I", action: () => executeEditor("italic") },
      { icon: "S", label: "删除线", action: () => executeEditor("strike") },
      { icon: "↗", label: "超链接", action: () => executeEditor("link") },
      { icon: "‹›", label: "行内代码", action: () => executeEditor("inlineCode") },
      {
        icon: "◈",
        label: "文字颜色",
        colors: ["#2563eb", "#16a34a", "#dc2626", "#9333ea", "#d97706", "#111827"]
      },
      { separator: true, label: "" },
      { icon: "H¹", label: "标题", action: () => executeEditor("heading2") },
      { icon: "☷", label: "无序列表", action: () => executeEditor("bulletList") },
      { icon: "⒈", label: "有序列表", action: () => executeEditor("orderedList") },
      { separator: true, label: "" },
      { icon: "≡", label: "左对齐", action: () => executeEditor("alignLeft") },
      { icon: "≡", label: "居中对齐", action: () => executeEditor("alignCenter") },
      { icon: "≡", label: "右对齐", action: () => executeEditor("alignRight") },
      { separator: true, label: "" },
      {
        icon: "↪",
        label: "微信外链转引用",
        checked: linkAsFootnote,
        action: () => setLinkAsFootnote((enabled) => !enabled)
      },
      { icon: "◷", label: "统计字数时间", action: showDocumentStatistics }
    ],
    tools: [
      { label: "微信兼容性检查", action: runCompatibilityCheck },
      { label: "复制到微信", action: copyWechatHtml }
    ]
  };

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.altKey && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        executeEditor("format");
        return;
      }
      if (!event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (event.altKey && key === "p") {
        event.preventDefault();
        void convertWordToPdf();
      } else if (event.altKey && key === "w") {
        event.preventDefault();
        void convertPdfToWord();
      } else if (event.altKey && key === "i") {
        event.preventDefault();
        void exportDocumentPagesAsImages();
      } else if (event.shiftKey && key === "h") {
        event.preventDefault();
        void exportHtml();
      } else if (event.shiftKey && key === "w") {
        event.preventDefault();
        void exportWord();
      } else if (event.shiftKey && key === "p") {
        event.preventDefault();
        void exportPdf();
      } else if (key === "s") {
        event.preventDefault();
        void saveDocument(event.shiftKey);
      } else if (key === "o") {
        event.preventDefault();
        void importMarkdown();
      } else if (key === "n") {
        event.preventDefault();
        void createDocument();
      } else if (key === "b") {
        event.preventDefault();
        executeEditor("bold");
      } else if (key === "i") {
        event.preventDefault();
        executeEditor("italic");
      } else if (key === "f") {
        event.preventDefault();
        executeEditor("find");
      } else if (key === "h") {
        event.preventDefault();
        executeEditor("replace");
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  function renderMenu(name: MenuName, label: string) {
    const isOpen = openMenu === name;
    return (
      <div className={`menu-group ${isOpen ? "open" : ""}`}>
        <button
          className="menu-trigger"
          aria-expanded={isOpen}
          onClick={() => setOpenMenu(isOpen ? null : name)}
        >
          {label}
        </button>
        {isOpen && (
          <div className="menu-dropdown" role="menu">
            {menus[name].map((item, index) =>
              item.separator ? (
                <div className="menu-separator" key={`separator-${index}`} />
              ) : (
                <div className="menu-item-wrap" key={item.label}>
                  <button
                    className="menu-item"
                    role="menuitem"
                    onClick={() => {
                      if (item.colors || item.tablePicker) return;
                      setOpenMenu(null);
                      void item.action?.();
                    }}
                  >
                    <span className={`menu-icon ${item.label === "斜体" ? "italic" : ""}`}>
                      {item.checked ? "✓" : item.icon ?? ""}
                    </span>
                    <span>{item.label}</span>
                    {item.colors || item.tablePicker
                      ? <span className="submenu-arrow">›</span>
                      : item.shortcut && <kbd>{item.shortcut}</kbd>}
                  </button>
                  {item.colors && (
                    <div className="color-submenu">
                      <strong>文字颜色</strong>
                      <div className="color-grid">
                        {item.colors.map((color) => (
                          <button
                            key={color}
                            title={color}
                            aria-label={`文字颜色 ${color}`}
                            style={{ backgroundColor: color }}
                            onClick={() => {
                              setOpenMenu(null);
                              executeEditor("textColor", color);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {item.tablePicker && (
                    <div className="table-submenu">
                      <strong>{tableSize.rows} 行 × {tableSize.columns} 列</strong>
                      <div className="table-picker-grid">
                        {Array.from({ length: 64 }, (_, index) => {
                          const row = Math.floor(index / 8) + 1;
                          const column = (index % 8) + 1;
                          const active = row <= tableSize.rows && column <= tableSize.columns;
                          return (
                            <button
                              key={`${row}-${column}`}
                              className={active ? "active" : ""}
                              aria-label={`${row} 行 ${column} 列`}
                              onMouseEnter={() => setTableSize({ rows: row, columns: column })}
                              onFocus={() => setTableSize({ rows: row, columns: column })}
                              onClick={() => insertTable(row, column)}
                            />
                          );
                        })}
                      </div>
                      <span>移动选择行列，点击插入</span>
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <main className={`app-shell ${colorMode}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">弦</span>
          <div>
            <strong>青弦编辑器</strong>
            <small>Qingxian Editor</small>
          </div>
        </div>
        <nav className="menu" aria-label="主菜单" ref={menuRef}>
          {renderMenu("file", "文件")}
          {renderMenu("edit", "编辑")}
          {renderMenu("view", "视图")}
          {renderMenu("insert", "插入")}
          {renderMenu("format", "格式")}
          {renderMenu("tools", "工具")}
        </nav>
        <div className="actions">
          <button className="style-button" onClick={() => setStyleDrawerOpen(true)}>
            自定义
          </button>
          <div className="theme-picker" ref={themePickerRef}>
            <button
              className="theme-picker-trigger"
              aria-expanded={themePickerOpen}
              onClick={() => setThemePickerOpen((open) => !open)}
            >
              <span
                className="theme-dot"
                style={{ backgroundColor: selectedTheme.tokens.primaryColor }}
              />
              {selectedTheme.name.replace("青弦·", "")}
              <span className="theme-chevron" aria-hidden="true">▾</span>
            </button>
            {themePickerOpen && (
              <div className="theme-picker-menu">
                <strong>选择排版主题</strong>
                {builtinThemes.map((theme) => (
                  <button
                    className={theme.id === selectedTheme.id ? "active" : ""}
                    key={theme.id}
                    onClick={() => {
                      setThemeId(theme.id);
                      setThemePickerOpen(false);
                      showStatus(`已切换为${theme.name}`);
                    }}
                  >
                    <span
                      className="theme-swatch"
                      style={{ color: theme.tokens.primaryColor }}
                    />
                    <span>
                      <b>{theme.name.replace("青弦·", "")}</b>
                      <small>{theme.tokens.fontSize} · 行高 {theme.tokens.lineHeight}</small>
                    </span>
                    {theme.id === selectedTheme.id && <span className="theme-selected">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="mode-button"
            title={colorMode === "light" ? "切换到黑夜模式" : "切换到白天模式"}
            aria-label={colorMode === "light" ? "切换到黑夜模式" : "切换到白天模式"}
            onClick={() => setColorMode((mode) => (mode === "light" ? "dark" : "light"))}
          >
            <span aria-hidden="true">{colorMode === "light" ? "☾" : "☀"}</span>
            {colorMode === "light" ? "黑夜" : "白天"}
          </button>
          <button className="primary-button" onClick={copyWechatHtml}>
            复制
          </button>
        </div>
      </header>

      <section
        className="workspace"
        style={{ "--sidebar-width": `${clampSidebarWidth(sidebarWidth)}px` } as CSSProperties}
      >
        <aside className="sidebar">
          <div className="sidebar-heading">
            <span>文章库</span>
            <button aria-label="新建文章" onClick={createDocument}>＋</button>
          </div>
          <div className="nav-group">
            {([
              ["draft", "草稿"],
              ["recent", "最近"],
              ["published", "已发布"],
              ["trash", "回收站"]
            ] as const).map(([view, label]) => (
              <button
                className={libraryView === view ? "active" : ""}
                key={view}
                onClick={() => setLibraryView(view)}
              >
                {label} <span>{libraryCounts[view]}</span>
              </button>
            ))}
          </div>
          <div className="document-list">
            {visibleArticles.map((article) => (
              <article
                className={`document-card ${article.id === currentArticleId ? "active" : ""}`}
                key={article.id}
              >
                <button
                  className="document-open"
                  title={article.filePath ?? article.title}
                  onClick={() => openLibraryArticle(article)}
                >
                  <strong>{article.title}</strong>
                  <span>
                    {article.filePath ? "本地 Markdown" : "本地草稿"} · {formatArticleTime(article.updatedAt)}
                  </span>
                </button>
                <div className="document-actions">
                  {article.status === "trash" ? (
                    <>
                      <button onClick={() => restoreArticle(article.id)}>恢复</button>
                      <button className="danger" onClick={() => deleteArticleForever(article.id)}>永久删除</button>
                    </>
                  ) : (
                    <>
                      {article.status === "published" ? (
                        <button onClick={() => updateArticleStatus(article.id, "draft")}>转为草稿</button>
                      ) : (
                        <button onClick={() => publishArticle(article.id)}>发布</button>
                      )}
                      <button className="danger" onClick={() => moveArticleToTrash(article.id)}>删除</button>
                    </>
                  )}
                </div>
              </article>
            ))}
            {visibleArticles.length === 0 && (
              <div className="document-empty">
                {libraryView === "trash" ? "回收站为空" : "暂无文章"}
              </div>
            )}
          </div>
          <div
            className="sidebar-resizer"
            role="separator"
            aria-label="调整文章库宽度"
            aria-orientation="vertical"
            aria-valuemin={228}
            aria-valuemax={360}
            aria-valuenow={sidebarWidth}
            onPointerDown={startSidebarResize}
            onPointerMove={resizeSidebar}
            onPointerUp={stopSidebarResize}
            onPointerCancel={stopSidebarResize}
          />
        </aside>

        <section className="editor-pane">
          <div className="pane-toolbar">
            <span title={filePath ?? undefined}>Markdown · {fileName}</span>
            <div className="history-actions">
              <button aria-label="撤销" title="撤销（Ctrl+Z）" onClick={() => executeEditor("undo")}>↶</button>
              <button aria-label="重做" title="重做（Ctrl+Y）" onClick={() => executeEditor("redo")}>↷</button>
            </div>
          </div>
          <div className="editor-format-toolbar" role="toolbar" aria-label="Markdown 快捷工具栏">
            {EDITOR_TOOLBAR_GROUPS.map((group, groupIndex) => (
              <Fragment key={groupIndex}>
                {group.map((tool) => {
                  const button = (
                    <button
                      className={`editor-tool-button tool-${tool.command}`}
                      key={tool.command}
                      title={`${tool.label}${tool.shortcut ? `（${tool.shortcut}）` : ""}`}
                      aria-label={tool.label}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => tool.command !== "table" && executeEditor(tool.command)}
                    >
                      {tool.icon}
                    </button>
                  );

                  if (tool.command === "table") {
                    return (
                      <TablePopover
                        key={tool.command}
                        onSelect={(rows, cols) => executeEditor("table", `${rows}x${cols}`)}
                      >
                        {button}
                      </TablePopover>
                    );
                  }
                  
                  return button;
                })}
                {groupIndex < EDITOR_TOOLBAR_GROUPS.length - 1 && (
                  <div className="editor-tool-separator" />
                )}
              </Fragment>
            ))}
          </div>
          <MarkdownEditor ref={editorRef} value={markdown} onChange={setContent} />
        </section>

        <section className={`preview-pane ${previewMode}`}>
          <div className="pane-toolbar">
            <span>
              公众号预览
              {previewPending && <small className="preview-pending">正在更新…</small>}
            </span>
            <div className="segmented">
              <button
                className={previewMode === "mobile" ? "active" : ""}
                onClick={() => setPreviewMode("mobile")}
              >
                手机
              </button>
              <button
                className={previewMode === "desktop" ? "active" : ""}
                onClick={() => setPreviewMode("desktop")}
              >
                电脑
              </button>
            </div>
          </div>
          <div className="preview-stage">
            <div className="preview-device">
              <Preview html={result.previewHtml} />
            </div>
          </div>
        </section>
      </section>

      {styleDrawerOpen && (
        <>
          <button
            className="drawer-backdrop"
            aria-label="关闭样式设置"
            onClick={() => setStyleDrawerOpen(false)}
          />
          <aside className="style-drawer">
            <header>
              <div>
                <strong>自定义样式</strong>
                <span>实时应用到预览与复制结果</span>
              </div>
              <button aria-label="关闭" onClick={() => setStyleDrawerOpen(false)}>×</button>
            </header>
            <div className="style-drawer-content">
              <SettingButtons
                title="版式"
                value={styleSettings.layout}
                options={[["classic", "经典"], ["elegant", "优雅"], ["simple", "简洁"]]}
                onChange={(value) => updateStyle("layout", value as StyleSettings["layout"])}
              />
              <SettingButtons
                title="字体"
                value={styleSettings.font}
                options={[["sans", "无衬线"], ["serif", "衬线"], ["mono", "等宽"]]}
                onChange={(value) => updateStyle("font", value as StyleSettings["font"])}
              />
              <SettingButtons
                title="字号"
                value={styleSettings.fontSize}
                options={[["smaller", "更小"], ["small", "稍小"], ["recommended", "推荐"], ["large", "稍大"], ["larger", "更大"]]}
                onChange={(value) => updateStyle("fontSize", value as StyleSettings["fontSize"])}
                columns={5}
              />

              <section className="setting-section">
                <h3>主题色</h3>
                <div className="theme-color-grid">
                  {[
                    ["#2563eb", "经典蓝"], ["#10a37f", "翡翠绿"], ["#ff4d4f", "活力橘"],
                    ["#fbbf24", "柠檬黄"], ["#9b5f88", "薰衣紫"], ["#48b8d0", "天空蓝"],
                    ["#be6a7b", "玫瑰金"], ["#587636", "橄榄绿"], ["#333333", "石墨黑"],
                    ["#a3a3a3", "雾烟灰"], ["#f5a9bd", "樱花粉"], ["#8b5e3c", "咖啡棕"]
                  ].map(([color, label]) => (
                    <button
                      className={styleSettings.primaryColor === color ? "active" : ""}
                      key={color}
                      onClick={() => updateStyle("primaryColor", color)}
                    >
                      <span style={{ backgroundColor: color }} />
                      {label}
                    </button>
                  ))}
                </div>
                <label className="custom-color">
                  <span>自定义主题色</span>
                  <input
                    type="color"
                    value={styleSettings.primaryColor}
                    onChange={(event) => updateStyle("primaryColor", event.target.value)}
                  />
                </label>
              </section>

              <section className="setting-section">
                <h3>标题样式</h3>
                <div className="setting-selects">
                  <select value={styleSettings.headingLevel} onChange={(event) => updateStyle("headingLevel", event.target.value as StyleSettings["headingLevel"])}>
                    <option value="h1">一级标题</option>
                    <option value="h2">二级标题</option>
                    <option value="h3">三级标题</option>
                  </select>
                  <select value={styleSettings.headingStyle} onChange={(event) => updateStyle("headingStyle", event.target.value as StyleSettings["headingStyle"])}>
                    <option value="default">默认</option>
                    <option value="underline">下划线</option>
                    <option value="solid">色块</option>
                    <option value="center">居中</option>
                  </select>
                </div>
              </section>

              <section className="setting-section">
                <h3>代码块主题</h3>
                <select className="full-select" value={styleSettings.codeTheme} onChange={(event) => updateStyle("codeTheme", event.target.value as StyleSettings["codeTheme"])}>
                  <option value="github-dark">GitHub Dark</option>
                  <option value="github-light">GitHub Light</option>
                  <option value="atom-dark">Atom Dark</option>
                  <option value="dracula">Dracula</option>
                  <option value="monokai">Monokai</option>
                  <option value="nord">Nord</option>
                  <option value="solarized-light">Solarized Light</option>
                  <option value="solarized-dark">Solarized Dark</option>
                  <option value="one-dark">One Dark</option>
                  <option value="material-dark">Material Dark</option>
                  <option value="vscode-dark">VS Code Dark</option>
                  <option value="tomorrow-night">Tomorrow Night</option>
                </select>
              </section>

              <SettingButtons
                title="图注格式"
                value={styleSettings.imageCaption}
                options={[
                  ["title-first", "title 优先"], ["alt-first", "alt 优先"], ["title", "只显示 title"],
                  ["alt", "只显示 alt"], ["filename", "文件名"], ["none", "不显示"]
                ]}
                onChange={(value) => updateStyle("imageCaption", value as StyleSettings["imageCaption"])}
                columns={3}
              />

              <section className="setting-section setting-switches">
                <SettingSwitch label="Mac 代码块" checked={styleSettings.macCodeBlock} onChange={(checked) => updateStyle("macCodeBlock", checked)} />
                <SettingSwitch label="代码块行号" checked={styleSettings.codeLineNumbers} onChange={(checked) => updateStyle("codeLineNumbers", checked)} />
                <SettingSwitch label="微信外链接底部引用" checked={linkAsFootnote} onChange={setLinkAsFootnote} />
                <SettingSwitch label="段落首行缩进" checked={styleSettings.paragraphIndent} onChange={(checked) => updateStyle("paragraphIndent", checked)} />
                <SettingSwitch label="段落两端对齐" checked={styleSettings.textJustify} onChange={(checked) => updateStyle("textJustify", checked)} />
              </section>

              <section className="setting-section">
                <h3>样式配置</h3>
                <button
                  className="reset-style-button"
                  onClick={() => {
                    setStyleSettings(DEFAULT_STYLE_SETTINGS);
                    showStatus("样式配置已重置");
                  }}
                >
                  重置
                </button>
              </section>
            </div>
          </aside>
        </>
      )}

      <footer className="statusbar">
        <span>{words} 字</span>
        <span className={`save-status ${saveStatus}`}>● {saveStatusText(saveStatus)}</span>
        <span>主题：{selectedTheme.name}</span>
        <span className={result.diagnostics.length ? "warning" : "ok"}>
          {result.diagnostics.length
            ? `${result.diagnostics.length} 项兼容性提醒`
            : "兼容性检查通过"}
        </span>
        {conversionStatus && (
          <span className="conversion-status">
            <i aria-hidden="true" />
            {conversionStatus}
          </span>
        )}
        {statusMessage && <span className="toast">{statusMessage}</span>}
      </footer>
    </main>
  );
}
