const DB_NAME = "bookmarkBridgeImport";
const STORE_NAME = "pending";

const $ = (id) => document.getElementById(id);

function openImportDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开导入缓存"));
  });
}

async function savePendingImport(file) {
  if (!file) return;
  if (!/\.bookmarkbridge$|\.txt$/i.test(file.name) && file.type !== "text/plain") {
    throw new Error("请选择 .bookmarkbridge 或 .txt 同步文件");
  }
  const token = await file.text();
  if (!token.trim().startsWith("BM1.") && !token.trim().startsWith("BM2.")) throw new Error("文件内容不是有效的书签桥同步码");
  const db = await openImportDb();
  await new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put({ token, name: file.name, createdAt: Date.now() }, "token");
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  $("status").className = "status success";
  $("status").textContent = `已准备“${file.name}”。现在回到浏览器工具栏，重新打开书签桥即可自动载入。`;
}

$("file-input").addEventListener("change", (event) => savePendingImport(event.target.files?.[0]).catch((error) => {
  $("status").className = "status error";
  $("status").textContent = error.message || String(error);
}));
$("drop-zone").addEventListener("dragenter", (event) => { event.preventDefault(); $("drop-zone").classList.add("dragover"); });
$("drop-zone").addEventListener("dragover", (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; $("drop-zone").classList.add("dragover"); });
$("drop-zone").addEventListener("dragleave", (event) => { if (!event.currentTarget.contains(event.relatedTarget)) $("drop-zone").classList.remove("dragover"); });
$("drop-zone").addEventListener("drop", (event) => {
  event.preventDefault();
  $("drop-zone").classList.remove("dragover");
  savePendingImport(event.dataTransfer.files?.[0]).catch((error) => {
    $("status").className = "status error";
    $("status").textContent = error.message || String(error);
  });
});
