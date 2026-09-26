# 书签桥

<p align="center">
  <img src="assets/icon-readme.png" alt="书签桥 Logo" width="128" height="128">
</p>

<p align="center">
  <b>在 Chrome 与 Edge 配置文件之间传递和合并书签</b><br>
  不必切换 Google 账号；先查看差异，再决定如何写入目标浏览器。
</p>

<p align="center">
  <a href="https://github.com/lglglglglg/chrome-bookmark-bridge/releases">下载</a> ·
  <a href="https://github.com/lglglglglg/chrome-bookmark-bridge/issues">问题反馈</a> ·
  <a href="PRIVACY_POLICY.md">隐私政策</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white" alt="Chrome Manifest V3">
  <img src="https://img.shields.io/badge/Edge-Chromium-0078D4?logo=microsoftedge&logoColor=white" alt="Microsoft Edge">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License">
  <img src="https://img.shields.io/badge/Version-0.4.7-purple" alt="Version 0.4.7">
</p>

## 关于书签桥

书签桥是一款本地优先的浏览器扩展，用于在不同 Chrome 或 Edge 配置文件之间传递书签。来源端生成同步码或文件，目标端先预览新增、复用和重复项目，确认后再合并。

它不依赖账号系统，也不会把书签上传到服务器。

## 主要功能

- 发送书签栏、其他书签或任意子文件夹。
- 使用同步码或 `.bookmarkbridge` 文件传递内容。
- 在 Chrome 与 Edge 之间使用同一种数据格式。
- 合并前预览新增书签、复用文件夹和重复项目。
- 提供“智能合并”和“全部添加”两种策略。
- 支持为同步内容设置密码，并使用 Web Crypto AES-GCM 加密。
- 为压缩、加密、预览和合并显示进度，处理过程中可以取消。
- 保留当前会话的合并历史，可撤销单次合并并保护之后手动加入的内容。

## 下载与安装

当前版本通过 GitHub Releases 提供手动安装包，暂未上架 Chrome Web Store 或 Microsoft Edge Add-ons，因此需要开启浏览器的开发者模式。

前往 [GitHub Releases](https://github.com/lglglglglg/chrome-bookmark-bridge/releases) 下载对应浏览器的最新 ZIP：

- Chrome：`书签桥-v0.4.7.zip`
- Edge：`书签桥-edge-v0.4.7.zip`

安装步骤：

1. 解压下载的 ZIP。
2. 打开 `chrome://extensions` 或 `edge://extensions`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择刚刚解压的文件夹。
5. 将书签桥固定到浏览器工具栏。

## 快速使用

1. 在来源配置文件中选择要发送的书签位置。
2. 根据需要设置密码，生成同步码或保存 `.bookmarkbridge` 文件。
3. 在目标配置文件中粘贴同步码、拖入文件，或从侧边栏选择文件。
4. 查看差异，选择目标位置与合并策略，再确认写入。
5. 如需回退，在当前弹窗会话的合并历史中撤销本次合并。

书签桥读取的是当前浏览器配置文件中的书签；同一配置文件中登录不同 Google 账号不会改变这一范围。

## 隐私与权限

书签桥没有服务器、账号、广告、遥测或分析服务。同步内容只在本地浏览器中处理，并由用户自行复制、保存和传递。完整说明见[隐私政策](PRIVACY_POLICY.md)。

- **`bookmarks`**：在用户主动发送、预览或确认合并时读取和创建书签。
- **`clipboardWrite`**：仅在用户点击“复制同步码”时写入剪贴板。
- **`sidePanel`**：仅在用户主动选择侧边栏导入时显示扩展自己的文件选择界面。

请不要通过不可信渠道同时发送同步码和密码。密码遗失后，开发者无法恢复加密内容。

## 已知限制

- 当前只支持 Chrome 和基于 Chromium 的 Microsoft Edge。
- 手动安装版本需要保持开发者模式开启，也不会通过浏览器商店自动更新。
- 撤销记录只保留在当前弹窗会话中，关闭后不会自动恢复。

## 开发与校验

```bash
git clone https://github.com/lglglglglg/chrome-bookmark-bridge.git
cd chrome-bookmark-bridge
bash scripts/check-extension.sh
```

校验完成后，可在浏览器扩展管理页直接加载项目根目录。

## 开源与支持

- [问题反馈](https://github.com/lglglglglg/chrome-bookmark-bridge/issues)
- [贡献指南](CONTRIBUTING.md)
- [隐私政策](PRIVACY_POLICY.md)
- [安全说明](SECURITY.md)
- [更新记录](CHANGELOG.md)

提交 Issue、截图或日志时，请勿附带真实书签网址、同步码、密码或账号信息。

## 许可证与版权

书签桥基于 [MIT License](LICENSE) 开源。

© 2026 **Stephan Li** · 韩十久工作室（Hanshijiu Studio）

联系邮箱：`lixiaolongstephan@gmail.com`
