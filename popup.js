const TOKEN_PREFIX = "BM2.";
const LEGACY_TOKEN_PREFIX = "BM1.";
const PBKDF2_ITERATIONS = 210000;
// Chromium 浏览器（Chrome、Edge）都提供 chrome 命名空间；保留 browser 兜底便于未来扩展。
const extensionApi = globalThis.chrome ?? globalThis.browser;

const $ = (id) => document.getElementById(id);
const state = { roots: [], incoming: null, lastMerge: null, sendSummary: "" };

function setResult(id, message, error = false) {
  const el = $(id);
  el.textContent = message;
  el.classList.remove("hidden", "error");
  if (error) el.classList.add("error");
}

function clearResult(id) { $(id).classList.add("hidden"); }

function updateProgress(visible, message = "", value = 0) {
  $("progress-wrap").classList.toggle("hidden", !visible);
  $("progress-label").textContent = message;
  $("progress-bar").value = Math.max(0, Math.min(100, value));
}

function rootLabel(node) {
  return node.id === "bookmark_bar" ? "书签栏" : node.id === "other" ? "其他书签" : node.id === "mobile" ? "移动设备书签" : (node.title || node.id);
}

function folderEntries(nodes, depth = 0, parentPath = []) {
  const entries = [];
  for (const node of nodes) {
    if (node.id === "synced") continue;
    const title = rootLabel(node);
    const path = [...parentPath, title];
    entries.push({ node, label: path.join(" / "), depth });
    if (!node.url && node.children?.length) entries.push(...folderEntries(node.children, depth + 1, path));
  }
  return entries;
}

function fillRootSelect(select, roots, includeNested = false) {
  select.replaceChildren();
  const entries = includeNested ? folderEntries(roots) : roots.filter((root) => root.id !== "synced").map((node) => ({ node, label: rootLabel(node), depth: 0 }));
  entries.forEach(({ node, label, depth }) => {
    const option = document.createElement("option");
    option.value = node.id;
    option.textContent = `${"　".repeat(depth)}${label}`;
    select.append(option);
  });
}

function countNodes(node) {
  let bookmarks = 0, folders = 0, items = 0;
  for (const child of node.children || []) {
    items += 1;
    if (child.url) bookmarks += 1;
    else { folders += 1; const nested = countNodes(child); bookmarks += nested.bookmarks; folders += nested.folders; items += nested.items; }
  }
  return { bookmarks, folders, items };
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

async function transformBytes(bytes, type) {
  if (type === "gzip" && typeof CompressionStream !== "undefined") {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  if (type === "gunzip" && typeof DecompressionStream !== "undefined") {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return bytes;
}

async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function encodeToken(value, password) {
  const raw = new TextEncoder().encode(JSON.stringify(value));
  // 小同步码不走压缩流，避免 Edge/Chrome 对极小 Blob 建流造成额外等待。
  const compressed = raw.length > 1024 ? await transformBytes(raw, "gzip") : raw;
  const compression = compressed.length < raw.length ? "gzip" : "none";
  const input = compression === "gzip" ? compressed : raw;
  if (!password) {
    const envelope = { v: 2, kind: "chrome-bookmark-bridge", encrypted: false, compression, data: bytesToBase64Url(input) };
    return TOKEN_PREFIX + bytesToBase64Url(new TextEncoder().encode(JSON.stringify(envelope)));
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, input));
  const envelope = { v: 2, kind: "chrome-bookmark-bridge", encrypted: true, alg: "PBKDF2-AES-GCM", compression, iterations: PBKDF2_ITERATIONS, salt: bytesToBase64Url(salt), iv: bytesToBase64Url(iv), ciphertext: bytesToBase64Url(ciphertext) };
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
  try {
    const envelope = bytesToJson(base64UrlToBytes(compact.slice(TOKEN_PREFIX.length)));
    if (envelope.v !== 2) throw new Error("同步码版本不受支持或内容已损坏");
    const compression = envelope.compression || "none";
    let plaintext;
    if (envelope.encrypted === false) {
      if (!envelope.data) throw new Error("同步码内容不完整");
      plaintext = base64UrlToBytes(envelope.data);
    } else {
      if (!password || password.length < 8) throw new Error("请输入至少 8 位同步密码");
      if (!envelope.alg || !envelope.salt || !envelope.iv || !envelope.ciphertext) throw new Error("同步码版本不受支持或内容已损坏");
      const key = await deriveKey(password, base64UrlToBytes(envelope.salt));
      plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlToBytes(envelope.iv) }, key, base64UrlToBytes(envelope.ciphertext)));
    }
    if (compression === "gzip") plaintext = await transformBytes(plaintext, "gunzip");
    const payload = bytesToJson(plaintext);
    if (payload.v !== 2 || payload.kind !== "chrome-bookmark-bridge" || !payload.root || !Array.isArray(payload.root.children)) throw new Error("同步码内容不完整");
    return payload;
  } catch (error) {
    if (error.message === "同步码版本不受支持或内容已损坏" || error.message === "同步码内容不完整" || error.message === "请输入至少 8 位同步密码") throw error;
    throw new Error("密码错误，或同步码已损坏");
  }
}

