export const LAST_ARTICLE_KEY = "qingxian-last-article-id";
export const SIDEBAR_WIDTH_KEY = "qingxian-sidebar-width";
export const WINDOW_SIZE_KEY = "qingxian-window-size";

export const DEFAULT_SIDEBAR_WIDTH = 228;
export const MIN_SIDEBAR_WIDTH = 228;
export const MAX_SIDEBAR_WIDTH = 360;

export type SavedWindowSize = {
  width: number;
  height: number;
};

function readNumber(key: string, fallback: number) {
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) ? value : fallback;
}

export function clampSidebarWidth(width: number) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

export function loadSidebarWidth() {
  return clampSidebarWidth(readNumber(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH));
}

export function saveSidebarWidth(width: number) {
  window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(width)));
}

export function loadWindowSize(): SavedWindowSize | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(WINDOW_SIZE_KEY) ?? "null");
    if (
      !value ||
      typeof value.width !== "number" ||
      typeof value.height !== "number" ||
      value.width < 980 ||
      value.height < 640
    ) {
      return null;
    }
    return {
      width: Math.round(value.width),
      height: Math.round(value.height)
    };
  } catch {
    return null;
  }
}

export function saveWindowSize(size: SavedWindowSize) {
  window.localStorage.setItem(
    WINDOW_SIZE_KEY,
    JSON.stringify({
      width: Math.max(980, Math.round(size.width)),
      height: Math.max(640, Math.round(size.height))
    })
  );
}

export function getPreviewDelay(markdownLength: number) {
  if (markdownLength >= 100_000) return 900;
  if (markdownLength >= 40_000) return 650;
  if (markdownLength >= 12_000) return 400;
  return 180;
}
