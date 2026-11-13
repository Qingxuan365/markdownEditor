import katexCss from "katex/dist/katex.min.css?inline";

const PAGE_WIDTH_PX = 794;
const PAGE_PADDING_PX = 48;
const PDF_PAGE_WIDTH_MM = 210;
const PDF_PAGE_HEIGHT_MM = 297;
const PDF_SIDE_MARGIN_MM = 10;
const PDF_TOP_MARGIN_MM = 10;
const PDF_BOTTOM_MARGIN_MM = 18;

export function createStandaloneHtml(title: string, bodyHtml: string) {
  const safeTitle = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    html { background:#eef2f7; }
    body {
      width:min(100% - 32px, 760px);
      margin:24px auto;
      padding:40px;
      box-sizing:border-box;
      color:#222;
      background:#fff;
      box-shadow:0 8px 28px rgba(15,23,42,.08);
    }
    img, svg { max-width:100%; height:auto; }
    pre, code {
      max-width:100%!important;
      box-sizing:border-box!important;
      white-space:pre-wrap!important;
      word-break:break-all!important;
      overflow-wrap:anywhere!important;
    }
    pre { overflow-x:hidden!important; }
    table { width:100%; border-collapse:collapse; }
    .katex-html { display:none!important; }
    .katex-mathml { display:inline!important; }
    .katex-display { margin:18px 0; text-align:center; }
    .katex-display .katex-mathml { display:block!important; }
    @media print {
      html { background:#fff; }
      body { width:auto; margin:0; padding:0; box-shadow:none; }
      pre, blockquote, table, img { break-inside:avoid; }
    }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

async function waitForImages(container: HTMLElement) {
  await Promise.all(
    Array.from(container.querySelectorAll("img")).map(async (image) => {
      if (image.complete) return;
      await new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => {
          image.replaceWith(Object.assign(document.createElement("div"), {
            textContent: image.alt ? `图片加载失败：${image.alt}` : "图片加载失败"
          }));
          resolve();
        }, { once: true });
      });
    })
  );
}