function serialiseNode(node) {
  return { title: node.title || "", ...(node.url ? { url: node.url } : { children: (node.children || []).map(serialiseNode) }) };
}

async function loadRoots() {
  state.roots = await extensionApi.bookmarks.getTree();
  const roots = state.roots[0]?.children || [];
  const sourceValue = $("source-root").value;
  const destinationValue = $("destination-root").value;
  fillRootSelect($("source-root"), roots, true);
  fillRootSelect($("destination-root"), roots, false);
  if ([...$("source-root").options].some((option) => option.value === sourceValue)) $("source-root").value = sourceValue;
  if ([...$("destination-root").options].some((option) => option.value === destinationValue)) $("destination-root").value = destinationValue;
}

async function createToken() {
  clearResult("send-result");
  const password = $("send-password").value;
  const confirmation = $("send-password-confirm").value;
  if (password !== confirmation) throw new Error("两次输入的同步密码不一致");
  if (password && password.length < 8) throw new Error("同步密码如填写，至少需要 8 位");
  updateProgress(true, "读取书签结构…", 10);
  const [root] = await extensionApi.bookmarks.getSubTree($("source-root").value);
  const counts = countNodes(root);
  updateProgress(true, password ? `正在压缩并加密 ${counts.items} 项…` : `正在准备 ${counts.items} 项同步内容…`, 45);
  const payload = { v: 2, kind: "chrome-bookmark-bridge", createdAt: new Date().toISOString(), root: serialiseNode(root) };
  const token = await encodeToken(payload, password);
  $("token-output").value = token;
  $("copy-token").disabled = false;
  $("download-token").disabled = false;
  updateProgress(true, password ? "加密同步码已生成" : "同步码已生成", 100);
  const securityText = password ? "已加密" : "未加密";
  state.sendSummary = `已生成${securityText}同步码：${counts.folders} 个文件夹、${counts.bookmarks} 个书签。同步码 ${token.length.toLocaleString()} 字符。${password ? "" : "建议设置密码后再跨设备传递。"}`;
  setResult("send-result", state.sendSummary);
  setTimeout(() => updateProgress(false), 1200);
}

async function calculateDiff(parentId, children, stats) {
  const existing = await extensionApi.bookmarks.getChildren(parentId);
  const urlSet = new Set(existing.filter((item) => item.url).map((item) => `${item.url}\u0000${item.title}`));
  const folderMap = new Map(existing.filter((item) => !item.url).map((item) => [item.title, item]));
  for (const child of children || []) {
    if (child.url) {
      const duplicate = urlSet.has(`${child.url}\u0000${child.title}`);
      if (duplicate) stats.skipped += 1; else stats.bookmarks += 1;
    } else {
      const folder = folderMap.get(child.title);
      if (folder) await calculateDiff(folder.id, child.children, stats);
      else { const nested = countNodes(child); stats.folders += 1 + nested.folders; stats.bookmarks += nested.bookmarks; }
    }
  }
}

async function renderPreview() {
  if (!state.incoming) return;
  const destination = $("destination-root").selectedOptions[0]?.textContent || "目标位置";
  const sourceCounts = countNodes(state.incoming.root);
  const diff = { bookmarks: 0, folders: 0, skipped: 0 };
  await calculateDiff($("destination-root").value, state.incoming.root.children, diff);
  state.diff = diff;
  $("preview").textContent = `来源：${state.incoming.root.title || "未命名"} ｜ 创建时间：${new Date(state.incoming.createdAt).toLocaleString()}\n共 ${sourceCounts.folders} 个文件夹、${sourceCounts.bookmarks} 个书签 → ${destination}\n预计新增 ${diff.bookmarks} 个书签、${diff.folders} 个文件夹，跳过 ${diff.skipped} 个重复项`;
  $("preview").classList.remove("hidden");
}

async function inspectToken() {
  clearResult("receive-result");
  updateProgress(true, "解密并检查同步码…", 35);
  try {
    state.incoming = await decodeToken($("token-input").value, $("receive-password").value);
    $("merge-options").classList.remove("hidden");
    await renderPreview();
    updateProgress(true, "差异预览已完成", 100);
    setTimeout(() => updateProgress(false), 800);
  } catch (error) {
    state.incoming = null;
    $("preview").classList.add("hidden");
    $("merge-options").classList.add("hidden");
    updateProgress(false);
    setResult("receive-result", error.message || "无法解析同步码", true);
  }
}

