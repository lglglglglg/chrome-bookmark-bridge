const TOKEN_PREFIX = "BM2.";
const LEGACY_TOKEN_PREFIX = "BM1.";
const PBKDF2_ITERATIONS = 210000;
// Chromium 浏览器（Chrome、Edge）都提供 chrome 命名空间；保留 browser 兜底便于未来扩展。
const extensionApi = globalThis.chrome ?? globalThis.browser;

const $ = (id) => document.getElementById(id);
const state = { roots: [], incoming: null, sendSummary: "", mergeHistory: [], operation: null, progressTimer: null, sourceExpanded: false };

function setResult(id, message, error = false) {
  const el = $(id);
  el.textContent = message;
  el.classList.remove("hidden", "error");
  if (error) el.classList.add("error");
}

function clearResult(id) { $(id).classList.add("hidden"); }

function updateProgress(visible, message = "", value = 0) {
  if (state.progressTimer) { clearTimeout(state.progressTimer); state.progressTimer = null; }
  $("progress-wrap").classList.toggle("hidden", !visible);
  $("progress-label").textContent = message;
  $("progress-bar").value = Math.max(0, Math.min(100, value));
  $("cancel-operation").classList.toggle("hidden", !visible || !state.operation);
}

function scheduleProgressHide(delay = 900) {
  if (state.progressTimer) clearTimeout(state.progressTimer);
  state.progressTimer = setTimeout(() => updateProgress(false), delay);
}

function beginOperation() {
  const controller = new AbortController();
  state.operation = controller;
  return controller.signal;
}

function endOperation() {
  state.operation = null;
  $("cancel-operation").classList.add("hidden");
}

function assertActive(signal) {
  if (signal?.aborted) { const error = new Error("操作已取消"); error.code = "ABORTED"; throw error; }
}

function rootLabel(node) {
  return node.id === "bookmark_bar" ? "书签栏" : node.id === "other" ? "其他书签" : node.id === "mobile" ? "移动设备书签" : (node.title || node.id);
}

function folderEntries(nodes, depth = 0, parentPath = []) {
  const entries = [];
  for (const node of nodes) {
    if (node.id === "synced") continue;
    if (node.url) continue;
    const title = rootLabel(node);
    const path = [...parentPath, title];
    entries.push({ node, label: path.join(" / "), depth });
    if (node.children?.length) entries.push(...folderEntries(node.children, depth + 1, path));
  }
  return entries;
}

function fillRootSelect(select, roots, includeNested = false, query = "") {
  select.replaceChildren();
  const allEntries = includeNested ? folderEntries(roots) : roots.filter((root) => root.id !== "synced" && !root.url).map((node) => ({ node, label: rootLabel(node), depth: 0 }));
  const normalized = query.trim().toLocaleLowerCase();
  const entries = includeNested
    ? (normalized ? allEntries.filter(({ label }) => label.toLocaleLowerCase().includes(normalized)) : (state.sourceExpanded ? allEntries : allEntries.filter(({ depth }) => depth <= 1)))
    : allEntries;
  if (!entries.length) {
    const empty = document.createElement("option");
    empty.textContent = normalized ? "没有匹配的文件夹" : "没有可用的文件夹";
    empty.disabled = true;
    empty.selected = true;
    select.append(empty);
    return 0;
  }
  entries.forEach(({ node, label, depth }) => {
    const option = document.createElement("option");
    option.value = node.id;
    const parts = label.split(" / ");
    const display = parts.length > 3 ? `… / ${parts.slice(-3).join(" / ")}` : label;
    option.textContent = `${"　".repeat(Math.min(depth, 2))}${display}`;
    option.title = label;
    select.append(option);
  });
  return entries.length;
}

function applySourceFilter() {
  const roots = state.roots[0]?.children || [];
  const query = $("source-filter").value;
  const previous = $("source-root").value;
  const count = fillRootSelect($("source-root"), roots, true, query);
  if ([...$("source-root").options].some((option) => option.value === previous)) $("source-root").value = previous;
  else if ($("source-root").options.length && !$("source-root").options[0].disabled) $("source-root").selectedIndex = 0;
  $("source-count").textContent = query.trim() ? `匹配 ${count} 个位置` : `${count} 个可选位置`;
  $("toggle-source-tree").textContent = state.sourceExpanded ? "收起子文件夹" : "浏览全部子文件夹";
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
  const sourceFilter = $("source-filter").value;
  fillRootSelect($("source-root"), roots, true, sourceFilter);
  fillRootSelect($("destination-root"), roots, false);
  if ([...$("source-root").options].some((option) => option.value === sourceValue)) $("source-root").value = sourceValue;
  if ([...$("destination-root").options].some((option) => option.value === destinationValue)) $("destination-root").value = destinationValue;
  applySourceFilter();
}

