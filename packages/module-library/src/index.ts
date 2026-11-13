export type ContentModule = {
  id: string;
  name: string;
  markdownTemplate: string;
};

export const contentModules: ContentModule[] = [
  {
    id: "tip",
    name: "提示框",
    markdownTemplate: ":::tip 标题\n这里是提示内容。\n:::"
  },
  {
    id: "warning",
    name: "警告框",
    markdownTemplate: ":::warning 注意\n这里是警告内容。\n:::"
  }
];

