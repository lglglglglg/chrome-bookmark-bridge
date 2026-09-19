# 书签桥

## 建议 GitHub 仓库

- 仓库名：`chrome-bookmark-bridge`
- 简介：`A privacy-first Chrome extension for encrypted bookmark transfer and merging between Chrome profiles.`

Manifest V3 Chrome 扩展，用“端到端加密同步码”把当前 Chrome 配置文件的一组书签传到另一个配置文件，再预览和合并。

当前版本：`v0.3.0`

## 浏览器支持

- Chrome：主版本，完整支持。
- Microsoft Edge：Chromium 兼容版，使用同一套运行时代码和单独发布包。
- Firefox：暂未发布，后续通过 `browser`/`chrome` API 适配。
- Safari：暂未发布，需要 Safari Web Extension 容器和 Apple 平台签名。

## 为什么不需要切换 Google 账号

Chrome 扩展能读取的是当前 Chrome 配置文件的书签，而不是某个 Google 账号云端的书签 API。同步码把书签快照编码在本地文本里，因此接收端只要能打开扩展并粘贴同步码即可；Google 账号是否登录、登录了几个账号，都不会改变这条流程。

这也意味着插件不需要服务器、不读取 Gmail/密码、不保存账号凭据。同步码使用用户设置的密码通过 Web Crypto AES-GCM 加密，由用户自己复制、粘贴或保存文件。

## 使用

1. 打开 `chrome://extensions`，开启“开发者模式”，点击“加载已解压的扩展程序”，选择本目录。
2. 在来源 Chrome 配置文件打开扩展，选择“书签栏/其他书签”等位置，点击“生成同步码”。
3. 设置同步密码（至少 8 位），点击复制，或保存为 `.bookmarkbridge` 文件。
4. 在目标 Chrome 配置文件打开同一个扩展，粘贴同步码或导入 `.bookmarkbridge` 文件，输入同一密码，点击“预览同步内容”。
5. 选择目标位置和重复项策略，点击“确认合并”。默认智能合并，不删除目标端已有内容。

## 当前边界

- 这是本地传递工具，不提供自动后台双向同步。
- BM2 同步码使用 AES-GCM 加密；密码不写入同步码，也不会上传服务器。忘记密码无法恢复内容。
- 仍应避免把同步文件和密码发送给同一个不可信渠道。
- 书签数量很大时，优先使用“保存为文件”；浏览器剪贴板和文本框有容量限制。
- 目标端不会删除书签；“智能合并”按同一文件夹内“网址 + 标题”去重，并复用同名文件夹。
- 支持发送端密码二次确认、目标端差异预览、撤销本次合并和任意子文件夹选择。
- 对同步内容进行 gzip 压缩，并在加密、解密和合并时显示处理进度。

## 发布资料

Chrome Web Store 的商店文案、截图清单和隐私政策见 `STORE_LISTING.md` 与 `PRIVACY_POLICY.md`；Edge 发布资料见 `EDGE_STORE_LISTING.md`。

## 下一步

- 如确实需要跨设备自动同步，再单独设计端到端加密的中转服务。
