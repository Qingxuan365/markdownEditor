export type ArticleStatus = "draft" | "published" | "trash";

export type ArticleRecord = {
  id: string;
  title: string;
  filePath: string | null;
  content: string;
  status: ArticleStatus;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  publishedAt: number | null;
  deletedAt: number | null;
};

const STORAGE_KEY = "qingxian-article-library-v1";

export function createArticleId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `article-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getArticleTitle(content: string, filePath: string | null) {
  if (filePath) return filePath.split(/[\\/]/).pop() ?? "未命名文章.md";
  const heading = content.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/m)?.[1]?.trim();
  return heading || "未命名文章";
}

export function loadArticleLibrary(): ArticleRecord[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ArticleRecord =>
        typeof item === "object" &&
        item !== null &&
        typeof item.id === "string" &&
        typeof item.content === "string" &&
        ["draft", "published", "trash"].includes(item.status)
    );
  } catch {
    return [];
  }
}

export function saveArticleLibrary(articles: ArticleRecord[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(articles));
}
