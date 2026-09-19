const TOKEN_PREFIX = "BM2.";
const LEGACY_TOKEN_PREFIX = "BM1.";
const PBKDF2_ITERATIONS = 210000;

const $ = (id) => document.getElementById(id);
const state = { roots: [], incoming: null };

function setResult(id, message, error = false) {
  const el = $(id);
  el.textContent = message;
  el.classList.remove("hidden", "error");
  if (error) el.classList.add("error");
}

function clearResult(id) { $(id).classList.add("hidden"); }

function rootLabel(node) {
  return node.id === "bookmark_bar" ? "书签栏" : node.id === "other" ? "其他书签" : node.id === "mobile" ? "移动设备书签" : (node.title || node.id);
}

function fillRootSelect(select, roots) {
  select.replaceChildren();
  roots.filter((root) => root.id !== "synced").forEach((root) => {
    const option = document.createElement("option");
    option.value = root.id;
    option.textContent = rootLabel(root);
    select.append(option);
  });
}

function countNodes(node) {
  let bookmarks = 0, folders = 0;
  for (const child of node.children || []) {
    if (child.url) bookmarks += 1;
    else { folders += 1; const nested = countNodes(child); bookmarks += nested.bookmarks; folders += nested.folders; }
  }
  return { bookmarks, folders };
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToJson(bytes) { return JSON.parse(new TextDecoder().decode(bytes)); }

async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function encodeToken(value, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  const envelope = { v: 2, kind: "chrome-bookmark-bridge", alg: "PBKDF2-AES-GCM", iterations: PBKDF2_ITERATIONS, salt: bytesToBase64Url(salt), iv: bytesToBase64Url(iv), ciphertext: bytesToBase64Url(ciphertext) };
  return TOKEN_PREFIX + bytesToBase64Url(new TextEncoder().encode(JSON.stringify(envelope)));
}

async function decodeToken(token, password) {
  const compact = token.trim().replace(/\s+/g, "");
  if (compact.startsWith(LEGACY_TOKEN_PREFIX)) {
    const payload = bytesToJson(base64UrlToBytes(compact.slice(LEGACY_TOKEN_PREFIX.length)));
    if (payload.v !== 1 || payload.kind !== "chrome-bookmark-bridge" || !payload.root || !Array.isArray(payload.root.children)) throw new Error("同步码版本不受支持或内容已损坏");
    return payload;
  }
  if (!compact.startsWith(TOKEN_PREFIX)) throw new Error("同步码格式不正确，应以 BM2. 开头");
  if (!password || password.length < 8) throw new Error("请输入至少 8 位同步密码");
  try {
    const envelope = bytesToJson(base64UrlToBytes(compact.slice(TOKEN_PREFIX.length)));
    if (envelope.v !== 2 || envelope.alg !== "PBKDF2-AES-GCM" || !envelope.salt || !envelope.iv || !envelope.ciphertext) throw new Error("同步码版本不受支持或内容已损坏");
    const key = await deriveKey(password, base64UrlToBytes(envelope.salt));
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlToBytes(envelope.iv) }, key, base64UrlToBytes(envelope.ciphertext));
    const payload = bytesToJson(new Uint8Array(plaintext));
    if (payload.v !== 2 || payload.kind !== "chrome-bookmark-bridge" || !payload.root || !Array.isArray(payload.root.children)) throw new Error("同步码内容不完整");
    return payload;
  } catch (error) {
    if (error.message === "同步码版本不受支持或内容已损坏" || error.message === "同步码内容不完整") throw error;
    throw new Error("密码错误，或同步码已损坏");
  }
}

function serialiseNode(node) {
  return {
    title: node.title || "",
    ...(node.url ? { url: node.url } : { children: (node.children || []).map(serialiseNode) })
  };
}

async function loadRoots() {
  state.roots = await chrome.bookmarks.getTree();
  fillRootSelect($("source-root"), state.roots[0]?.children || []);
  fillRootSelect($("destination-root"), state.roots[0]?.children || []);
}

