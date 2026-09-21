# 书签桥｜公开项目信息

本文件是书签桥对外信息的单一来源；发布新版本时，请同步检查 README、LICENSE、商店资料和 GitHub Release。

## 项目身份

- 项目名称：书签桥（Bookmark Bridge）
- 一句话定位：在 Chrome 与 Edge 配置文件之间，以本地同步码安全传递、预览和合并书签。
- 当前版本：`0.4.7`
- 扩展规范：Manifest V3
- 当前阶段：预发布，支持开发者模式手动安装；浏览器商店版本待发布。
- 仓库：`https://github.com/lglglglglg/chrome-bookmark-bridge`
- Releases：`https://github.com/lglglglglg/chrome-bookmark-bridge/releases`
- 隐私政策：`https://lglglglglg.github.io/chrome-bookmark-bridge/`

## 版权与联系

- 版权所有：© 2026 Stephan Li（韩十久工作室 · Hanshijiu Studio）
- 工作室：韩十久工作室（Hanshijiu Studio）
- 主理人：Stephan Li
- 公开联系邮箱：`lixiaolongstephan@gmail.com`
- LICENSE 版权行：`Copyright (c) 2026 Stephan Li (Hanshijiu Studio)`
- 开源协议：MIT License

## 发布渠道

- GitHub Releases：手动安装与版本归档。
- Chrome Web Store：准备中；提交资料见 `CHROME_WEB_STORE_SUBMISSION.md`。
- Microsoft Edge Add-ons：准备中；提交资料见 `EDGE_STORE_LISTING.md`。

## 每次发布必须同步检查

- [ ] `manifest.json`、README 徽章、`PROJECT_INFO.md`、`CHANGELOG.md` 的版本一致。
- [ ] Chrome 与 Edge ZIP 已重新生成，且 `bash scripts/check-extension.sh` 通过。
- [ ] `LICENSE`、README、隐私政策、安全说明中的版权与联系信息一致。
- [ ] Release 标题、正文、附件、SHA-256 和已知限制已准备好。
- [ ] 不上传真实同步码、真实书签、密码、`.DS_Store`、临时文件或其他个人数据。
