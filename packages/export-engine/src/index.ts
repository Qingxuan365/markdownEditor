export type ExportFormat = "markdown" | "html" | "docx" | "pdf";

export type ExportRequest = {
  format: ExportFormat;
  sourcePath?: string;
  targetPath: string;
  markdown: string;
  templatePath?: string;
};

export type ExportTask = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
};

