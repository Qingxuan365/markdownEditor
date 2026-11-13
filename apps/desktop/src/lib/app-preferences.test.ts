import { describe, expect, it } from "vitest";
import {
  clampSidebarWidth,
  getPreviewDelay,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH
} from "./app-preferences";

describe("app preferences", () => {
  it("keeps the sidebar width inside the usable range", () => {
    expect(clampSidebarWidth(100)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(248.4)).toBe(248);
    expect(clampSidebarWidth(500)).toBe(MAX_SIDEBAR_WIDTH);
  });

  it("uses a longer preview delay for larger documents", () => {
    expect(getPreviewDelay(1_000)).toBeLessThan(getPreviewDelay(20_000));
    expect(getPreviewDelay(20_000)).toBeLessThan(getPreviewDelay(60_000));
    expect(getPreviewDelay(60_000)).toBeLessThan(getPreviewDelay(120_000));
  });
});
