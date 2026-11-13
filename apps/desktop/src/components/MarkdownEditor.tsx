import {
  defaultKeymap,
  history,
  historyKeymap,
  redo,
  selectAll,
  undo
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { openSearchPanel, search } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type EditorCommand =
  | "undo"
  | "redo"
  | "selectAll"
  | "copy"
  | "cut"
  | "paste"
  | "format"
  | "clear"
  | "find"
  | "replace"
  | "alignLeft"
  | "alignCenter"
  | "alignRight"
  | "bold"
  | "italic"
  | "strike"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "quote"
  | "link"
  | "image"
  | "formula"
  | "table"
  | "insertText"
  | "textColor"
  | "inlineCode"
  | "codeBlock"
  | "horizontalRule"
  | "footnote"
  | "toc"
  | "mermaid"
  | "plantuml"
  | "superscript"
  | "subscript"
  | "dateTime"
  | "readingTime";

export type MarkdownEditorHandle = {
  execute: (command: EditorCommand, value?: string, source?: string) => void;
  focus: () => void;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
};

function wrapSelection(view: EditorView, prefix: string, suffix = prefix, placeholder = "文本") {
  const selection = view.state.selection.main;
  const selected = view.state.sliceDoc(selection.from, selection.to);
  const body = selected || placeholder;
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: `${prefix}${body}${suffix}` },
    selection: selected
      ? { anchor: selection.from, head: selection.from + prefix.length + body.length + suffix.length }
      : {
          anchor: selection.from + prefix.length,
          head: selection.from + prefix.length + body.length
        }
  });
  view.focus();
}

function prefixSelectedLines(view: EditorView, prefix: string) {
  const selection = view.state.selection.main;
  const startLine = view.state.doc.lineAt(selection.from);
  const endLine = view.state.doc.lineAt(selection.to);
  const changes = [];
  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
    changes.push({ from: view.state.doc.line(lineNumber).from, insert: prefix });
  }
  if (selection.empty) {
    const cursorPosition = selection.from + prefix.length;
    view.dispatch({
      changes,
      selection: { anchor: cursorPosition }
    });
    window.requestAnimationFrame(() => {
      view.dispatch({ selection: { anchor: cursorPosition } });
      view.focus();
    });
    return;
  }

  view.dispatch({ changes });
  window.requestAnimationFrame(() => view.focus());
}

function insertAtSelection(view: EditorView, text: string, cursorOffset = text.length) {
  const selection = view.state.selection.main;
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: text },
    selection: { anchor: selection.from + cursorOffset }
  });
  view.focus();
}

function wrapBlockSelection(view: EditorView, opening: string, closing: string) {
  const selection = view.state.selection.main;
  const startLine = view.state.doc.lineAt(selection.from);
  const endLine = view.state.doc.lineAt(selection.to);
  const from = startLine.from;
  const to = endLine.to;
  const selected = view.state.sliceDoc(from, to);
  const insert = `${opening}\n${selected}\n${closing}`;
  view.dispatch({
    changes: { from, to, insert },
    selection: {
      anchor: from + opening.length + 1,
      head: from + opening.length + 1 + selected.length
    }
  });
  window.requestAnimationFrame(() => view.focus());
}

async function writeSelectionToClipboard(view: EditorView, cut: boolean) {
  const selection = view.state.selection.main;
  const selected = view.state.sliceDoc(selection.from, selection.to);
  if (!selected) return;
  await navigator.clipboard.writeText(selected);
  if (cut) {
    view.dispatch({ changes: { from: selection.from, to: selection.to, insert: "" } });
  }
  view.focus();
}

async function pasteFromClipboard(view: EditorView) {
  const text = await navigator.clipboard.readText();
  insertAtSelection(view, text);
}

