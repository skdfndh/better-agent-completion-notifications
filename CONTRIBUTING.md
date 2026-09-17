# 贡献指南

## 开发环境

- Node.js 22.6 或更高版本。
- Windows 原生提醒宿主需要 Windows PowerShell 与 WPF。

```powershell
npm test
npm run ui
```

## 提交前检查

运行 `npm test`。涉及原生宿主时，还应使用 PowerShell 语法解析器检查 `.ps1` 文件。

## 提交信息

使用简短动词开头的提交信息，例如 `feat: add event stream`、`fix: close native reminder` 或 `docs: improve setup guide`。

## Pull Request

说明改动目的、验证方式和影响范围。不要提交 `.codex/` 事件日志、偏好文件、扫描报告或任何本机路径。