function dataUrlToBytes(dataUrl: string) {
  const encoded = dataUrl.split(",", 2)[1] ?? "";
  const binary = window.atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function createPageCanvases(bodyHtml: string) {
  const { default: html2canvas } = await import("html2canvas");
  const style = document.createElement("style");
  style.textContent = `${katexCss}
    article, article * { box-sizing:border-box; }
    article { overflow-wrap:anywhere; word-break:break-word; }
    article pre, article code {
      max-width:100%!important;
      white-space:pre-wrap!important;
      word-break:break-all!important;
      overflow-wrap:anywhere!important;
    }
    article pre { overflow-x:hidden!important; }
    article img, article svg, article table { max-width:100%!important; }
  `;
  const container = document.createElement("article");
  container.style.cssText = [
    "position:absolute",
    "left:-100000px",
    "top:0",
    `width:${PAGE_WIDTH_PX}px`,
    `padding:${PAGE_PADDING_PX}px`,
    "box-sizing:border-box",
    "color:#222",
    "background:#fff",
    "font-size:16px",
    "line-height:1.8",
    "overflow:visible"
  ].join(";");
  container.innerHTML = bodyHtml;
  document.head.append(style);
  document.body.append(container);

  try {
    await document.fonts.ready;
    await waitForImages(container);
    const canvas = await html2canvas(container, {
      backgroundColor: "#ffffff",
      scale: 3,
      useCORS: true,
      allowTaint: false,
      logging: false,
      width: PAGE_WIDTH_PX,
      height: container.scrollHeight,
      windowWidth: PAGE_WIDTH_PX
    });

    const contentWidth = PDF_PAGE_WIDTH_MM - PDF_SIDE_MARGIN_MM * 2;
    const contentHeight = PDF_PAGE_HEIGHT_MM - PDF_TOP_MARGIN_MM - PDF_BOTTOM_MARGIN_MM;
    const pageHeightPx = Math.max(1, Math.floor(canvas.width * contentHeight / contentWidth));
    const containerTop = container.getBoundingClientRect().top;
    const canvasScale = canvas.height / container.scrollHeight;
    const pageBoundaries = Array.from(
      container.querySelectorAll<HTMLElement>(
        "h1,h2,h3,h4,h5,h6,p,blockquote,pre,table,ul,ol,img,.katex-display,.qx-mermaid"
      )
    )
      .map((element) =>
        Math.ceil((element.getBoundingClientRect().bottom - containerTop + 8) * canvasScale)
      )
      .filter((position) => position > 0 && position < canvas.height)
      .sort((left, right) => left - right);
    const contentEnd = Math.min(canvas.height, pageBoundaries.at(-1) ?? canvas.height);

    const pages: HTMLCanvasElement[] = [];
    for (let offset = 0; offset < contentEnd;) {
      const targetEnd = Math.min(offset + pageHeightPx, contentEnd);
      const minimumUsefulPage = offset + Math.floor(pageHeightPx * 0.45);
      const safeEnd = pageBoundaries
        .filter((position) => position >= minimumUsefulPage && position <= targetEnd)
        .at(-1);
      const sliceEnd = safeEnd ?? targetEnd;
      const sliceHeight = sliceEnd - offset;
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeight;
      const context = pageCanvas.getContext("2d");
      if (!context) throw new Error("无法创建 PDF 页面画布");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      context.drawImage(
        canvas,
        0, offset, canvas.width, sliceHeight,
        0, 0, canvas.width, sliceHeight
      );
      pages.push(pageCanvas);
      offset = sliceEnd;
    }
    return pages;
  } finally {
    container.remove();
    style.remove();
  }
}

export async function createPdfBytes(bodyHtml: string) {
  const [{ jsPDF }, pages] = await Promise.all([
    import("jspdf"),
    createPageCanvases(bodyHtml)
  ]);
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const contentWidth = PDF_PAGE_WIDTH_MM - PDF_SIDE_MARGIN_MM * 2;

  pages.forEach((pageCanvas, index) => {
    if (index > 0) pdf.addPage();
    const imageHeight = pageCanvas.height * contentWidth / pageCanvas.width;
    pdf.addImage(
      pageCanvas.toDataURL("image/jpeg", 0.95),
      "JPEG",
      PDF_SIDE_MARGIN_MM,
      PDF_TOP_MARGIN_MM,
      contentWidth,
      imageHeight
    );
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(120, 120, 120);
    pdf.text(
      `${index + 1} / ${pages.length}`,
      PDF_PAGE_WIDTH_MM / 2,
      PDF_PAGE_HEIGHT_MM - 7,
      { align: "center" }
    );
  });

  return Array.from(new Uint8Array(pdf.output("arraybuffer")));
}

export async function createDocxBytes(title: string, bodyHtml: string) {
  const docx = await import("docx");
  const { default: html2canvas } = await import("html2canvas");
  const {
    AlignmentType,
    BorderStyle,
    Document,
    ExternalHyperlink,
    Footer,
    Header,
    HeadingLevel,
    ImageRun,
    LevelFormat,
    Packer,
    PageNumber,
    Paragraph,
    ShadingType,
    Table,
    TableBorders,
    TableCell,
    TableLayoutType,
    TableRow,
    TextRun,
    VerticalAlign,
    WidthType
  } = docx;
  const style = document.createElement("style");
  style.textContent = `${katexCss}
    article, article * { box-sizing:border-box; }
    article { overflow-wrap:anywhere; word-break:break-word; }
    article img, article svg, article table { max-width:100%!important; }
    article pre, article code { white-space:pre-wrap!important; overflow-wrap:anywhere!important; }
  `;
  const container = document.createElement("article");
  container.style.cssText = [
    "position:absolute",
    "left:-100000px",
    "top:0",
    "width:720px",
    "padding:36px",
    "box-sizing:border-box",
    "color:#222",
    "background:#fff",
    "font-size:16px",
    "line-height:1.8",
    "overflow:visible"
  ].join(";");
  container.innerHTML = bodyHtml;
  document.head.append(style);
  document.body.append(container);

  const colorHex = (value: string, fallback = "222222") => {
    const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
    if (hex) return hex.length === 3 ? hex.split("").map((part) => part + part).join("").toUpperCase() : hex.toUpperCase();
    const rgb = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!rgb) return fallback;
    return rgb.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, "0")).join("").toUpperCase();
  };
  const firstFont = (value: string) =>
    value.split(",")[0]?.replace(/["']/g, "").trim() || "Microsoft YaHei";
  const halfPoints = (value: string, fallback = 22) => {
    const pixels = Number.parseFloat(value);
    return Number.isFinite(pixels) ? Math.max(16, Math.min(72, Math.round(pixels * 1.5))) : fallback;
  };
  const alignment = (value: string) => {
    if (value === "center") return AlignmentType.CENTER;
    if (value === "right" || value === "end") return AlignmentType.RIGHT;
    if (value === "justify") return AlignmentType.JUSTIFIED;
    return AlignmentType.LEFT;
  };
  const runStyle = (element: Element, overrides: Record<string, unknown> = {}) => {
    const computed = window.getComputedStyle(element);
    return {
      bold: Number.parseInt(computed.fontWeight, 10) >= 600 || computed.fontWeight === "bold",
      italics: computed.fontStyle === "italic",
      strike: computed.textDecorationLine.includes("line-through"),
      color: colorHex(computed.color),
      size: halfPoints(computed.fontSize),
      font: firstFont(computed.fontFamily),
      ...overrides
    };
  };
  const inlineChildren = (element: Element): InstanceType<typeof TextRun>[] | (InstanceType<typeof TextRun> | InstanceType<typeof ExternalHyperlink>)[] => {
    const children: (InstanceType<typeof TextRun> | InstanceType<typeof ExternalHyperlink>)[] = [];
    element.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.replace(/\s+/g, " ") ?? "";
        if (text) children.push(new TextRun({ text, ...runStyle(element) }));
        return;
      }
      if (!(node instanceof Element)) return;
      if (node.tagName === "BR") {
        children.push(new TextRun({ break: 1 }));
        return;
      }
      if (node.matches(".katex-mathml,script,style")) return;
      if (node.tagName === "A" && node.getAttribute("href")) {
        children.push(new ExternalHyperlink({
          link: node.getAttribute("href") ?? "",
          children: inlineChildren(node).map((child) =>
            child instanceof TextRun
              ? child
              : new TextRun({ text: node.textContent ?? "", ...runStyle(node, { color: "2563EB" }) })
          )
        }));
        return;
      }
      if (node.tagName === "CODE") {
        children.push(new TextRun({
          text: node.textContent ?? "",
          ...runStyle(node, { font: "Consolas", shading: { fill: "F2F4F7", type: ShadingType.CLEAR } })
        }));
        return;
      }
      children.push(...inlineChildren(node));
    });
    return children;
  };
  const rasterizeElement = async (element: HTMLElement) => {
    const canvas = await html2canvas(element, {
      backgroundColor: "#ffffff",
      scale: 3,
      useCORS: true,
      allowTaint: false,
      logging: false
    });
    const maxWidth = 620;
    const width = Math.min(maxWidth, Math.max(80, element.getBoundingClientRect().width));
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 160 },
      children: [
        new ImageRun({
          type: "png",
          data: dataUrlToBytes(canvas.toDataURL("image/png")),
          transformation: {
            width,
            height: Math.round(canvas.height * width / canvas.width)
          }
        })
      ]
    });
  };
  const imageParagraph = async (image: HTMLImageElement) => {
    try {
      let data: Uint8Array;
      let type: "png" | "jpg" | "gif" | "bmp" = "png";
      if (image.src.startsWith("data:")) {
        data = dataUrlToBytes(image.src);
        const mime = image.src.slice(5, image.src.indexOf(";"));
        if (/jpe?g/i.test(mime)) type = "jpg";
        else if (/gif/i.test(mime)) type = "gif";
        else if (/bmp/i.test(mime)) type = "bmp";
      } else {
        const response = await fetch(image.src);
        const mime = response.headers.get("content-type") ?? "";
        if (/jpe?g/i.test(mime)) type = "jpg";
        else if (/gif/i.test(mime)) type = "gif";
        else if (/bmp/i.test(mime)) type = "bmp";
        data = new Uint8Array(await response.arrayBuffer());
      }
      const sourceWidth = image.naturalWidth || image.width || 600;
      const sourceHeight = image.naturalHeight || image.height || 360;
      const width = Math.min(620, sourceWidth);
      return new Paragraph({
        alignment: alignment(window.getComputedStyle(image.parentElement ?? image).textAlign),
        spacing: { before: 100, after: 100 },
        children: [
          new ImageRun({
            type,
            data,
            transformation: { width, height: Math.round(sourceHeight * width / sourceWidth) },
            altText: {
              title: image.title || image.alt || "图片",
              description: image.alt || image.title || "文章图片",
              name: image.alt || image.title || "image"
            }
          })
        ]
      });
    } catch {
      return new Paragraph({
        text: image.alt ? `图片：${image.alt}` : "图片加载失败",
        spacing: { after: 120 }
      });
    }
  };
  const paragraphFromElement = (element: HTMLElement, list?: "bullet" | "number") => {
    const computed = window.getComputedStyle(element);
    const tag = element.tagName.toLowerCase();
    const headingMap = {
      h1: HeadingLevel.HEADING_1,
      h2: HeadingLevel.HEADING_2,
      h3: HeadingLevel.HEADING_3,
      h4: HeadingLevel.HEADING_4,
      h5: HeadingLevel.HEADING_5,
      h6: HeadingLevel.HEADING_6
    } as const;
    const options = {
      children: inlineChildren(element),
      alignment: alignment(computed.textAlign),
      heading: headingMap[tag as keyof typeof headingMap],
      keepNext: tag.startsWith("h"),
      widowControl: true,
      spacing: {
        before: Math.max(0, Math.round(Number.parseFloat(computed.marginTop || "0") * 15)),
        after: Math.max(80, Math.round(Number.parseFloat(computed.marginBottom || "8") * 15)),
        line: Math.max(240, Math.round(Number.parseFloat(computed.lineHeight || "24") * 15))
      },
      indent: tag === "blockquote" ? { left: 360, right: 180 } : undefined,
      border: tag === "blockquote"
        ? { left: { style: BorderStyle.SINGLE, color: colorHex(computed.borderLeftColor, "2563EB"), size: 12, space: 8 } }
        : undefined,
      shading: tag === "blockquote"
        ? { fill: colorHex(computed.backgroundColor, "F5F7FA"), type: ShadingType.CLEAR }
        : undefined,
      bullet: list === "bullet" ? { level: 0 } : undefined,
      numbering: list === "number" ? { reference: "ordered-list", level: 0 } : undefined
    };
    return new Paragraph(options);
  };
  const tableFromElement = (tableElement: HTMLTableElement) => {
    const htmlRows = Array.from(tableElement.rows);
    const columnCount = Math.max(1, ...htmlRows.map((row) => row.cells.length));
    const columnWidths = Array.from({ length: columnCount }, () => Math.floor(9360 / columnCount));
    columnWidths[columnWidths.length - 1] += 9360 - columnWidths.reduce((sum, value) => sum + value, 0);
    const border = { style: BorderStyle.SINGLE, color: "D8DEE9", size: 4 };
    return new Table({
      width: { size: 9360, type: WidthType.DXA },
      indent: { size: 120, type: WidthType.DXA },
      columnWidths,
      layout: TableLayoutType.FIXED,
      borders: {
        top: border,
        bottom: border,
        left: border,
        right: border,
        insideHorizontal: border,
        insideVertical: border
      },
      rows: htmlRows.map((row, rowIndex) =>
        new TableRow({
          tableHeader: rowIndex === 0,
          children: Array.from(row.cells).map((cell, cellIndex) =>
            new TableCell({
              width: { size: columnWidths[cellIndex] ?? columnWidths[0], type: WidthType.DXA },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 100, bottom: 100, left: 120, right: 120 },
              shading: rowIndex === 0
                ? { fill: colorHex(window.getComputedStyle(cell).backgroundColor, "F2F4F7"), type: ShadingType.CLEAR }
                : undefined,
              children: [
                new Paragraph({
                  children: inlineChildren(cell),
                  alignment: alignment(window.getComputedStyle(cell).textAlign),
                  spacing: { before: 0, after: 0, line: 280 },
                  run: { bold: rowIndex === 0 }
                })
              ]
            })
          )
        })
      )
    });
  };
  const convertElement = async (element: HTMLElement): Promise<unknown[]> => {
    if (window.getComputedStyle(element).display === "none") return [];
    if (element.matches(".katex-display,.qx-mermaid") || element.querySelector(".katex-display,.qx-mermaid")) {
      return [await rasterizeElement(element)];
    }
    if (element instanceof HTMLTableElement) return [tableFromElement(element)];
    if (element instanceof HTMLImageElement) return [await imageParagraph(element)];
    if (element.tagName === "PRE") {
      const computed = window.getComputedStyle(element);
      return [new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [9360],
        layout: TableLayoutType.FIXED,
        borders: TableBorders.NONE,
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 9360, type: WidthType.DXA },
                margins: { top: 180, bottom: 180, left: 220, right: 220 },
                shading: {
                  fill: colorHex(computed.backgroundColor, "1F2937"),
                  type: ShadingType.CLEAR
                },
                children: [
                  new Paragraph({
                    children: (element.textContent ?? "").split(/\r?\n/).map((line, index) =>
                      new TextRun({
                        text: line || " ",
                        break: index > 0 ? 1 : undefined,
                        font: "Consolas",
                        size: 18,
                        color: colorHex(computed.color, "E5E7EB")
                      })
                    ),
                    spacing: { before: 0, after: 0, line: 260 },
                    keepLines: true
                  })
                ]
              })
            ]
          })
        ]
      })];
    }
    if (element.tagName === "UL" || element.tagName === "OL") {
      const output: unknown[] = [];
      for (const item of Array.from(element.children)) {
        if (!(item instanceof HTMLElement) || item.tagName !== "LI") continue;
        output.push(paragraphFromElement(item, element.tagName === "UL" ? "bullet" : "number"));
        for (const nested of Array.from(item.children)) {
          if (nested instanceof HTMLElement && /^(UL|OL)$/.test(nested.tagName)) {
            output.push(...await convertElement(nested));
          }
        }
      }
      return output;
    }
    if (/^(H1|H2|H3|H4|H5|H6|P|BLOCKQUOTE)$/.test(element.tagName)) {
      const image = element.querySelector(":scope > img");
      if (image instanceof HTMLImageElement && element.textContent?.trim() === "") {
        return [await imageParagraph(image)];
      }
      return [paragraphFromElement(element)];
    }
    const output: unknown[] = [];
    for (const child of Array.from(element.children)) {
      if (child instanceof HTMLElement) output.push(...await convertElement(child));
    }
    if (output.length === 0 && element.textContent?.trim()) output.push(paragraphFromElement(element));
    return output;
  };

  try {
    await document.fonts.ready;
    await waitForImages(container);
    const children: unknown[] = [];
    for (const child of Array.from(container.children)) {
      if (child instanceof HTMLElement) children.push(...await convertElement(child));
    }
    const bodyStyle = window.getComputedStyle(container);
    const safeTitle = title.replace(/\.(md|markdown)$/i, "");
    const documentFile = new Document({
      title: safeTitle,
      creator: "青弦编辑器",
      styles: {
        default: {
          document: {
            run: {
              font: firstFont(bodyStyle.fontFamily),
              size: halfPoints(bodyStyle.fontSize),
              color: colorHex(bodyStyle.color)
            },
            paragraph: {
              spacing: { after: 120, line: 300 }
            }
          }
        }
      },
      numbering: {
        config: [{
          reference: "ordered-list",
          levels: [{
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 720, hanging: 360 },
                spacing: { after: 80, line: 300 }
              }
            }
          }]
        }]
      },
      sections: [{
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: {
              top: 1080,
              right: 1080,
              bottom: 1080,
              left: 1080,
              header: 480,
              footer: 480
            }
          }
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                border: { bottom: { style: BorderStyle.SINGLE, color: "E5E7EB", size: 3, space: 4 } },
                children: [new TextRun({ text: safeTitle, color: "777777", size: 18 })]
              })
            ]
          })
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    color: "777777",
                    size: 18,
                    children: [PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES]
                  })
                ]
              })
            ]
          })
        },
        children: children as never[]
      }]
    });
    return Array.from(new Uint8Array(await Packer.toArrayBuffer(documentFile)));
  } finally {
    container.remove();
    style.remove();
  }
}
