# 青弦编辑器项目规范

这是面向公众号创作者的本地优先 Markdown 桌面编辑器。当前功能与运行命令见 `README.md`，项目状态见 `ROADMAP.md`；依赖方向见 `docs/architecture.md`，离线资源约束见 `docs/offline-runtime.md`。

## 结构与边界

- `apps/desktop/` 承担 Tauri 容器、界面和本地文件操作；`packages/` 按 Markdown 解析、微信渲染、主题、编辑器状态、模块、导出和共享类型分工。
- Markdown 正文是文章内容的唯一真实源；主题和预览转换不回写正文。
- 渲染器保持独立于 React 和 Tauri；桌面能力通过白名单 Tauri 命令调用。
- 预览使用无脚本权限的沙箱 iframe；运行时资源随应用本地打包，外部图片属于用户内容。
- 本地文章、凭据、导出结果、安装包和临时文件留在用户设备；提交前按 `.gitignore` 核对文件清单。

## 验证入口

- 代码改动后运行 `pnpm verify`，覆盖类型检查、测试、lint、构建和离线资源检查。
- 涉及 Tauri 文件命令、Word／PDF 转换或公众号粘贴时，再做对应桌面端实际验收，并将结果写入 `ROADMAP.md`。
