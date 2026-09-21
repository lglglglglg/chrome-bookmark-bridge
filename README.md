# 书签桥

<p align="center">
  <img src="icon-128.png" alt="书签桥 Logo" width="128" height="128">
</p>

<p align="center">
  <b>在 Chrome 与 Edge 配置文件之间，安全地传递和合并书签。</b><br>
  不必切换 Google 账号；书签只在你的浏览器和你选择的同步码/文件之间流转。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white" alt="Chrome Manifest V3">
  <img src="https://img.shields.io/badge/Edge-Chromium-0078D4?logo=microsoftedge&logoColor=white" alt="Microsoft Edge">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License">
  <img src="https://img.shields.io/badge/Version-0.4.7-purple" alt="Version 0.4.7">
</p>

---

## 🌟 为什么选择书签桥？

当你在同一台电脑上使用不同 Chrome 或 Edge 配置文件时，书签通常不能按需、可控地在它们之间传递。切换 Google 账号也不能解决“只迁移某一个文件夹”“合并前先确认差异”这些需求。

**书签桥**把书签打包为由你掌控的同步码或文件：来源端生成，目标端预览并确认合并。

- **不依赖账号切换**：读取的是当前浏览器配置文件中的书签，不读取 Gmail 或 Google 账号凭据。
- **先预览，再写入**：合并前显示新增、复用和重复项目，避免盲目导入。
- **可选密码加密**：设置密码后使用 Web Crypto AES-GCM 加密；密码不写入同步码。
- **本地优先**：没有服务器、广告 SDK、分析服务或账号系统，不上传书签内容。

---

## ✨ 核心特性

### 1. 灵活传递书签

- **选择任意位置**：发送书签栏、其他书签或指定子文件夹；支持搜索和浏览完整文件夹树。
- **同步码与文件两种方式**：可复制同步码，也可保存为 `.bookmarkbridge` 文件；超长内容会提示优先使用文件。
- **Chrome 与 Edge 互通**：两个 Chromium 浏览器使用相同的数据格式，可相互发送和接收。

### 2. 可控地合并

- **逐条差异预览**：展示预计新增的书签/文件夹、复用的文件夹与跳过的重复项。
- **两种合并策略**：智能合并会跳过同一文件夹内“网址 + 标题”相同的书签；全部添加会保留所有内容。
- **可撤销的会话历史**：每次合并都可单独撤销；若目录中有之后手动加入的内容，会优先保护这些内容。

### 3. 面向真实浏览器使用场景

- **大书签树保护**：压缩、加密、预览和合并均显示进度，处理中可取消；异常超大同步码会被拒绝。
- **macOS 友好导入**：支持直接拖拽文件；选择文件时通过扩展侧边栏完成，避免在 Popup 中直接唤起系统文件面板。
- **清晰图标与界面**：Chrome 和 Edge 均使用完整方形应用图标，适配工具栏和扩展管理页。

---

## 🔒 隐私与权限

书签桥不提供云同步、遥测、广告或账号系统。同步内容只在本地浏览器中处理，并由你自行复制、粘贴或保存为文件。

完整说明请阅读[隐私政策](PRIVACY_POLICY.md)。扩展仅使用以下权限：

1. **`bookmarks`**：在你主动发送、预览或确认合并时读取和创建书签。
2. **`clipboardWrite`**：仅在你点击“复制同步码”时写入剪贴板。
3. **`sidePanel`**：仅在你主动选择侧边栏导入时显示扩展自己的文件选择界面。

请不要把同步码和密码一起发送给不可信对象；忘记密码后，任何人都无法恢复加密内容。

---

## 🚀 下载与安装

### Chrome Web Store 与 Edge Add-ons

商店版本正在准备中。发布后会在此补充 Chrome Web Store 和 Microsoft Edge Add-ons 的正式安装链接。

### 手动安装预发布包

前往 [GitHub Releases](https://github.com/lglglglglg/chrome-bookmark-bridge/releases) 下载对应浏览器的最新 ZIP：

- Chrome：`书签桥-v0.4.7.zip`
- Edge：`书签桥-edge-v0.4.7.zip`

解压 ZIP 后：

1. 打开 `chrome://extensions` 或 `edge://extensions`，开启“开发者模式”。
2. 点击“加载已解压的扩展程序”。
3. 选择刚刚解压后的文件夹，并将书签桥固定到工具栏。

> 手动安装包适合测试和开发者模式使用。正式面向普通用户的安装与更新请等待对应浏览器商店版本。

### 从源码运行

```bash
git clone https://github.com/lglglglglg/chrome-bookmark-bridge.git
cd chrome-bookmark-bridge

# 校验 Manifest、运行时代码和发布包
bash scripts/check-extension.sh
```

随后按上方“加载已解压的扩展程序”的步骤，直接选择项目根目录。

---

## 🧭 基本使用

| 动作 | 操作方式 |
| :--- | :--- |
| **发送书签** | 在来源配置文件选择书签位置，可选设置密码，生成同步码或保存文件。 |
| **接收并预览** | 在目标配置文件粘贴同步码、拖入文件，或使用侧边栏选择文件，再输入密码预览。 |
| **合并书签** | 选择目标位置与合并策略，确认后写入书签。 |
| **撤销本次合并** | 在当前弹窗会话的合并历史中点击“撤销”。 |

> 书签桥传递的是当前浏览器配置文件的书签集合；同一配置文件中登录几个 Google 账号，不会改变这个事实。

---

## 📄 开源许可证与署名

- **版权所有**：© 2026 **Stephan Li**（韩十久工作室 · Hanshijiu Studio）
- **开源协议**：本项目基于 [MIT License](LICENSE) 协议开源，欢迎使用、修改与二次开发；请保留原始版权和许可证声明。
- **公开联系邮箱**：`lixiaolongstephan@gmail.com`

---

## 👨‍💻 创作团队

- **工作室**：韩十久工作室（Hanshijiu Studio）
- **主理人**：Stephan Li
- **项目仓库**：[lglglglglg/chrome-bookmark-bridge](https://github.com/lglglglglg/chrome-bookmark-bridge)

欢迎提交 Issue 和 Pull Request。请不要在公开 Issue、截图或日志中提交真实书签网址、同步码、密码或账号信息。

---

## 📚 项目文档

- [公开项目信息](PROJECT_INFO.md)
- [隐私政策](PRIVACY_POLICY.md)
- [安全说明](SECURITY.md)
- [贡献指南](CONTRIBUTING.md)
- [v0.4.7 Release 文案与检查单](docs/RELEASE_NOTES_v0.4.7.md)
- [Chrome Web Store 提交操作单](CHROME_WEB_STORE_SUBMISSION.md)
- [Microsoft Edge Add-ons 上架资料](EDGE_STORE_LISTING.md)
- [变更记录](CHANGELOG.md)
- [测试清单](TEST_PLAN.md)

修复记录、测试细节和发布检查均放在独立文档中，不在 README 逐条展开。
