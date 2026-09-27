const {
  MAX_TOKEN_CHARS,
  classifyBookmark,
  countNodes,
  decodeToken,
  encodeToken,
  filterDiffEntries,
  inspectTokenEnvelope,
  isPathExcluded,
  serialiseNode,
} = BookmarkBridgeCore;
// Chromium 浏览器（Chrome、Edge）都提供 chrome 命名空间；保留 browser 兜底便于未来扩展。
const extensionApi = globalThis.chrome ?? globalThis.browser;

const $ = (id) => document.getElementById(id);
const state = {
  roots: [],
  incoming: null,
  sendSummary: "",
  mergeHistory: [],
  excludedKeys: new Set(),
  diffFilter: "all",
  diffQuery: "",
  diffVisibleLimit: 100,
  importedFile: null,
  operation: null,
  progressTimer: null,
  sourceExpanded: false,
  lockedControls: [],
};
const IMPORT_DB_NAME = "bookmarkBridgeImport";
const IMPORT_STORE_NAME = "pending";
const HISTORY_STORE_NAME = "mergeHistory";
const IMPORT_MAX_AGE = 10 * 60 * 1000;
const HISTORY_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const HISTORY_MAX_RECORDS = 20;

function openImportDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IMPORT_DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IMPORT_STORE_NAME)) request.result.createObjectStore(IMPORT_STORE_NAME);
      if (!request.result.objectStoreNames.contains(HISTORY_STORE_NAME)) request.result.createObjectStore(HISTORY_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开导入缓存"));
  });
}

function historyRecordForStorage(record) {
  return {
    ...record,
    createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt,
  };
}

