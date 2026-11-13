# 架构基线

## 依赖方向

```text
apps/desktop
  ├─ editor-core
  ├─ wechat-renderer
  │   ├─ markdown-engine
  │   ├─ theme-engine
  │   └─ shared-types
  ├─ module-library
  └─ export-engine

src-tauri
  ├─ file service
  ├─ export service
  └─ adapters（后续：凭据、微信、图床、AI）
```

## 约束

- Markdown 是正文唯一真相源。
- 渲染器不依赖 React 或 Tauri。
- 前端只能调用白名单 Tauri 命令。
- 预览使用无脚本权限的沙箱 iframe。
- 文件保存采用临时文件写入后替换。
- 密钥不进入普通配置、前端状态或日志。

## 当前范围

项目已包含桌面界面、文章库、本地文件命令与导出流程。桌面端文件操作、Word／PDF 转换和公众号粘贴仍需按 `ROADMAP.md` 做实际验收。