async function createToken(signal) {
  clearResult("send-result");
  assertActive(signal);
  const password = $("send-password").value;
  const confirmation = $("send-password-confirm").value;
  if (!$("source-root").value) throw new Error("请先选择要发送的书签文件夹");
  if (password !== confirmation) throw new Error("两次输入的同步密码不一致");
  if (password && password.length < 8) throw new Error("同步密码如填写，至少需要 8 位");
  updateProgress(true, "读取书签结构…", 10);
  const [root] = await extensionApi.bookmarks.getSubTree($("source-root").value);
  assertActive(signal);
  const counts = countNodes(root);
  updateProgress(true, password ? `正在压缩并加密 ${counts.items} 项…` : `正在准备 ${counts.items} 项同步内容…`, 45);
  const payload = { v: 2, kind: "chrome-bookmark-bridge", createdAt: new Date().toISOString(), root: serialiseNode(root) };
  const token = await encodeToken(payload, password);
  assertActive(signal);
  $("token-output").value = token;
  $("copy-token").disabled = false;
  $("download-token").disabled = false;
  updateProgress(true, password ? "加密同步码已生成" : "同步码已生成", 100);
  const securityText = password ? "已加密" : "未加密";
  state.sendSummary = `已生成${securityText}同步码：${counts.folders} 个文件夹、${counts.bookmarks} 个书签。同步码 ${token.length.toLocaleString()} 字符。${password ? "" : "建议设置密码后再跨设备传递。"}`;
  const largeToken = token.length > 12000;
  const downloadButton = $("download-token");
  downloadButton.classList.toggle("recommended", largeToken);
  downloadButton.title = largeToken ? "同步码较长，建议优先保存为文件并在目标环境导入" : "将同步码保存为 .bookmarkbridge 文件";
  if (largeToken) state.sendSummary += "\n同步码较长，建议优先点击“保存为文件”，再在目标环境使用“从文件导入”。";
  setResult("send-result", state.sendSummary);
  scheduleProgressHide(1200);
}

function recordDiff(stats, status, kind, path) {
  stats.total += 1;
  if (stats.entries.length < 200) stats.entries.push({ status, kind, path });
}

function recordNewSubtree(node, path, stats, signal) {
  assertActive(signal);
  if (node.url) {
    stats.bookmarks += 1;
    recordDiff(stats, "add", "新增书签", path);
    return;
  }
  stats.folders += 1;
  recordDiff(stats, "add", "新增文件夹", path);
  for (const child of node.children || []) recordNewSubtree(child, `${path} / ${child.title || "未命名"}`, stats, signal);
}

async function calculateDiff(parentId, children, stats, parentPath, signal) {
  assertActive(signal);
  const existing = await extensionApi.bookmarks.getChildren(parentId);
  const urlSet = new Set(existing.filter((item) => item.url).map((item) => `${item.url}\u0000${item.title}`));
  const folderMap = new Map(existing.filter((item) => !item.url).map((item) => [item.title, item]));
  for (const child of children || []) {
    assertActive(signal);
    const path = `${parentPath} / ${child.title || "未命名"}`;
    if (child.url) {
      const duplicate = urlSet.has(`${child.url}\u0000${child.title}`);
      if (duplicate) { stats.skipped += 1; recordDiff(stats, "skip", "跳过重复", path); }
      else { stats.bookmarks += 1; recordDiff(stats, "add", "新增书签", path); urlSet.add(`${child.url}\u0000${child.title}`); }
    } else {
      const folder = folderMap.get(child.title);
      if (folder) { stats.reusedFolders += 1; recordDiff(stats, "reuse", "复用文件夹", path); await calculateDiff(folder.id, child.children, stats, path, signal); }
      else recordNewSubtree(child, path, stats, signal);
    }
  }
}