async function createToken() {
  clearResult("send-result");
  const password = $("send-password").value;
  if (password.length < 8) throw new Error("请先设置至少 8 位同步密码");
  const rootId = $("source-root").value;
  const [root] = await chrome.bookmarks.getSubTree(rootId);
  const payload = { v: 2, kind: "chrome-bookmark-bridge", createdAt: new Date().toISOString(), root: serialiseNode(root) };
  const token = await encodeToken(payload, password);
  $("token-output").value = token;
  $("copy-token").disabled = false;
  $("download-token").disabled = false;
  // 大型书签树可能超过扩展存储配额；复制/保存仍然可以正常使用。
  if (token.length < 2_000_000) {
    try { await chrome.storage.local.set({ lastToken: token }); } catch (_) { /* ignore quota errors */ }
  }
  const counts = countNodes(root);
  setResult("send-result", `已生成并加密：${counts.folders} 个文件夹、${counts.bookmarks} 个书签。密码不会写入同步码。`);
}

async function inspectToken() {
  clearResult("receive-result");
  try {
    const payload = await decodeToken($("token-input").value, $("receive-password").value);
    state.incoming = payload;
    const counts = countNodes(payload.root);
    $("preview").textContent = `来源位置：${payload.root.title || "未命名"} ｜ 创建时间：${new Date(payload.createdAt).toLocaleString()} ｜ ${counts.folders} 个文件夹、${counts.bookmarks} 个书签`;
    $("preview").classList.remove("hidden");
    $("merge-options").classList.remove("hidden");
  } catch (error) {
    state.incoming = null;
    $("preview").classList.add("hidden");
    $("merge-options").classList.add("hidden");
    setResult("receive-result", error.message || "无法解析同步码", true);
  }
}

async function mergeChildren(parentId, children, mode, stats) {
  const existing = mode === "smart" ? await chrome.bookmarks.getChildren(parentId) : [];
  const urlSet = new Set(existing.filter((item) => item.url).map((item) => `${item.url}\u0000${item.title}`));
  const folderMap = new Map(existing.filter((item) => !item.url).map((item) => [item.title, item]));
  for (const child of children || []) {
    if (child.url) {
      const key = `${child.url}\u0000${child.title}`;
      if (mode === "smart" && urlSet.has(key)) { stats.skipped += 1; continue; }
      await chrome.bookmarks.create({ parentId, title: child.title, url: child.url });
      stats.bookmarks += 1;
    } else {
      let folder = mode === "smart" ? folderMap.get(child.title) : null;
      if (!folder) { folder = await chrome.bookmarks.create({ parentId, title: child.title }); stats.folders += 1; }
      await mergeChildren(folder.id, child.children, mode, stats);
    }
  }
}

async function mergeToken() {
  if (!state.incoming) return;
  const mode = document.querySelector('input[name="merge-mode"]:checked').value;
  const stats = { bookmarks: 0, folders: 0, skipped: 0 };
  try {
    await mergeChildren($("destination-root").value, state.incoming.root.children, mode, stats);
    setResult("receive-result", `合并完成：新增 ${stats.bookmarks} 个书签、${stats.folders} 个文件夹，跳过 ${stats.skipped} 个重复项。`);
    await loadRoots();
  } catch (error) {
    setResult("receive-result", `合并失败：${error.message || error}`, true);
  }
}

async function copyToken() {
  await navigator.clipboard.writeText($("token-output").value);
  setResult("send-result", "同步码已复制到剪贴板，可以在目标环境直接粘贴。\n" + $("send-result").textContent);
}

function downloadToken() {
  const blob = new Blob([$("token-output").value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = "书签桥同步码.bookmarkbridge"; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("create-token").addEventListener("click", () => createToken().catch((error) => setResult("send-result", error.message || String(error), true)));
$("inspect-token").addEventListener("click", () => inspectToken().catch((error) => setResult("receive-result", error.message || String(error), true)));
$("merge-token").addEventListener("click", () => mergeToken());
$("copy-token").addEventListener("click", () => copyToken().catch((error) => setResult("send-result", error.message || String(error), true)));
$("download-token").addEventListener("click", downloadToken);
$("token-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    $("token-input").value = await file.text();
    $("file-name").textContent = file.name;
    setResult("receive-result", "文件已导入，请输入同步密码后点击“预览同步内容”。");
  } catch (error) {
    setResult("receive-result", `文件读取失败：${error.message || error}`, true);
  }
});

(async function init() {
  try {
    await loadRoots();
    const saved = await chrome.storage.local.get("lastToken");
    if (saved.lastToken) $("token-input").value = saved.lastToken;
  } catch (error) {
    setResult("send-result", `无法读取当前书签：${error.message || error}`, true);
  }
})();
