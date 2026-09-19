# Microsoft Edge Add-ons 上架资料

## 基本信息

- 产品名：书签桥 · 加密书签同步
- 建议分类：生产力工具
- 版本：0.4.6
- 发布包：`dist/书签桥-edge-v0.4.6.zip`
- 项目主页：`https://github.com/lglglglglg/chrome-bookmark-bridge`
- 隐私政策：`https://lglglglglg.github.io/chrome-bookmark-bridge/`

## 简短描述

用加密同步码在不同 Edge/Chrome 配置文件之间传递和合并书签，不上传服务器。

## 详细描述

书签桥是一个本地优先的 Chromium 浏览器扩展，帮助你在不同 Edge 或 Chrome 配置文件之间迁移书签。

- AES-GCM 加密同步码，密码不写入同步码。
- 支持复制同步码和 `.bookmarkbridge` 文件导入。
- 支持选择书签栏、其他书签和任意子文件夹。
- 合并前逐条预览新增、复用和重复项。
- 支持多次合并历史，可分别撤销；大书签树支持进度提示与取消。
- 同步码较长时提示优先使用文件导入。
- 不上传书签、账号信息或浏览历史。
- 弹窗关闭后不自动恢复旧同步码，避免误操作。

## Edge 发布注意

Edge 版本不维护第二套代码。当前 ZIP 与 Chrome 版运行文件相同，只是面向 Microsoft Edge Add-ons 的独立发布包和商店文案。后续修复应先修改根目录代码，再重新生成两个商店 ZIP。

## 提交前清单

- [ ] 在 `edge://extensions` 用开发者模式加载本目录测试。
- [ ] 在两个 Edge 配置文件中完成加密发送、文件导入、差异预览、合并和撤销测试。
- [ ] 在 Partner Center 创建 Microsoft Edge 扩展开发者账号。
- [ ] 上传 `dist/书签桥-edge-v0.4.6.zip`。
- [ ] 填写 Edge 商店截图、隐私政策和权限用途。