async function renderPreview(signal) {
  if (!state.incoming) return;
  const destination = $("destination-root").selectedOptions[0]?.textContent || "目标位置";
  const sourceCounts = countNodes(state.incoming.root);
  const diff = { bookmarks: 0, folders: 0, skipped: 0, reusedFolders: 0, total: 0, entries: [] };
  await calculateDiff($("destination-root").value, state.incoming.root.children, diff, state.incoming.root.title || "来源", signal);
  state.diff = diff;
  const preview = $("preview");
  preview.replaceChildren();
  const summary = document.createElement("div");
  summary.textContent = `来源：${state.incoming.root.title || "未命名"} ｜ 创建时间：${new Date(state.incoming.createdAt).toLocaleString()}\n共 ${sourceCounts.folders} 个文件夹、${sourceCounts.bookmarks} 个书签 → ${destination}\n预计新增 ${diff.bookmarks} 个书签、${diff.folders} 个文件夹，复用 ${diff.reusedFolders} 个文件夹，跳过 ${diff.skipped} 个重复项`;
  preview.append(summary);
  const list = document.createElement("ul");
  list.className = "diff-list";
  for (const item of diff.entries) {
    const row = document.createElement("li");
    row.className = item.status;
    row.textContent = `${item.kind} · ${item.path}`;
    list.append(row);
  }
  preview.append(list);
  if (diff.total > diff.entries.length) {
    const more = document.createElement("div");
    more.className = "diff-more";
    more.textContent = `已显示前 ${diff.entries.length} 条，另有 ${diff.total - diff.entries.length} 条；完整内容仍会按预览结果合并。`;
    preview.append(more);
  }
  preview.classList.remove("hidden");
}

async function inspectToken(signal) {
  clearResult("receive-result");
  updateProgress(true, "解密并检查同步码…", 35);
  try {
    state.incoming = await decodeToken($("token-input").value, $("receive-password").value);
    assertActive(signal);
    $("merge-options").classList.remove("hidden");
    await renderPreview(signal);
    updateProgress(true, "差异预览已完成", 100);
    scheduleProgressHide(800);
  } catch (error) {
    state.incoming = null;
    $("preview").classList.add("hidden");
    $("merge-options").classList.add("hidden");
    updateProgress(false);
    setResult("receive-result", error.code === "ABORTED" ? "已取消预览。" : (error.message || "无法解析同步码"), error.code !== "ABORTED");
  }
}

async function mergeChildren(parentId, children, mode, stats, signal) {
  const existing = mode === "smart" ? await extensionApi.bookmarks.getChildren(parentId) : [];
  const urlSet = new Set(existing.filter((item) => item.url).map((item) => `${item.url}\u0000${item.title}`));
  const folderMap = new Map(existing.filter((item) => !item.url).map((item) => [item.title, item]));
  for (const child of children || []) {
    assertActive(signal);
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
      await mergeChildren(folder.id, child.children, mode, stats, signal);
    }
  }
}

function addMergeHistory(stats, partial = false) {
  if (!stats.createdNodes.length) return;
  state.mergeHistory.unshift({ createdNodes: [...stats.createdNodes], createdAt: new Date(), bookmarks: stats.bookmarks, folders: stats.folders, skipped: stats.skipped, partial });
  renderMergeHistory();
}

function renderMergeHistory() {
  const container = $("merge-history");
  container.replaceChildren();
  if (!state.mergeHistory.length) { container.classList.add("hidden"); return; }
  container.classList.remove("hidden");
  const title = document.createElement("div");
  title.className = "history-title";
  title.textContent = "本次弹窗会话的合并历史";
  container.append(title);
  state.mergeHistory.forEach((record, index) => {
    const row = document.createElement("div");
    row.className = "history-row";
    const text = document.createElement("span");
    text.textContent = `${record.createdAt.toLocaleTimeString()} · 新增 ${record.bookmarks} 个书签、${record.folders} 个文件夹${record.partial ? "（已取消）" : ""}`;
    const button = document.createElement("button");
    button.textContent = "撤销";
    button.addEventListener("click", () => runBusy(button, (signal) => undoMerge(index, signal)).catch((error) => {
      updateProgress(false);
      setResult("receive-result", error.code === "ABORTED" ? "已取消撤销，剩余内容仍保留在该条历史记录中。" : (error.message || String(error)), error.code !== "ABORTED");
    }));
    row.append(text, button);
    container.append(row);
  });
}

async function mergeToken(signal) {
  if (!state.incoming) return;
  const mode = document.querySelector('input[name="merge-mode"]:checked').value;
  const stats = { bookmarks: 0, folders: 0, skipped: 0, processed: 0, total: Math.max(1, countNodes(state.incoming.root).items), createdNodes: [] };
  updateProgress(true, "准备合并…", 20);
  try {
    await mergeChildren($("destination-root").value, state.incoming.root.children, mode, stats, signal);
    addMergeHistory(stats);
    setResult("receive-result", `合并完成：新增 ${stats.bookmarks} 个书签、${stats.folders} 个文件夹，跳过 ${stats.skipped} 个重复项。`);
    updateProgress(true, "合并完成", 100);
    await loadRoots();
    await renderPreview(signal);
    scheduleProgressHide(1200);
  } catch (error) {
    if (stats.createdNodes.length) addMergeHistory(stats, true);
    updateProgress(false);
    setResult("receive-result", error.code === "ABORTED" ? "已取消合并；已创建内容已记录在合并历史中，可单独撤销。" : `合并失败：${error.message || error}`, error.code !== "ABORTED");
  }
}

