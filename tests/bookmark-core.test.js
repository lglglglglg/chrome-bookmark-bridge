const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LEGACY_TOKEN_PREFIX,
  base64UrlToBytes,
  bytesToBase64Url,
  classifyBookmark,
  countNodes,
  decodeToken,
  encodeToken,
  filterDiffEntries,
  inspectTokenEnvelope,
  isPathExcluded,
  serialiseNode,
} = require("../bookmark-core.js");

const samplePayload = {
  v: 2,
  kind: "chrome-bookmark-bridge",
  createdAt: "2026-09-27T00:00:00.000Z",
  root: {
    title: "示例",
    children: [
      { title: "OpenAI", url: "https://openai.com/" },
      { title: "开发", children: [{ title: "MDN", url: "https://developer.mozilla.org/" }] },
    ],
  },
};

test("统计书签树中的书签、文件夹和总项目数", () => {
  assert.deepEqual(countNodes(samplePayload.root), { bookmarks: 2, folders: 1, items: 3 });
});

test("序列化时移除浏览器内部 ID 和多余字段", () => {
  const result = serialiseNode({
    id: "12",
    title: "文件夹",
    dateAdded: 123,
    children: [{ id: "13", title: "网站", url: "https://example.com", index: 0 }],
  });
  assert.deepEqual(result, {
    title: "文件夹",
    children: [{ title: "网站", url: "https://example.com" }],
  });
});

test("Base64 URL 编码可以无损往返", () => {
  const input = crypto.getRandomValues(new Uint8Array(1024));
  assert.deepEqual(base64UrlToBytes(bytesToBase64Url(input)), input);
});

test("未加密 BM2 同步码可以无损解码", async () => {
  const token = await encodeToken(samplePayload, "");
  assert.match(token, /^BM2\./);
  assert.deepEqual(await decodeToken(token, ""), samplePayload);
});

test("加密 BM2 同步码仅接受正确密码", async () => {
  const token = await encodeToken(samplePayload, "correct-password");
  await assert.rejects(() => decodeToken(token, "wrong-password"), /密码错误|同步码已损坏/);
  assert.deepEqual(await decodeToken(token, "correct-password"), samplePayload);
});

test("继续兼容 BM1 同步码", async () => {
  const legacyPayload = { ...samplePayload, v: 1 };
  const bytes = new TextEncoder().encode(JSON.stringify(legacyPayload));
  const token = LEGACY_TOKEN_PREFIX + bytesToBase64Url(bytes);
  assert.deepEqual(await decodeToken(token, ""), legacyPayload);
});

test("拒绝普通文本和损坏同步码", async () => {
  await assert.rejects(() => decodeToken("普通文本", ""), /BM2/);
  await assert.rejects(() => decodeToken("BM2.broken", ""), /密码错误|同步码已损坏/);
});

test("识别精确重复、同网址冲突和同标题冲突", () => {
  const existing = [
    { title: "OpenAI", url: "https://openai.com/" },
    { title: "MDN", url: "https://developer.mozilla.org/" },
  ];
  assert.equal(classifyBookmark(existing, { title: "OpenAI", url: "https://openai.com/" }), "exact");
  assert.equal(classifyBookmark(existing, { title: "OpenAI 官网", url: "https://openai.com/" }), "same-url");
  assert.equal(classifyBookmark(existing, { title: "MDN", url: "https://example.com/" }), "same-title");
  assert.equal(classifyBookmark(existing, { title: "示例", url: "https://example.com/" }), "new");
});

test("排除文件夹时会同时排除其全部子节点", () => {
  const excluded = new Set(["1.2"]);
  assert.equal(isPathExcluded("1.2", excluded), true);
  assert.equal(isPathExcluded("1.2.3", excluded), true);
  assert.equal(isPathExcluded("1.20", excluded), false);
  assert.equal(isPathExcluded("2", excluded), false);
});

test("无需解密即可读取同步码传输属性，但不会泄露书签内容", async () => {
  const plainToken = await encodeToken(samplePayload, "");
  const encryptedToken = await encodeToken(samplePayload, "correct-password");
  assert.deepEqual(inspectTokenEnvelope(plainToken), {
    format: "BM2",
    encrypted: false,
    compression: "none",
    characters: plainToken.length,
  });
  assert.equal(inspectTokenEnvelope(encryptedToken).encrypted, true);
});

test("差异列表支持按状态和关键词组合筛选", () => {
  const entries = [
    { status: "add", kind: "新增书签", path: "书签栏 / OpenAI" },
    { status: "conflict", kind: "保留冲突书签", path: "工作 / 文档" },
    { status: "skip", kind: "跳过重复", path: "书签栏 / MDN" },
  ];
  assert.equal(filterDiffEntries(entries, "all", "书签栏").length, 2);
  assert.deepEqual(filterDiffEntries(entries, "conflict", "文档"), [entries[1]]);
  assert.equal(filterDiffEntries(entries, "skip", "OpenAI").length, 0);
});
