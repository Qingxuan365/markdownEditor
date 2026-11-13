import type { ThemeDefinition, ThemeTokens } from "@qingxian/shared-types";

function createTheme(
  id: string,
  name: string,
  tokens: ThemeTokens,
  options: {
    headingStyle?: "line" | "underline" | "solid" | "classic";
    quoteBackground?: string;
  } = {}
): ThemeDefinition {
  const headingStyle = options.headingStyle ?? "line";
  const headingBase: Record<string, string> = {
    color: tokens.textColor,
    fontWeight: "700"
  };
  const headingAccent: Record<string, string> =
    headingStyle === "solid"
      ? {
          color: "#ffffff",
          backgroundColor: tokens.primaryColor,
          padding: "7px 12px",
          borderRadius: "6px"
        }
      : headingStyle === "underline"
        ? {
            paddingBottom: "7px",
            borderBottom: `2px solid ${tokens.primaryColor}`
          }
        : headingStyle === "classic"
          ? {
              color: tokens.primaryColor,
              textAlign: "center"
            }
          : {
              paddingLeft: "10px",
              borderLeft: `4px solid ${tokens.primaryColor}`
            };

  return {
    id,
    name,
    version: "1.0.0",
    author: "Qingxian",
    license: "Proprietary",
    tokens,
    nodes: {
      h1: {
        ...headingBase,
        ...headingAccent,
        fontSize: "26px",
        margin: "28px 0 18px"
      },
      h2: {
        ...headingBase,
        ...headingAccent,
        fontSize: "21px",
        margin: "24px 0 14px"
      },
      h3: {
        ...headingBase,
        color: tokens.primaryColor,
        fontSize: "18px",
        margin: "20px 0 12px"
      },
      blockquote: {
        borderLeft: `4px solid ${tokens.primaryColor}`,
        margin: "16px 0",
        padding: "10px 16px",
        color: tokens.textColor,
        background: options.quoteBackground ?? "#f8fafc"
      },
      a: { color: tokens.primaryColor, textDecoration: "none" },
      table: { borderColor: tokens.primaryColor }
    },
    modules: {}
  };
}

export const minimalWhiteTheme = createTheme(
  "qingxian-minimal-white",
  "青弦·极简白",
  {
    primaryColor: "#374151",
    textColor: "#222222",
    fontSize: "16px",
    lineHeight: "1.8",
    paragraphSpacing: "16px"
  },
  { headingStyle: "underline", quoteBackground: "#f9fafb" }
);

export const minimalBlueTheme = createTheme(
  "qingxian-tech-blue",
  "青弦·科技蓝",
  {
    primaryColor: "#2563eb",
    textColor: "#222222",
    fontSize: "16px",
    lineHeight: "1.8",
    paragraphSpacing: "16px"
  },
  { headingStyle: "line", quoteBackground: "#f3f7ff" }
);

export const blackGoldTheme = createTheme(
  "qingxian-black-gold",
  "青弦·商务黑金",
  {
    primaryColor: "#b8892d",
    textColor: "#252525",
    fontSize: "16px",
    lineHeight: "1.85",
    paragraphSpacing: "18px"
  },
  { headingStyle: "solid", quoteBackground: "#fbf7ed" }
);

export const freshGreenTheme = createTheme(
  "qingxian-fresh-green",
  "青弦·清新绿",
  {
    primaryColor: "#16a34a",
    textColor: "#25332a",
    fontSize: "16px",
    lineHeight: "1.85",
    paragraphSpacing: "17px"
  },
  { headingStyle: "line", quoteBackground: "#f0fdf4" }
);

export const chinaRedTheme = createTheme(
  "qingxian-china-red",
  "青弦·中国红",
  {
    primaryColor: "#c81e1e",
    textColor: "#2f2020",
    fontSize: "16px",
    lineHeight: "1.85",
    paragraphSpacing: "17px"
  },
  { headingStyle: "classic", quoteBackground: "#fff5f5" }
);

export const readingGrayTheme = createTheme(
  "qingxian-reading-gray",
  "青弦·阅读灰",
  {
    primaryColor: "#64748b",
    textColor: "#343a40",
    fontSize: "17px",
    lineHeight: "1.95",
    paragraphSpacing: "20px"
  },
  { headingStyle: "underline", quoteBackground: "#f4f5f7" }
);

export const builtinThemes: ThemeDefinition[] = [
  minimalWhiteTheme,
  minimalBlueTheme,
  blackGoldTheme,
  freshGreenTheme,
  chinaRedTheme,
  readingGrayTheme
];

export function getThemeById(id: string) {
  return builtinThemes.find((theme) => theme.id === id) ?? minimalBlueTheme;
}

export function mergeThemeTokens(
  theme: ThemeDefinition,
  overrides: Partial<ThemeTokens>
): ThemeDefinition {
  return { ...theme, tokens: { ...theme.tokens, ...overrides } };
}
