let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
let renderSequence = 0;

export function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "neutral",
        suppressErrorRendering: true,
        flowchart: {
          htmlLabels: true,
          useMaxWidth: true
        },
        sequence: {
          useMaxWidth: true
        }
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

export async function renderMermaidSvg(source: string) {
  const mermaid = await loadMermaid();
  renderSequence += 1;
  return mermaid.render(`qx-mermaid-${Date.now()}-${renderSequence}`, source);
}

function getSvgSize(svg: SVGSVGElement) {
  const viewBox = svg.viewBox.baseVal;
  if (viewBox.width > 0 && viewBox.height > 0) {
    return { width: viewBox.width, height: viewBox.height };
  }
  const width = Number.parseFloat(svg.getAttribute("width") ?? "");
  const height = Number.parseFloat(svg.getAttribute("height") ?? "");
  return {
    width: Number.isFinite(width) && width > 0 ? width : 800,
    height: Number.isFinite(height) && height > 0 ? height : 450
  };
}

export async function mermaidSvgToPngDataUrl(svgMarkup: string) {
  const svgDocument = new DOMParser().parseFromString(svgMarkup, "image/svg+xml");
  const svg = svgDocument.documentElement as unknown as SVGSVGElement;
  const size = getSvgSize(svg);
  const targetWidth = Math.min(900, Math.max(320, Math.ceil(size.width)));
  const targetHeight = Math.max(120, Math.ceil(targetWidth * size.height / size.width));
  const scale = 2;

  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", String(targetWidth));
  svg.setAttribute("height", String(targetHeight));
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const serialized = new XMLSerializer().serializeToString(svg);
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
  await image.decode();

  const canvas = window.document.createElement("canvas");
  canvas.width = targetWidth * scale;
  canvas.height = targetHeight * scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前环境无法创建图片画布");
  context.scale(scale, scale);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  return canvas.toDataURL("image/png", 1);
}

export async function convertMermaidToWechatImages(html: string) {
  const htmlDocument = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const diagrams = Array.from(htmlDocument.querySelectorAll<HTMLElement>(".qx-mermaid"));

  await Promise.all(
    diagrams.map(async (diagram) => {
      const source = diagram.querySelector<HTMLElement>(".qx-mermaid-source")?.textContent?.trim();
      if (!source) throw new Error("Mermaid 图表缺少源码");
      const { svg } = await renderMermaidSvg(source);
      const png = await mermaidSvgToPngDataUrl(svg);
      const replacement = htmlDocument.createElement("section");
      replacement.setAttribute("style", "margin:20px 0;text-align:center");
      const image = htmlDocument.createElement("img");
      image.src = png;
      image.alt = "Mermaid 图表";
      image.setAttribute("style", "display:block;width:100%;max-width:900px;height:auto;margin:0 auto");
      replacement.append(image);
      diagram.replaceWith(replacement);
    })
  );

  return {
    html: htmlDocument.body.innerHTML,
    convertedCount: diagrams.length
  };
}
