# Qingxian Editor

本地优先的微信公众号 Markdown 桌面编辑器。

当前支持 Markdown 编辑与实时预览、主题切换、文章库、本地保存，以及 HTML、PDF 和分页图片导出。Mermaid 图表可在导出时转为图片。桌面操作与公众号粘贴的验收状态见 [ROADMAP.md](ROADMAP.md)。

## 技术栈

- Tauri 2
- React + TypeScript + Vite
- CodeMirror 6
- Zustand
- markdown-it
- Vitest

## 开发

```powershell
pnpm install
pnpm dev
```

桌面端还需要先安装 Rust 和 Tauri 的 Windows 系统依赖，然后运行：

```powershell
pnpm tauri dev
```

提交前的完整检查运行 `pnpm verify`，包括类型检查、测试、lint、构建和离线资源扫描。项目架构与离线约束分别见 [架构说明](docs/architecture.md) 和 [离线运行说明](docs/offline-runtime.md)。

## 目录

- `apps/desktop`：桌面 UI 与 Tauri 容器
- `packages/markdown-engine`：Markdown 解析
- `packages/wechat-renderer`：微信兼容渲染与诊断
- `packages/theme-engine`：主题定义与变量合并
- `packages/editor-core`：编辑器领域状态与命令
- `packages/module-library`：结构化排版模块
- `packages/export-engine`：导出任务接口
- `packages/shared-types`：跨模块共享类型

