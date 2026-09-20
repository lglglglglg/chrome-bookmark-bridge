#!/usr/bin/env bash
set -euo pipefail

# 发布前检查：不依赖第三方包，确保扩展源码、清单和两个浏览器发布包保持一致。
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

node --check popup.js
node --check file-import.js

version="$(node -e "const fs=require('fs'); const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8')); if (!/^\\d+\\.\\d+\\.\\d+$/.test(manifest.version)) throw new Error('manifest 版本格式无效'); if (manifest.manifest_version !== 3) throw new Error('仅支持 Manifest V3'); process.stdout.write(manifest.version);")"
chrome_package="dist/书签桥-v${version}.zip"
edge_package="dist/书签桥-edge-v${version}.zip"

test -f "$chrome_package"
test -f "$edge_package"
unzip -t "$chrome_package" >/dev/null
unzip -t "$edge_package" >/dev/null
cmp -s "$chrome_package" "$edge_package"

temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/bookmark-bridge-check.XXXXXX")"
trap 'rm -rf "$temporary_directory"' EXIT
unzip -qq "$chrome_package" -d "$temporary_directory"

for runtime_file in manifest.json popup.html popup.css popup.js file-import.html file-import.css file-import.js icon-16.png icon-32.png icon-48.png icon-128.png; do
  diff -q "$runtime_file" "$temporary_directory/$runtime_file" >/dev/null
done

echo "检查通过：v${version} 源码、Chrome 包和 Edge 包一致。"
