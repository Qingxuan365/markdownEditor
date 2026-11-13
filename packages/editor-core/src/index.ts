import { create } from "zustand";

export type SaveStatus = "saved" | "dirty" | "saving" | "error";

type EditorState = {
  content: string;
  filePath: string | null;
  saveStatus: SaveStatus;
  setContent: (content: string) => void;
  loadDocument: (content: string, filePath: string) => void;
  loadLocalDocument: (content: string) => void;
  newDocument: () => void;
  setSaveStatus: (saveStatus: SaveStatus) => void;
  markSaved: (filePath?: string) => void;
};

export const useEditorStore = create<EditorState>((set) => ({
  content: "",
  filePath: null,
  saveStatus: "saved",
  setContent: (content) => set({ content, saveStatus: "dirty" }),
  loadDocument: (content, filePath) =>
    set({
      content,
      filePath,
      saveStatus: "saved"
    }),
  loadLocalDocument: (content) =>
    set({
      content,
      filePath: null,
      saveStatus: "saved"
    }),
  newDocument: () =>
    set({
      content: "\n",
      filePath: null,
      saveStatus: "saved"
    }),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  markSaved: (filePath) =>
    set((state) => ({
      filePath: filePath ?? state.filePath,
      saveStatus: "saved"
    }))
}));
