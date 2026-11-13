export type DiagnosticLevel = "error" | "warning" | "info";

export type RenderDiagnostic = {
  code: string;
  level: DiagnosticLevel;
  message: string;
  source?: string;
};

export type AppError = {
  code: string;
  message: string;
  recoverable: boolean;
  userAction?: string;
  details?: Record<string, unknown>;
};

export type ThemeTokens = {
  primaryColor: string;
  textColor: string;
  fontSize: string;
  lineHeight: string;
  paragraphSpacing: string;
};

export type ThemeDefinition = {
  id: string;
  name: string;
  version: string;
  author: string;
  license: string;
  tokens: ThemeTokens;
  nodes: Record<string, Record<string, string>>;
  modules: Record<string, Record<string, string>>;
};

export type CodeTheme =
  | "github-light"
  | "github-dark"
  | "atom-dark"
  | "dracula"
  | "monokai"
  | "nord"
  | "solarized-light"
  | "solarized-dark"
  | "one-dark"
  | "material-dark"
  | "vscode-dark"
  | "tomorrow-night";

export type RenderOptions = {
  linkMode: "keep" | "footnote";
  codeTheme?: CodeTheme;
  imageCaption?: "title-first" | "alt-first" | "title" | "alt" | "filename" | "none";
  macCodeBlock?: boolean;
  codeLineNumbers?: boolean;
  paragraphIndent?: boolean;
  textJustify?: boolean;
};

export type RenderResult = {
  previewHtml: string;
  wechatHtml: string;
  diagnostics: RenderDiagnostic[];
  headings: Array<{ level: number; text: string; id: string }>;
  resources: string[];
};
