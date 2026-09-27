const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const popupHtml = fs.readFileSync(path.join(projectRoot, "popup.html"), "utf8");
const popupScript = fs.readFileSync(path.join(projectRoot, "popup.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));

test("Popup 脚本引用的静态或动态元素 ID 均存在", () => {
  const referencedIds = new Set([...popupScript.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]));
  const htmlIds = new Set([...popupHtml.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  const dynamicIds = new Set([...popupScript.matchAll(/\.id = "([^"]+)"/g)].map((match) => match[1]));
  const missing = [...referencedIds].filter((id) => !htmlIds.has(id) && !dynamicIds.has(id));
  assert.deepEqual(missing, []);
});

test("核心模块在界面脚本之前载入", () => {
  assert.ok(popupHtml.indexOf('src="bookmark-core.js"') < popupHtml.indexOf('src="popup.js"'));
});

test("Manifest 声明的界面和图标文件全部存在", () => {
  const referencedFiles = [
    manifest.action.default_popup,
    manifest.side_panel.default_path,
    ...Object.values(manifest.action.default_icon),
    ...Object.values(manifest.icons),
  ];
  for (const file of referencedFiles) assert.equal(fs.existsSync(path.join(projectRoot, file)), true, file);
});
