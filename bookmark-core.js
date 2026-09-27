(function initialiseBookmarkBridgeCore(globalObject) {
  "use strict";

  const TOKEN_PREFIX = "BM2.";
  const LEGACY_TOKEN_PREFIX = "BM1.";
  const PBKDF2_ITERATIONS = 210000;
  const MAX_TOKEN_CHARS = 10 * 1024 * 1024;
  const MAX_DECOMPRESSED_BYTES = 25 * 1024 * 1024;

  function countNodes(node) {
    let bookmarks = 0;
    let folders = 0;
    let items = 0;
    for (const child of node.children || []) {
      items += 1;
      if (child.url) bookmarks += 1;
      else {
        folders += 1;
        const nested = countNodes(child);
        bookmarks += nested.bookmarks;
        folders += nested.folders;
        items += nested.items;
      }
    }
    return { bookmarks, folders, items };
  }

  function serialiseNode(node) {
    return {
      title: node.title || "",
      ...(node.url
        ? { url: node.url }
        : { children: (node.children || []).map(serialiseNode) }),
    };
  }

  function classifyBookmark(existingItems, candidate) {
    const bookmarks = existingItems.filter((item) => item.url);
    if (bookmarks.some((item) => item.url === candidate.url && item.title === candidate.title)) return "exact";
    if (bookmarks.some((item) => item.url === candidate.url)) return "same-url";
    if (bookmarks.some((item) => item.title === candidate.title)) return "same-title";
    return "new";
  }

  function isPathExcluded(pathKey, excludedKeys) {
    if (!pathKey) return false;
    const parts = pathKey.split(".");
    for (let length = parts.length; length > 0; length -= 1) {
      if (excludedKeys.has(parts.slice(0, length).join("."))) return true;
    }
    return false;
  }

  function inspectTokenEnvelope(token) {
    const compact = token.trim().replace(/\s+/g, "");
    if (compact.startsWith(LEGACY_TOKEN_PREFIX)) {
      return { format: "BM1", encrypted: false, compression: "none", characters: compact.length };
    }
    if (!compact.startsWith(TOKEN_PREFIX)) throw new Error("同步码格式不正确，应以 BM2. 开头");
    const envelope = bytesToJson(base64UrlToBytes(compact.slice(TOKEN_PREFIX.length)));
    if (envelope.v !== 2 || envelope.kind !== "chrome-bookmark-bridge") throw new Error("同步码版本不受支持或内容已损坏");
    return {
      format: "BM2",
      encrypted: envelope.encrypted !== false,
      compression: envelope.compression || "none",
      characters: compact.length,
    };
  }

  function filterDiffEntries(entries, status, query) {
    const normalizedQuery = (query || "").trim().toLocaleLowerCase();
    return entries.filter((entry) => {
      if (status !== "all" && entry.status !== status) return false;
      if (!normalizedQuery) return true;
      return `${entry.kind} ${entry.path}`.toLocaleLowerCase().includes(normalizedQuery);
    });
  }

  function bytesToBase64Url(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function base64UrlToBytes(value) {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function bytesToJson(bytes) {
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  async function readStreamBytes(stream, maxBytes = Infinity) {
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        const error = new Error("同步码解压后的内容过大，已停止处理");
        error.code = "PAYLOAD_TOO_LARGE";
        throw error;
      }
      chunks.push(value);
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }

  async function transformBytes(bytes, type) {
    if (type === "gzip" && typeof CompressionStream !== "undefined") {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    if (type === "gunzip" && typeof DecompressionStream !== "undefined") {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      return readStreamBytes(stream, MAX_DECOMPRESSED_BYTES);
    }
    return bytes;
  }

  async function deriveKey(password, salt) {
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  async function encodeToken(value, password) {
    const raw = new TextEncoder().encode(JSON.stringify(value));
    const compressed = raw.length > 1024 ? await transformBytes(raw, "gzip") : raw;
    const compression = compressed.length < raw.length ? "gzip" : "none";
    const input = compression === "gzip" ? compressed : raw;
    if (!password) {
      const envelope = {
        v: 2,
        kind: "chrome-bookmark-bridge",
        encrypted: false,
        compression,
        data: bytesToBase64Url(input),
      };
      return TOKEN_PREFIX + bytesToBase64Url(new TextEncoder().encode(JSON.stringify(envelope)));
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, input));
    const envelope = {
      v: 2,
      kind: "chrome-bookmark-bridge",
      encrypted: true,
      alg: "PBKDF2-AES-GCM",
      compression,
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64Url(salt),
      iv: bytesToBase64Url(iv),
      ciphertext: bytesToBase64Url(ciphertext),
    };
    return TOKEN_PREFIX + bytesToBase64Url(new TextEncoder().encode(JSON.stringify(envelope)));
  }

  function validatePayload(payload, expectedVersion) {
    if (
      payload.v !== expectedVersion
      || payload.kind !== "chrome-bookmark-bridge"
      || !payload.root
      || !Array.isArray(payload.root.children)
    ) {
      throw new Error(expectedVersion === 1 ? "同步码版本不受支持或内容已损坏" : "同步码内容不完整");
    }
    return payload;
  }

  async function decodeToken(token, password) {
    const compact = token.trim().replace(/\s+/g, "");
    if (!compact) throw new Error("请粘贴同步码，或导入同步文件");
    if (compact.length > MAX_TOKEN_CHARS) throw new Error("同步码过大，最多支持 10 MB；请确认文件内容是否正确");
    if (compact.startsWith(LEGACY_TOKEN_PREFIX)) {
      return validatePayload(bytesToJson(base64UrlToBytes(compact.slice(LEGACY_TOKEN_PREFIX.length))), 1);
    }
    if (!compact.startsWith(TOKEN_PREFIX)) throw new Error("同步码格式不正确，应以 BM2. 开头");
    try {
      const envelope = bytesToJson(base64UrlToBytes(compact.slice(TOKEN_PREFIX.length)));
      if (
        envelope.v !== 2
        || envelope.kind !== "chrome-bookmark-bridge"
        || !["none", "gzip"].includes(envelope.compression || "none")
      ) throw new Error("同步码版本不受支持或内容已损坏");
      const compression = envelope.compression || "none";
      let plaintext;
      if (envelope.encrypted === false) {
        if (!envelope.data) throw new Error("同步码内容不完整");
        plaintext = base64UrlToBytes(envelope.data);
      } else {
        if (!password || password.length < 8) throw new Error("请输入至少 8 位同步密码");
        if (!envelope.alg || !envelope.salt || !envelope.iv || !envelope.ciphertext) {
          throw new Error("同步码版本不受支持或内容已损坏");
        }
        const key = await deriveKey(password, base64UrlToBytes(envelope.salt));
        plaintext = new Uint8Array(await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: base64UrlToBytes(envelope.iv) },
          key,
          base64UrlToBytes(envelope.ciphertext),
        ));
      }
      if (compression === "gzip") {
        if (typeof DecompressionStream === "undefined") {
          throw new Error("当前浏览器不支持解压此同步码，请更新浏览器后重试");
        }
        plaintext = await transformBytes(plaintext, "gunzip");
      }
      return validatePayload(bytesToJson(plaintext), 2);
    } catch (error) {
      const expectedMessages = new Set([
        "同步码版本不受支持或内容已损坏",
        "同步码内容不完整",
        "请输入至少 8 位同步密码",
        "当前浏览器不支持解压此同步码，请更新浏览器后重试",
      ]);
      if (error.code === "PAYLOAD_TOO_LARGE" || expectedMessages.has(error.message)) throw error;
      throw new Error("密码错误，或同步码已损坏");
    }
  }

  const api = {
    LEGACY_TOKEN_PREFIX,
    MAX_DECOMPRESSED_BYTES,
    MAX_TOKEN_CHARS,
    PBKDF2_ITERATIONS,
    TOKEN_PREFIX,
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
  };

  globalObject.BookmarkBridgeCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