async function persistMergeHistory() {
  const db = await openImportDb();
  const records = state.mergeHistory.slice(0, HISTORY_MAX_RECORDS).map(historyRecordForStorage);
  await new Promise((resolve, reject) => {
    const request = db.transaction(HISTORY_STORE_NAME, "readwrite").objectStore(HISTORY_STORE_NAME).put(records, "records");
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
}

async function loadMergeHistory() {
  try {
    const db = await openImportDb();
    const records = await new Promise((resolve, reject) => {
      const request = db.transaction(HISTORY_STORE_NAME, "readonly").objectStore(HISTORY_STORE_NAME).get("records");
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    const cutoff = Date.now() - HISTORY_MAX_AGE;
    state.mergeHistory = records
      .filter((record) => new Date(record.createdAt).getTime() >= cutoff && Array.isArray(record.createdNodes))
      .slice(0, HISTORY_MAX_RECORDS)
      .map((record) => ({ ...record, createdAt: new Date(record.createdAt) }));
    await persistMergeHistory();
    renderMergeHistory();
  } catch (_) {
    state.mergeHistory = [];
  }
}

async function consumePendingImport() {
  try {
    const db = await openImportDb();
    const record = await new Promise((resolve, reject) => {
      const request = db.transaction(IMPORT_STORE_NAME, "readonly").objectStore(IMPORT_STORE_NAME).get("token");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!record) return;
    await new Promise((resolve, reject) => {
      const request = db.transaction(IMPORT_STORE_NAME, "readwrite").objectStore(IMPORT_STORE_NAME).delete("token");
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
    if (Date.now() - record.createdAt > IMPORT_MAX_AGE) return;
    $("token-input").value = record.token;
    $("file-name").textContent = record.name || "已导入同步文件";
    state.importedFile = { name: record.name || "已导入同步文件", size: record.size || record.token.length };
    setResult("receive-result", `${describeTransfer(record.token, state.importedFile)}\n请输入同步密码后点击“解密并预览差异”。`);
  } catch (_) {
    // IndexedDB 不可用时仍可使用粘贴和拖拽导入，不阻断启动。
  }
}

function setResult(id, message, error = false) {
  const el = $(id);
  el.textContent = message;
  el.classList.remove("hidden", "error");
  if (error) el.classList.add("error");
}

function clearResult(id) { $(id).classList.add("hidden"); }

function invalidateIncomingPreview() {
  if (!state.incoming) return;
  state.incoming = null;
  state.diff = null;
  state.excludedKeys.clear();
  state.diffFilter = "all";
  state.diffQuery = "";
  state.diffVisibleLimit = 100;
  $("preview").classList.add("hidden");
  $("merge-options").classList.add("hidden");
  setResult("receive-result", "同步码已修改，请重新解密并预览差异后再合并。");
}

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

function currentBrowserName() {
  return /Edg\//.test(navigator.userAgent) ? "Edge" : /Chrome\//.test(navigator.userAgent) ? "Chrome" : "Chromium 浏览器";
}

function describeTransfer(token, file = null) {
  try {
    const envelope = inspectTokenEnvelope(token);
    const fileText = file ? `文件：${file.name}（${Math.max(1, Math.ceil(file.size / 1024)).toLocaleString()} KB）\n` : "";
    return `${fileText}格式：${envelope.format} ｜ ${envelope.encrypted ? "已加密" : "未加密"} ｜ ${envelope.compression === "gzip" ? "已压缩" : "未压缩"} ｜ ${envelope.characters.toLocaleString()} 字符`;
  } catch (_) {
    return file ? `文件：${file.name}（${Math.max(1, Math.ceil(file.size / 1024)).toLocaleString()} KB）` : "";
  }
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
  const payload = {
    v: 2,
    kind: "chrome-bookmark-bridge",
    createdAt: new Date().toISOString(),
    metadata: {
      sourceBrowser: currentBrowserName(),
      sourceFolder: root.title || "未命名",
      bookmarks: counts.bookmarks,
      folders: counts.folders,
      formatVersion: 2,
      appVersion: extensionApi.runtime.getManifest().version,
    },
    root: serialiseNode(root),
  };
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

function recordDiff(stats, status, kind, path, key) {
  stats.total += 1;
  stats.entries.push({ status, kind, path, key });
  if (stats.expected && (stats.total % 25 === 0 || stats.total === stats.expected)) {
    updateProgress(true, `正在比较：${stats.total}/${stats.expected} 项`, 35 + Math.min(55, (stats.total / stats.expected) * 55));
  }
}

async function recordNewSubtree(node, path, key, stats, signal, conflict = false) {
  assertActive(signal);
  if (node.url) {
    stats.bookmarks += 1;
    if (conflict) stats.conflicts += 1;
    recordDiff(stats, conflict ? "conflict" : "add", conflict ? "保留冲突书签" : "新增书签", path, key);
    if (stats.total % 100 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    return;
  }
  stats.folders += 1;
  recordDiff(stats, "add", "新增文件夹", path, key);
  for (const [index, child] of (node.children || []).entries()) {
    await recordNewSubtree(child, `${path} / ${child.title || "未命名"}`, `${key}.${index}`, stats, signal);
  }
}

async function calculateDiff(parentId, children, stats, parentPath, keyPrefix, mode, conflictMode, signal) {
  assertActive(signal);
  const existing = await extensionApi.bookmarks.getChildren(parentId);
  const folderMap = new Map(existing.filter((item) => !item.url).map((item) => [item.title, item]));
  for (const [index, child] of (children || []).entries()) {
    assertActive(signal);
    const path = `${parentPath} / ${child.title || "未命名"}`;
    const key = keyPrefix ? `${keyPrefix}.${index}` : String(index);
    if (child.url) {
      const match = classifyBookmark(existing, child);
      if (mode === "smart" && match === "exact") {
        stats.skipped += 1;
        recordDiff(stats, "skip", "跳过精确重复", path, key);
      } else if (mode === "smart" && match === "same-url" && conflictMode === "skip-url") {
        stats.skipped += 1;
        stats.conflicts += 1;
        recordDiff(stats, "skip", "跳过同网址冲突", path, key);
      } else {
        stats.bookmarks += 1;
        const conflict = match === "same-url" || match === "same-title";
        if (conflict) stats.conflicts += 1;
        recordDiff(stats, conflict ? "conflict" : "add", conflict ? "保留冲突书签" : "新增书签", path, key);
        existing.push(child);
      }
    } else {
      const folder = mode === "smart" ? folderMap.get(child.title) : null;
      if (folder) {
        stats.reusedFolders += 1;
        recordDiff(stats, "reuse", "复用文件夹", path, key);
        await calculateDiff(folder.id, child.children, stats, path, key, mode, conflictMode, signal);
      } else await recordNewSubtree(child, path, key, stats, signal);
    }
  }
}

function selectedDiffCount(diff) {
  return diff.entries.filter((item) => item.status !== "skip" && !isPathExcluded(item.key, state.excludedKeys)).length;
}

function includeDiffPath(pathKey) {
  for (const key of [...state.excludedKeys]) {
    if (key === pathKey || key.startsWith(`${pathKey}.`) || pathKey.startsWith(`${key}.`)) state.excludedKeys.delete(key);
  }
}

function currentFilteredEntries(diff) {
  return filterDiffEntries(diff.entries, state.diffFilter, state.diffQuery);
}

function renderDiffEntries(diff) {
  const list = $("diff-list");
  list.replaceChildren();
  const filteredEntries = currentFilteredEntries(diff);
  const visibleEntries = filteredEntries.slice(0, state.diffVisibleLimit);
  for (const item of visibleEntries) {
    const row = document.createElement("li");
    row.className = item.status;
    const label = document.createElement("label");
    label.className = "diff-choice";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.disabled = item.status === "skip";
    checkbox.checked = item.status !== "skip" && !isPathExcluded(item.key, state.excludedKeys);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) includeDiffPath(item.key);
      else state.excludedKeys.add(item.key);
      renderDiffEntries(diff);
    });
    const text = document.createElement("span");
    text.textContent = `${item.kind} · ${item.path}`;
    label.append(checkbox, text);
    row.append(label);
    list.append(row);
  }
  const selected = selectedDiffCount(diff);
  $("selection-summary").textContent = `全部 ${diff.total.toLocaleString()} 条 ｜ 当前筛选 ${filteredEntries.length.toLocaleString()} 条 ｜ 已选择 ${selected.toLocaleString()} 条可处理项目`;
  $("merge-token").disabled = selected === 0;
  $("diff-more").textContent = filteredEntries.length > visibleEntries.length
    ? `已显示 ${visibleEntries.length.toLocaleString()} 条，还有 ${(filteredEntries.length - visibleEntries.length).toLocaleString()} 条。`
    : filteredEntries.length ? `已显示当前筛选的全部 ${filteredEntries.length.toLocaleString()} 条。` : "没有匹配的差异。";
  $("load-more-diff").classList.toggle("hidden", filteredEntries.length <= visibleEntries.length);
}

function exportDiffReport() {
  if (!state.diff || !state.incoming) return;
  const metadata = state.incoming.metadata || {};
  const lines = [
    "书签桥差异报告",
    `导出时间：${new Date().toLocaleString()}`,
    `来源浏览器：${metadata.sourceBrowser || "未知"}`,
    `来源文件夹：${state.incoming.root.title || "未命名"}`,
    `同步内容创建时间：${new Date(state.incoming.createdAt).toLocaleString()}`,
    `目标位置：${$("destination-root").selectedOptions[0]?.textContent || "未知"}`,
    "",
    "处理状态\t类型\t路径",
    ...state.diff.entries.map((item) => `${item.status === "skip" || isPathExcluded(item.key, state.excludedKeys) ? "不写入" : "写入"}\t${item.kind}\t${item.path}`),
  ];
  downloadTextFile(lines.join("\n"), `书签桥差异报告-${new Date().toISOString().slice(0, 10)}.txt`);
}

function createDiffToolbar(diff) {
  const toolbar = document.createElement("div");
  toolbar.className = "diff-toolbar";
  const search = document.createElement("input");
  search.id = "diff-search";
  search.type = "search";
  search.placeholder = "搜索差异路径";
  search.value = state.diffQuery;
  const filter = document.createElement("select");
  filter.id = "diff-filter";
  [
    ["all", "全部状态"],
    ["add", "新增"],
    ["conflict", "冲突"],
    ["reuse", "复用文件夹"],
    ["skip", "跳过"],
  ].forEach(([value, label]) => filter.add(new Option(label, value)));
  filter.value = state.diffFilter;
  const actions = document.createElement("div");
  actions.className = "diff-actions";
  const selectVisible = document.createElement("button");
  selectVisible.type = "button";
  selectVisible.textContent = "选择筛选结果";
  const excludeVisible = document.createElement("button");
  excludeVisible.type = "button";
  excludeVisible.textContent = "排除筛选结果";
  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.textContent = "导出报告";
  search.addEventListener("input", () => {
    state.diffQuery = search.value;
    state.diffVisibleLimit = 100;
    renderDiffEntries(diff);
  });
  filter.addEventListener("change", () => {
    state.diffFilter = filter.value;
    state.diffVisibleLimit = 100;
    renderDiffEntries(diff);
  });
  selectVisible.addEventListener("click", () => {
    currentFilteredEntries(diff).filter((item) => item.status !== "skip").forEach((item) => includeDiffPath(item.key));
    renderDiffEntries(diff);
  });
  excludeVisible.addEventListener("click", () => {
    currentFilteredEntries(diff).filter((item) => item.status !== "skip").forEach((item) => state.excludedKeys.add(item.key));
    renderDiffEntries(diff);
  });
  exportButton.addEventListener("click", exportDiffReport);
  actions.append(selectVisible, excludeVisible, exportButton);
  toolbar.append(search, filter, actions);
  return toolbar;
}

async function renderPreview(signal) {
  const incoming = state.incoming;
  if (!incoming) return;
  const destination = $("destination-root").selectedOptions[0]?.textContent || "目标位置";
  const mode = document.querySelector('input[name="merge-mode"]:checked').value;
  const conflictMode = document.querySelector('input[name="conflict-mode"]:checked').value;
  const sourceCounts = countNodes(incoming.root);
  const diff = { bookmarks: 0, folders: 0, skipped: 0, reusedFolders: 0, conflicts: 0, total: 0, expected: sourceCounts.items, entries: [] };
  await calculateDiff($("destination-root").value, incoming.root.children, diff, incoming.root.title || "来源", "", mode, conflictMode, signal);
  // 预览期间同步码可能被导入或手动修改；此时不渲染已经过期的计算结果。
  if (state.incoming !== incoming) return;
  state.diff = diff;
  const preview = $("preview");
  preview.replaceChildren();
  const summary = document.createElement("div");
  summary.className = "preview-summary";
  const contentType = incoming.purpose === "pre-merge-backup" ? "恢复副本" : "同步内容";
  const metadata = incoming.metadata || {};
  summary.textContent = `类型：${contentType} ｜ 来源浏览器：${metadata.sourceBrowser || "旧版同步码未记录"}\n来源：${incoming.root.title || "未命名"} ｜ 创建时间：${new Date(incoming.createdAt).toLocaleString()} ｜ 格式：BM${metadata.formatVersion || incoming.v}\n共 ${sourceCounts.folders.toLocaleString()} 个文件夹、${sourceCounts.bookmarks.toLocaleString()} 个书签 → ${destination}\n预计新增 ${diff.bookmarks.toLocaleString()} 个书签、${diff.folders.toLocaleString()} 个文件夹，复用 ${diff.reusedFolders.toLocaleString()} 个文件夹，跳过 ${diff.skipped.toLocaleString()} 项，发现 ${diff.conflicts.toLocaleString()} 个冲突`;
  preview.append(summary);
  preview.append(createDiffToolbar(diff));
  const selectionSummary = document.createElement("div");
  selectionSummary.id = "selection-summary";
  selectionSummary.className = "selection-summary";
  preview.append(selectionSummary);
  const list = document.createElement("ul");
  list.id = "diff-list";
  list.className = "diff-list";
  preview.append(list);
  const more = document.createElement("div");
  more.id = "diff-more";
  more.className = "diff-more";
  preview.append(more);
  const loadMore = document.createElement("button");
  loadMore.id = "load-more-diff";
  loadMore.className = "load-more hidden";
  loadMore.type = "button";
  loadMore.textContent = "再显示 100 条";
  loadMore.addEventListener("click", () => {
    state.diffVisibleLimit += 100;
    renderDiffEntries(diff);
  });
  preview.append(loadMore);
  renderDiffEntries(diff);
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

async function mergeChildren(parentId, children, keyPrefix, mode, conflictMode, stats, signal) {
  const existing = mode === "smart" ? await extensionApi.bookmarks.getChildren(parentId) : [];
  const folderMap = new Map(existing.filter((item) => !item.url).map((item) => [item.title, item]));
  for (const [index, child] of (children || []).entries()) {
    assertActive(signal);
    const pathKey = keyPrefix ? `${keyPrefix}.${index}` : String(index);
    if (isPathExcluded(pathKey, state.excludedKeys)) {
      const excludedCount = child.url ? 1 : countNodes(child).items + 1;
      stats.processed += excludedCount;
      stats.excluded += excludedCount;
      continue;
    }
    stats.processed += 1;
    updateProgress(true, `正在合并：${stats.processed}/${stats.total} 项`, 25 + (stats.processed / stats.total) * 70);
    if (child.url) {
      const match = classifyBookmark(existing, child);
      if (mode === "smart" && (match === "exact" || (match === "same-url" && conflictMode === "skip-url"))) {
        stats.skipped += 1;
        continue;
      }
      const created = await extensionApi.bookmarks.create({ parentId, title: child.title, url: child.url });
      stats.bookmarks += 1;
      stats.createdNodes.push({ id: created.id, type: "bookmark", parentId: created.parentId, title: created.title, url: created.url });
      existing.push(created);
    } else {
      let folder = mode === "smart" ? folderMap.get(child.title) : null;
      if (!folder) { folder = await extensionApi.bookmarks.create({ parentId, title: child.title }); stats.folders += 1; stats.createdNodes.push({ id: folder.id, type: "folder", parentId: folder.parentId, title: folder.title }); folderMap.set(child.title, folder); }
      await mergeChildren(folder.id, child.children, pathKey, mode, conflictMode, stats, signal);
    }
  }
}

async function addMergeHistory(stats, partial = false) {
  if (!stats.createdNodes.length) return;
  state.mergeHistory.unshift({ createdNodes: [...stats.createdNodes], createdAt: new Date(), bookmarks: stats.bookmarks, folders: stats.folders, skipped: stats.skipped, partial });
  state.mergeHistory = state.mergeHistory.slice(0, HISTORY_MAX_RECORDS);
  try { await persistMergeHistory(); } catch (_) { /* IndexedDB 不可用时仍保留本次弹窗会话记录。 */ }
  renderMergeHistory();
}

function renderMergeHistory() {
  const container = $("merge-history");
  container.replaceChildren();
  if (!state.mergeHistory.length) { container.classList.add("hidden"); return; }
  container.classList.remove("hidden");
  const title = document.createElement("div");
  title.className = "history-title";
  title.textContent = "最近 7 天的合并历史（关闭弹窗后仍可撤销）";
  container.append(title);
  state.mergeHistory.forEach((record, index) => {
    const row = document.createElement("div");
    row.className = "history-row";
    const text = document.createElement("span");
    text.textContent = `${record.createdAt.toLocaleString()} · 新增 ${record.bookmarks} 个书签、${record.folders} 个文件夹${record.partial ? "（已取消）" : ""}${record.undoPending ? `（${record.createdNodes.length} 项未安全撤销）` : ""}`;
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

function downloadTextFile(content, filename) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function createRecoveryBackup(signal) {
  if (!$("create-backup").checked) return false;
  updateProgress(true, "正在创建合并前恢复副本…", 10);
  const [root] = await extensionApi.bookmarks.getSubTree($("destination-root").value);
  assertActive(signal);
  const password = $("receive-password").value;
  const payload = {
    v: 2,
    kind: "chrome-bookmark-bridge",
    purpose: "pre-merge-backup",
    createdAt: new Date().toISOString(),
    root: serialiseNode(root),
  };
  const token = await encodeToken(payload, password.length >= 8 ? password : "");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  downloadTextFile(token, `书签桥-合并前恢复副本-${timestamp}.bookmarkbridge`);
  return true;
}

async function mergeToken(signal) {
  if (!state.incoming) return;
  const mode = document.querySelector('input[name="merge-mode"]:checked').value;
  const conflictMode = document.querySelector('input[name="conflict-mode"]:checked').value;
  const stats = { bookmarks: 0, folders: 0, skipped: 0, excluded: 0, processed: 0, total: Math.max(1, countNodes(state.incoming.root).items), createdNodes: [] };
  updateProgress(true, "准备合并…", 20);
  try {
    const backupCreated = await createRecoveryBackup(signal);
    await mergeChildren($("destination-root").value, state.incoming.root.children, "", mode, conflictMode, stats, signal);
    await addMergeHistory(stats);
    setResult("receive-result", `合并完成：新增 ${stats.bookmarks} 个书签、${stats.folders} 个文件夹，跳过 ${stats.skipped} 个重复项，手动排除 ${stats.excluded} 项。${backupCreated ? "合并前恢复副本已保存到下载目录。" : ""}`);
    updateProgress(true, "合并完成", 100);
    await loadRoots();
    await renderPreview(signal);
    scheduleProgressHide(1200);
  } catch (error) {
    if (stats.createdNodes.length) await addMergeHistory(stats, true);
    updateProgress(false);
    setResult("receive-result", error.code === "ABORTED" ? "已取消合并；已创建内容已记录在合并历史中，可单独撤销。" : `合并失败：${error.message || error}`, error.code !== "ABORTED");
  }
}

async function undoMerge(index, signal) {
  const record = state.mergeHistory[index];
  if (!record?.createdNodes?.length) return;
  updateProgress(true, "正在撤销本次合并…", 50);
  const nodes = [...record.createdNodes].reverse();
  const remaining = [];
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = nodes[nodeIndex];
    try {
      assertActive(signal);
      const currentNodes = await extensionApi.bookmarks.get(node.id);
      const current = currentNodes[0];
      if (!current) continue;
      const changedByUser = (node.parentId && current.parentId !== node.parentId)
        || (node.title !== undefined && current.title !== node.title)
        || (node.url !== undefined && current.url !== node.url);
      if (changedByUser) {
        remaining.push(node);
        continue;
      }
      // 不使用 removeTree：若用户在合并后手动向该文件夹新增内容，递归删除会误伤用户数据。
      await extensionApi.bookmarks.remove(node.id);
    } catch (error) {
      if (error.code === "ABORTED") {
        remaining.push(...nodes.slice(nodeIndex));
        record.createdNodes = remaining.reverse();
        record.undoPending = true;
        try { await persistMergeHistory(); } catch (_) { /* 保留内存中的撤销进度。 */ }
        renderMergeHistory();
        throw error;
      }
      // 书签被移动、已删除或文件夹仍有用户后来添加的内容时保留该项，供用户稍后再次撤销。
      remaining.push(node);
    }
  }
  record.createdNodes = remaining.reverse();
  record.undoPending = record.createdNodes.length > 0;
  if (!record.createdNodes.length) state.mergeHistory.splice(index, 1);
  try { await persistMergeHistory(); } catch (_) { /* 保留内存中的撤销结果。 */ }
  renderMergeHistory();
  await loadRoots();
  if (state.incoming) await renderPreview(signal);
  updateProgress(false);
  setResult("receive-result", record.undoPending ? `已撤销可安全删除的内容；仍有 ${record.createdNodes.length} 项未撤销，可能已被移动或包含后来新增的内容。` : "已撤销本次合并，目标端原有书签未受影响。", record.undoPending);
}

async function copyToken() {
  await navigator.clipboard.writeText($("token-output").value);
  setResult("send-result", "同步码已复制到剪贴板，可以在目标环境粘贴。" + (state.sendSummary ? `\n${state.sendSummary}` : ""));
}

function setOperationControlsLocked(locked) {
  if (locked) {
    const controls = document.querySelectorAll("#source-filter, #source-root, #toggle-source-tree, #send-password, #send-password-confirm, #create-token, #token-input, #open-file-import, #receive-password, #inspect-token, #destination-root, input[name='merge-mode'], input[name='conflict-mode'], #create-backup, #preview input, #merge-token, #merge-history button");
    state.lockedControls = [...controls].map((control) => ({ control, disabled: control.disabled }));
    state.lockedControls.forEach(({ control }) => { control.disabled = true; });
    return;
  }
  state.lockedControls.forEach(({ control, disabled }) => { control.disabled = disabled; });
  state.lockedControls = [];
}

async function runBusy(buttonId, task) {
  if (state.operation) throw new Error("当前已有操作正在进行，请等待完成或点击取消");
  const button = typeof buttonId === "string" ? $(buttonId) : buttonId;
  const signal = beginOperation();
  setOperationControlsLocked(true);
  try { await task(signal); } finally { endOperation(); setOperationControlsLocked(false); }
}

function downloadToken() {
  const selectedName = $("source-root").selectedOptions[0]?.textContent?.trim() || "书签";
  const safeName = selectedName.replace(/[\\/:*?"<>|]/g, "-").slice(-40);
  downloadTextFile($("token-output").value, `书签桥-${safeName}-${new Date().toISOString().slice(0, 10)}.bookmarkbridge`);
}

$("create-token").addEventListener("click", () => runBusy("create-token", createToken).catch((error) => { updateProgress(false); setResult("send-result", error.code === "ABORTED" ? "已取消生成。" : (error.message || String(error)), error.code !== "ABORTED"); }));
$("inspect-token").addEventListener("click", () => runBusy("inspect-token", inspectToken));
$("merge-token").addEventListener("click", () => runBusy("merge-token", mergeToken));
$("copy-token").addEventListener("click", () => copyToken().catch((error) => setResult("send-result", error.message || String(error), true)));
$("download-token").addEventListener("click", downloadToken);
$("source-filter").addEventListener("input", applySourceFilter);
$("toggle-source-tree").addEventListener("click", () => { state.sourceExpanded = !state.sourceExpanded; applySourceFilter(); });
$("token-input").addEventListener("input", invalidateIncomingPreview);
$("destination-root").addEventListener("change", () => {
  if (state.operation) return;
  renderPreview().catch((error) => setResult("receive-result", error.message || String(error), true));
});
document.querySelectorAll('input[name="merge-mode"], input[name="conflict-mode"]').forEach((control) => {
  control.addEventListener("change", () => {
    if (state.operation || !state.incoming) return;
    state.excludedKeys.clear();
    runBusy(control, renderPreview).catch((error) => setResult("receive-result", error.message || String(error), true));
  });
});
$("cancel-operation").addEventListener("click", () => { if (state.operation) state.operation.abort(); });
async function importTokenFile(file) {
  if (!file) return;
  try {
    if (file.size > MAX_TOKEN_CHARS) throw new Error("同步文件过大，最多支持 10 MB；请确认选择了正确文件");
    state.incoming = null;
    state.excludedKeys.clear();
    state.diffFilter = "all";
    state.diffQuery = "";
    state.diffVisibleLimit = 100;
    $("preview").classList.add("hidden");
    $("merge-options").classList.add("hidden");
    $("token-input").value = await file.text();
    $("file-name").textContent = file.name;
    state.importedFile = { name: file.name, size: file.size };
    setResult("receive-result", `${describeTransfer($("token-input").value, state.importedFile)}\n请输入同步密码后点击“解密并预览差异”。`);
  } catch (error) { setResult("receive-result", `文件读取失败：${error.message || error}`, true); }
}

$("open-file-import").addEventListener("click", async () => {
  try {
    if (!extensionApi.sidePanel?.open) throw new Error("当前浏览器版本不支持插件侧边栏，请使用拖拽导入");
    const currentWindow = await extensionApi.windows.getCurrent();
    await extensionApi.sidePanel.open({ windowId: currentWindow.id });
  } catch (error) {
    setResult("receive-result", `无法打开插件侧边栏：${error.message || error}`, true);
  }
});
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
$("drop-zone").addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") $("open-file-import").click(); });

(async function init() {
  try {
    await loadRoots();
    await loadMergeHistory();
    await consumePendingImport();
    $("browser-name").textContent = currentBrowserName();
  } catch (error) { setResult("send-result", `无法读取当前书签：${error.message || error}`, true); }
})();