async function mergeChildren(parentId, children, mode, stats) {
  const existing = mode === "smart" ? await extensionApi.bookmarks.getChildren(parentId) : [];
  const urlSet = new Set(existing.filter((item) => item.url).map((item) => `${item.url}\u0000${item.title}`));
  const folderMap = new Map(existing.filter((item) => !item.url).map((item) => [item.title, item]));
  for (const child of children || []) {
    stats.processed += 1;
    updateProgress(true, `正在合并：${stats.processed}/${stats.total} 项`, 25 + (stats.processed / stats.total) * 70);
    if (child.url) {
      const key = `${child.url}\u0000${child.title}`;
      if (mode === "smart" && urlSet.has(key)) { stats.skipped += 1; continue; }
      const created = await extensionApi.bookmarks.create({ parentId, title: child.title, url: child.url });
      stats.bookmarks += 1;
      stats.createdNodes.push({ id: created.id, type: "bookmark" });
      urlSet.add(key);
    } else {
      let folder = mode === "smart" ? folderMap.get(child.title) : null;
      if (!folder) { folder = await extensionApi.bookmarks.create({ parentId, title: child.title }); stats.folders += 1; stats.createdNodes.push({ id: folder.id, type: "folder" }); folderMap.set(child.title, folder); }
      await mergeChildren(folder.id, child.children, mode, stats);
    }
  }
}

async function mergeToken() {
  if (!state.incoming) return;
  const mode = document.querySelector('input[name="merge-mode"]:checked').value;
  const stats = { bookmarks: 0, folders: 0, skipped: 0, processed: 0, total: Math.max(1, countNodes(state.incoming.root).items), createdNodes: [] };
  updateProgress(true, "准备合并…", 20);
  try {
    await mergeChildren($("destination-root").value, state.incoming.root.children, mode, stats);
    state.lastMerge = { createdNodes: stats.createdNodes };
    $("undo-merge").classList.toggle("hidden", stats.createdNodes.length === 0);
    setResult("receive-result", `合并完成：新增 ${stats.bookmarks} 个书签、${stats.folders} 个文件夹，跳过 ${stats.skipped} 个重复项。`);
    updateProgress(true, "合并完成", 100);
    await loadRoots();
    await renderPreview();
    setTimeout(() => updateProgress(false), 1200);
  } catch (error) {
    if (stats.createdNodes.length) {
      state.lastMerge = { createdNodes: stats.createdNodes };
      $("undo-merge").classList.remove("hidden");
    }
    updateProgress(false);
    setResult("receive-result", `合并失败：${error.message || error}`, true);
  }
}

async function undoMerge() {
  if (!state.lastMerge?.createdNodes?.length) return;
  $("undo-merge").disabled = true;
  updateProgress(true, "正在撤销本次合并…", 50);
  for (const node of [...state.lastMerge.createdNodes].reverse()) {
    try {
      if (node.type === "folder") await extensionApi.bookmarks.removeTree(node.id);
      else await extensionApi.bookmarks.remove(node.id);
    } catch (_) { /* already removed or moved; continue cleanup */ }
  }
  state.lastMerge = null;
  $("undo-merge").classList.add("hidden");
  $("undo-merge").disabled = false;
  await loadRoots();
  if (state.incoming) await renderPreview();
  updateProgress(false);
  setResult("receive-result", "已撤销本次合并，目标端原有书签未受影响。");
}

async function copyToken() {
  await navigator.clipboard.writeText($("token-output").value);
  setResult("send-result", "同步码已复制到剪贴板，可以在目标环境粘贴。" + (state.sendSummary ? `\n${state.sendSummary}` : ""));
}

async function runBusy(buttonId, task) {
  const button = $(buttonId);
  button.disabled = true;
  try { await task(); } finally { button.disabled = false; }
}

function downloadToken() {
  const blob = new Blob([$("token-output").value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = "书签桥同步码.bookmarkbridge"; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("create-token").addEventListener("click", () => runBusy("create-token", createToken).catch((error) => { updateProgress(false); setResult("send-result", error.message || String(error), true); }));
$("inspect-token").addEventListener("click", () => runBusy("inspect-token", inspectToken));
$("merge-token").addEventListener("click", () => runBusy("merge-token", mergeToken));
$("undo-merge").addEventListener("click", () => runBusy("undo-merge", undoMerge).catch((error) => setResult("receive-result", error.message || String(error), true)));
$("copy-token").addEventListener("click", () => copyToken().catch((error) => setResult("send-result", error.message || String(error), true)));
$("download-token").addEventListener("click", downloadToken);
$("destination-root").addEventListener("change", () => renderPreview().catch((error) => setResult("receive-result", error.message || String(error), true)));
$("token-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    $("token-input").value = await file.text();
    $("file-name").textContent = file.name;
    setResult("receive-result", "文件已导入，请输入同步密码后点击“预览同步内容”。");
  } catch (error) { setResult("receive-result", `文件读取失败：${error.message || error}`, true); }
});

(async function init() {
  try {
    await loadRoots();
    const browserName = /Edg\//.test(navigator.userAgent) ? "Edge" : /Chrome\//.test(navigator.userAgent) ? "Chrome" : "当前浏览器";
    $("browser-name").textContent = browserName;
  } catch (error) { setResult("send-result", `无法读取当前书签：${error.message || error}`, true); }
})();