async function undoMerge(index, signal) {
  const record = state.mergeHistory[index];
  if (!record?.createdNodes?.length) return;
  updateProgress(true, "正在撤销本次合并…", 50);
  for (const node of [...record.createdNodes].reverse()) {
    assertActive(signal);
    try {
      if (node.type === "folder") await extensionApi.bookmarks.removeTree(node.id);
      else await extensionApi.bookmarks.remove(node.id);
    } catch (_) { /* already removed or moved; continue cleanup */ }
  }
  state.mergeHistory.splice(index, 1);
  renderMergeHistory();
  await loadRoots();
  if (state.incoming) await renderPreview(signal);
  updateProgress(false);
  setResult("receive-result", "已撤销本次合并，目标端原有书签未受影响。");
}

async function copyToken() {
  await navigator.clipboard.writeText($("token-output").value);
  setResult("send-result", "同步码已复制到剪贴板，可以在目标环境粘贴。" + (state.sendSummary ? `\n${state.sendSummary}` : ""));
}

async function runBusy(buttonId, task) {
  const button = typeof buttonId === "string" ? $(buttonId) : buttonId;
  button.disabled = true;
  const signal = beginOperation();
  try { await task(signal); } finally { endOperation(); button.disabled = false; }
}

function downloadToken() {
  const blob = new Blob([$("token-output").value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = "书签桥同步码.bookmarkbridge"; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("create-token").addEventListener("click", () => runBusy("create-token", createToken).catch((error) => { updateProgress(false); setResult("send-result", error.code === "ABORTED" ? "已取消生成。" : (error.message || String(error)), error.code !== "ABORTED"); }));
$("inspect-token").addEventListener("click", () => runBusy("inspect-token", inspectToken));
$("merge-token").addEventListener("click", () => runBusy("merge-token", mergeToken));
$("copy-token").addEventListener("click", () => copyToken().catch((error) => setResult("send-result", error.message || String(error), true)));
$("download-token").addEventListener("click", downloadToken);
$("source-filter").addEventListener("input", applySourceFilter);
$("toggle-source-tree").addEventListener("click", () => { state.sourceExpanded = !state.sourceExpanded; applySourceFilter(); });
$("destination-root").addEventListener("change", () => renderPreview().catch((error) => setResult("receive-result", error.message || String(error), true)));
$("cancel-operation").addEventListener("click", () => { if (state.operation) state.operation.abort(); });
async function importTokenFile(file) {
  if (!file) return;
  try {
    $("token-input").value = await file.text();
    $("file-name").textContent = file.name;
    setResult("receive-result", "文件已导入，请输入同步密码后点击“预览同步内容”。");
  } catch (error) { setResult("receive-result", `文件读取失败：${error.message || error}`, true); }
}

$("token-file").addEventListener("change", (event) => importTokenFile(event.target.files?.[0]));
$("drop-zone").addEventListener("dragenter", (event) => { event.preventDefault(); $("drop-zone").classList.add("dragover"); });
$("drop-zone").addEventListener("dragover", (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; $("drop-zone").classList.add("dragover"); });
$("drop-zone").addEventListener("dragleave", (event) => { if (!event.currentTarget.contains(event.relatedTarget)) $("drop-zone").classList.remove("dragover"); });
$("drop-zone").addEventListener("drop", (event) => {
  event.preventDefault();
  $("drop-zone").classList.remove("dragover");
  const file = [...(event.dataTransfer.files || [])].find((item) => /\.bookmarkbridge$|\.txt$/i.test(item.name) || item.type === "text/plain");
  if (file) importTokenFile(file);
  else setResult("receive-result", "请拖入 .bookmarkbridge 或 .txt 同步文件。", true);
});
$("drop-zone").addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") $("token-file").click(); });

(async function init() {
  try {
    await loadRoots();
    const browserName = /Edg\//.test(navigator.userAgent) ? "Edge" : /Chrome\//.test(navigator.userAgent) ? "Chrome" : "当前浏览器";
    $("browser-name").textContent = browserName;
  } catch (error) { setResult("send-result", `无法读取当前书签：${error.message || error}`, true); }
})();
