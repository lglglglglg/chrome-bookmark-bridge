# Chrome Web Store 提交操作单

本文件用于在开发者控制台逐项填写；提交前请确认 GitHub 仓库已公开、GitHub Pages 已启用。

## 要上传的文件

- 扩展包：`dist/书签桥-v0.4.7.zip`
- 商店图标：`icon-128.png`
- 隐私政策：`https://lglglglglg.github.io/chrome-bookmark-bridge/`
- 商店文字：复制 `STORE_LISTING.md` 中的产品名、短描述和详细描述。

## 权限说明

- `bookmarks`：只在用户主动发送、预览或确认合并时读取或创建书签。
- `clipboardWrite`：仅在用户点击复制同步码时写入剪贴板。
- `sidePanel`：仅在用户点击从侧边栏选择文件时，显示扩展自己的文件导入界面。

## 上架前必须完成

- [ ] 在全新 Chrome 配置文件安装 ZIP，验证发送、错误密码、文件导入、合并和撤销。
- [ ] 准备真实扩展界面截图；不要包含账号、真实网址、密码或完整同步码。
- [ ] 在 Chrome Web Store Developer Dashboard 注册开发者账号。注册费为一次性 5 美元，付款操作由账号持有人确认。
- [ ] 上传 ZIP，填写商店资料和隐私政策链接，完成权限与数据使用问卷。
- [ ] 提交审核后保存商店页面链接和审核状态。