function formatMarkdownSource(view: EditorView) {
  const formatted = view.state.doc
    .toString()
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^(#{1,6})([^\s#])/gm, "$1 $2")
    .replace(/^([>-])([^\s])/gm, "$1 $2")
    .trimEnd()
    .concat("\n");
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: formatted } });
  view.focus();
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(function MarkdownEditor(
  { value, onChange },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const initialValueRef = useRef(value);

  onChangeRef.current = onChange;

  useImperativeHandle(ref, () => ({
    focus: () => viewRef.current?.focus(),
    execute: (command, value) => {
      const view = viewRef.current;
      if (!view) return;

      switch (command) {
        case "undo": undo(view); break;
        case "redo": redo(view); break;
        case "selectAll": selectAll(view); break;
        case "copy": void writeSelectionToClipboard(view, false); break;
        case "cut": void writeSelectionToClipboard(view, true); break;
        case "paste": void pasteFromClipboard(view); break;
        case "format": formatMarkdownSource(view); break;
        case "clear":
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" } });
          view.focus();
          break;
        case "find": openSearchPanel(view); break;
        case "replace":
          openSearchPanel(view);
          window.setTimeout(() => {
            document.querySelector<HTMLInputElement>(".cm-textfield[name='replace']")?.focus();
          });
          break;
        case "alignLeft": wrapBlockSelection(view, ":::align left", ":::"); break;
        case "alignCenter": wrapBlockSelection(view, ":::align center", ":::"); break;
        case "alignRight": wrapBlockSelection(view, ":::align right", ":::"); break;
        case "bold": wrapSelection(view, "**", "**", "粗体文本"); break;
        case "italic": wrapSelection(view, "*", "*", "斜体文本"); break;
        case "strike": wrapSelection(view, "~~", "~~", "删除线文本"); break;
        case "heading1": prefixSelectedLines(view, "# "); break;
        case "heading2": prefixSelectedLines(view, "## "); break;
        case "heading3": prefixSelectedLines(view, "### "); break;
        case "heading4": prefixSelectedLines(view, "#### "); break;
        case "heading5": prefixSelectedLines(view, "##### "); break;
        case "heading6": prefixSelectedLines(view, "###### "); break;
        case "bulletList": prefixSelectedLines(view, "- "); break;
        case "orderedList": prefixSelectedLines(view, "1. "); break;
        case "taskList": prefixSelectedLines(view, "- [ ] "); break;
        case "quote": prefixSelectedLines(view, "> "); break;
        case "link": wrapSelection(view, "[", "](https://)", "链接文字"); break;
        case "image": insertAtSelection(view, "![图片描述](图片地址)", 2); break;
        case "formula": insertAtSelection(view, "\n$$\nE = mc^2\n$$\n", 5); break;
        case "table": {
          const match = value?.match(/^(\d+)x(\d+)$/);
          const rows = match ? Math.max(1, parseInt(match[1], 10)) : 3;
          const cols = match ? Math.max(1, parseInt(match[2], 10)) : 3;
          
          let tableStr = "\n";
          tableStr += "|" + Array(cols).fill(" 列 ").join("|") + "|\n";
          tableStr += "|" + Array(cols).fill(" --- ").join("|") + "|\n";
          for (let r = 0; r < rows; r++) {
            tableStr += "|" + Array(cols).fill(" 内容 ").join("|") + "|\n";
          }
          
          insertAtSelection(view, tableStr, 3);
          break;
        }
        case "insertText": insertAtSelection(view, value ?? ""); break;
        case "textColor":
          wrapSelection(
            view,
            `{{color:${/^#[0-9a-f]{6}$/i.test(value ?? "") ? value : "#2563eb"}}}`,
            "{{/color}}",
            "彩色文字"
          );
          break;
        case "inlineCode": wrapSelection(view, "`", "`", "代码"); break;
        case "codeBlock": {
          const selection = view.state.selection.main;
          if (!selection.empty) {
            wrapBlockSelection(view, "```text", "```");
            break;
          }
          const insertion = "```text\n代码\n```\n";
          view.dispatch({
            changes: { from: selection.from, to: selection.to, insert: insertion },
            selection: {
              anchor: selection.from + 8,
              head: selection.from + 10
            }
          });
          view.focus();
          break;
        }
        case "horizontalRule": insertAtSelection(view, "\n---\n"); break;
        case "footnote": {
          const index = (view.state.doc.toString().match(/\[\^\d+\]:/g)?.length ?? 0) + 1;
          const selection = view.state.selection.main;
          const selected = view.state.sliceDoc(selection.from, selection.to);
          const reference = selected ? `${selected}[^${index}]` : `脚注引用[^${index}]`;
          const insertion = `${reference}\n\n[^${index}]: 脚注内容`;
          const cursorOffset = selected
            ? reference.length + `\n\n[^${index}]: `.length
            : "脚注引用".length;
          insertAtSelection(view, insertion, cursorOffset);
          break;
        }
        case "toc": insertAtSelection(view, "\n[TOC]\n"); break;
        case "mermaid":
          insertAtSelection(
            view,
            "\n```mermaid\nflowchart TD\n  A[开始] --> B[结束]\n```\n",
            13
          );
          break;
        case "plantuml":
          insertAtSelection(
            view,
            "\n```plantuml\n@startuml\nAlice -> Bob: 消息\n@enduml\n```\n",
            14
          );
          break;
        case "superscript":
          wrapSelection(view, "{{sup}}", "{{/sup}}", "上标");
          break;
        case "subscript":
          wrapSelection(view, "{{sub}}", "{{/sub}}", "下标");
          break;
        case "dateTime": {
          const now = new Date();
          const pad = (value: number) => String(value).padStart(2, "0");
          insertAtSelection(
            view,
            `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
          );
          break;
        }
        case "readingTime": {
          const source = view.state.doc.toString();
          const readableText = source
            .replace(/```[\s\S]*?```/g, " ")
            .replace(/`[^`\r\n]*`/g, " ")
            .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
            .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
            .replace(/<[^>]+>/g, " ")
            .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, "")
            .replace(/[*_~`[\]{}|\\]/g, "")
            .replace(/\s+/g, "");
          const minutes = Math.max(1, Math.ceil(readableText.length / 400));
          insertAtSelection(view, `本篇文章阅读时间预计 ${minutes} 分钟。`);
          break;
        }
      }
    }
  }));

  useEffect(() => {
    if (!hostRef.current) return;

    const state = EditorState.create({
      doc: initialValueRef.current,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        bracketMatching(),
        highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        markdown(),
        search(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "15px" },
          "& > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
            backgroundColor: "var(--editor-selection) !important"
          },
          "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
            backgroundColor: "var(--editor-selection-focused) !important"
          },
          "& .cm-content ::selection": {
            backgroundColor: "var(--editor-selection-focused) !important"
          },
          ".cm-scroller": {
            overflowX: "hidden",
            overflowY: "auto",
            fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace'
          },
          ".cm-content": { padding: "20px 8px 40px" },
          ".cm-gutters": { backgroundColor: "#fbfcfe", border: "none" },
          ".cm-activeLine": { backgroundColor: "#f3f6fb" }
        })
      ]
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value }
    });
  }, [value]);

  return <div className="editor-host" ref={hostRef} />;
});
