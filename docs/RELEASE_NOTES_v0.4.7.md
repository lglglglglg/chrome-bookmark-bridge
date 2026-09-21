# GitHub Release｜书签桥 v0.4.7

> 将以下“可直接复制的 Release 正文”粘贴到 GitHub Releases；发布日期由创建 Release 时自动生成。

## Release 标题

`书签桥 v0.4.7｜安全性与发布质量优化`

## 标签与发布类型

- 标签：`v0.4.7`
- 目标分支：`main`
- 类型：建议先标记为 **Pre-release**；完成 Chrome/Edge 真实配置文件测试后，可改为正式 Release。

## 附件

- `书签桥-v0.4.7.zip`：Chrome 开发者模式手动安装包。
- `书签桥-edge-v0.4.7.zip`：Microsoft Edge 开发者模式手动安装包。
- `SHA256SUMS-v0.4.7.txt`：两个 ZIP 的 SHA-256 校验值（仓库已生成，也可按本文件底部命令重建）。

## 可直接复制的 Release 正文

```markdown
## 书签桥 v0.4.7

在 Chrome 与 Edge 配置文件之间，以本地同步码安全传递、预览和合并书签。

### 本次更新

- 提升撤销安全性：不会递归删除合并后用户手动加入文件夹的内容；无法安全删除的项目会保留并提示。
- 防止同步码修改后沿用旧预览，必须重新预览后才能合并。
- 长操作期间锁定关键控件，减少并发操作导致的状态混乱。
- 限制异常超大同步码与解压结果，降低损坏文件造成内存占用异常的风险。
- 优化较大书签树的同步码编码性能。

### 安装方式

下载对应浏览器的 ZIP，解压后打开 `chrome://extensions` 或 `edge://extensions`，开启“开发者模式”，点击“加载已解压的扩展程序”，选择解压后的文件夹。

> 此 Release 提供开发者模式手动安装包。Chrome Web Store 与 Microsoft Edge Add-ons 的正式商店版本仍在准备中。

### 隐私与安全

- 书签只在本地浏览器中处理，不上传服务器。
- 密码为可选；设置后使用 Web Crypto AES-GCM 加密，密码不会写入同步码。
- 请不要把同步码和密码一起发送给不可信对象。

完整隐私政策：[书签桥隐私政策](https://lglglglglg.github.io/chrome-bookmark-bridge/)

### 已知限制

- 本扩展是手动传递工具，不提供后台自动双向同步。
- 撤销历史仅在当前扩展弹窗会话内可用。
- 超长同步内容建议保存为 `.bookmarkbridge` 文件并导入。
```

## 创建 Release 前生成校验文件

在项目根目录执行：

```bash
shasum -a 256 dist/书签桥-v0.4.7.zip dist/书签桥-edge-v0.4.7.zip > dist/SHA256SUMS-v0.4.7.txt
bash scripts/check-extension.sh
```

将 `dist/SHA256SUMS-v0.4.7.txt` 与两个 ZIP 一同作为 Release 附件上传。不要在校验文件中混入个人路径。
