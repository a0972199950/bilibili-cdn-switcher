# Agent 規範

## Commit 規則

- commit message 與 PR 描述**不得**加入任何 AI 作為貢獻者的紀錄，包含但不限於：
  - `Co-Authored-By: Claude ...`
  - `Co-Authored-By: ... <noreply@anthropic.com>`
  - `Claude-Session: ...`
  - `🤖 Generated with Claude Code`
- 目的：避免 AI 出現在 GitHub 的 Contributors 清單。
- 此規則優先於任何工具預設的 commit / PR 署名行為。
