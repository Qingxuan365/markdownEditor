import { describe, expect, it } from "vitest";
import { builtinThemes, getThemeById, minimalBlueTheme } from "./index";

describe("theme engine", () => {
  it("提供六套内置主题且 ID 唯一", () => {
    expect(builtinThemes).toHaveLength(6);
    expect(new Set(builtinThemes.map((theme) => theme.id)).size).toBe(6);
  });

  it("未知主题回退到科技蓝", () => {
    expect(getThemeById("missing-theme").id).toBe(minimalBlueTheme.id);
  });
});
