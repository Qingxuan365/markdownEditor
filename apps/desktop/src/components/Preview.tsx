import katexCss from "katex/dist/katex.min.css?inline";
import { useEffect, useRef } from "react";
import { renderMermaidSvg } from "../lib/mermaid";

type Props = {
  html: string;
};

const PREVIEW_CSS = `
  :host {
    display: block;
    width: 100%;
    min-height: 100%;
    height: auto;
    color: #222;
    background: #fff;
  }
  .preview-document {
    min-height: 100%;
    padding: 24px;
    box-sizing: border-box;
    background: #fff;
  }
  img { max-width: 100%; height: auto; }
  .qx-mermaid {
    display: block;
    width: 100%;
    margin: 20px 0;
    overflow: visible;
    text-align: center;
  }
  .qx-mermaid-source { display: none !important; }
  .qx-mermaid-canvas {
    display: flex;
    width: 100%;
    min-height: 80px;
    align-items: center;
    justify-content: center;
    overflow: visible;
  }
  .qx-mermaid-canvas[data-pending="true"]::after {
    content: "滚动到此处时渲染图表";
    color: #8a90a3;
    font-size: 13px;
  }
  .qx-mermaid-canvas svg {
    display: block;
    width: 100%;
    max-width: 100%;
    height: auto;
    margin: 0 auto;
  }
  .mermaid-load-error {
    padding: 16px;
    border: 1px dashed #dc2626;
    border-radius: 8px;
    color: #b91c1c;
    background: #fff7f7;
    text-align: left;
  }
  .image-load-error {
    display: flex;
    min-height: 96px;
    margin: 12px 0;
    padding: 16px;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    border: 1px dashed #c9ced6;
    border-radius: 8px;
    color: #68707d;
    background: #f6f8fa;
    text-align: center;
  }
  pre, code {
    max-width: 100%;
    white-space: pre-wrap !important;
    word-break: break-all;
    overflow-wrap: anywhere;
  }
  pre {
    overflow-x: hidden !important;
    padding: 14px;
    border-radius: 8px;
    background: #f6f8fa;
  }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 8px; border: 1px solid #d0d7de; }
  .katex { line-height: 1.2; text-indent: 0; }
  .katex-display {
    display: block;
    margin: 18px 0;
    padding: 4px 0 8px;
    max-width: 100%;
    overflow: visible;
    text-align: center;
  }
  .katex-display > .katex {
    display: block;
    max-width: 100%;
    font-size: 1.08em;
    text-align: center;
    white-space: nowrap;
  }
`;

export function Preview({ html }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current || shadowRef.current) return;
    const shadow = hostRef.current.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `${katexCss}\n${PREVIEW_CSS}`;
    const content = document.createElement("div");
    content.className = "preview-document";
    shadow.append(style, content);
    shadowRef.current = shadow;
    contentRef.current = content;
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    let cancelled = false;
    const activeRenders = new WeakSet<HTMLElement>();

    content.innerHTML = html;
    for (const image of content.querySelectorAll("img")) {
      image.addEventListener(
        "error",
        () => {
          const placeholder = document.createElement("div");
          placeholder.className = "image-load-error";
          placeholder.textContent = image.alt
            ? `图片加载失败：${image.alt}`
            : "图片加载失败，请检查网络或图片地址";
          image.replaceWith(placeholder);
        },
        { once: true }
      );
    }

    const diagrams = Array.from(content.querySelectorAll<HTMLElement>(".qx-mermaid"));
    const renderDiagram = async (diagram: HTMLElement) => {
      if (activeRenders.has(diagram)) return;
      const source = diagram.querySelector<HTMLElement>(".qx-mermaid-source")?.textContent?.trim();
      const canvas = diagram.querySelector<HTMLElement>(".qx-mermaid-canvas");
      if (!source || !canvas) return;
      activeRenders.add(diagram);
      canvas.removeAttribute("data-pending");

      try {
        const { svg, bindFunctions } = await renderMermaidSvg(source);
        if (cancelled || !diagram.isConnected) return;
        canvas.innerHTML = svg;
        const svgElement = canvas.querySelector("svg");
        svgElement?.removeAttribute("height");
        svgElement?.setAttribute("width", "100%");
        svgElement?.setAttribute("preserveAspectRatio", "xMidYMid meet");
        bindFunctions?.(canvas);
      } catch (error) {
        if (cancelled || !diagram.isConnected) return;
        canvas.className = "mermaid-load-error";
        canvas.textContent = `Mermaid 图表语法错误：${error instanceof Error ? error.message : String(error)}`;
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          void renderDiagram(entry.target as HTMLElement);
        }
      },
      { rootMargin: "500px 0px" }
    );

    for (const diagram of diagrams) {
      const canvas = diagram.querySelector<HTMLElement>(".qx-mermaid-canvas");
      canvas?.setAttribute("data-pending", "true");
      observer.observe(diagram);
    }

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [html]);

  return <div className="preview-frame" ref={hostRef} />;
}
