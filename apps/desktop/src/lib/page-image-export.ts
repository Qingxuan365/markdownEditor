import { invoke } from "@tauri-apps/api/core";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export type PageImageProgress = {
  current: number;
  total: number;
};

function canvasToPngBytes(canvas: HTMLCanvasElement) {
  return new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("无法生成页面图片"));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

export async function exportPdfPagesAsPng(
  pdfData: Uint8Array,
  directory: string,
  baseName: string,
  onProgress: (progress: PageImageProgress) => void,
  savePage: (fileName: string, data: Uint8Array) => Promise<void> = async (fileName, data) => {
    await invoke("save_page_image", {
      directory,
      fileName,
      data: Array.from(data)
    });
  }
) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const loadingTask = pdfjs.getDocument({ data: pdfData });
  const document = await loadingTask.promise;
  const digits = Math.max(3, String(document.numPages).length);

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    onProgress({ current: pageNumber, total: document.numPages });
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("无法创建页面渲染画布");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const data = await canvasToPngBytes(canvas);
    await savePage(
      `${baseName}-第${String(pageNumber).padStart(digits, "0")}页.png`,
      data
    );
    page.cleanup();
  }

  await loadingTask.destroy();
  return document.numPages;
}
