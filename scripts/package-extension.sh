#!/usr/bin/env bash
set -euo pipefail

# 从同一份运行时代码生成 Chrome 与 Edge 安装包，避免两个浏览器版本发生漂移。
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

version="$(node -e "const fs=require('fs'); const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8')); process.stdout.write(manifest.version);")"
runtime_files=(
  manifest.json
  popup.html
  popup.css
  popup.js
  bookmark-core.js
  file-import.html
  file-import.css
  file-import.js
  icon-16.png
  icon-32.png
  icon-48.png
  icon-128.png
)
chrome_package="dist/书签桥-v${version}.zip"
edge_package="dist/书签桥-edge-v${version}.zip"
checksum_file="dist/SHA256SUMS-v${version}.txt"

mkdir -p dist
rm -f "$chrome_package" "$edge_package" "$checksum_file"
zip -X -q "$chrome_package" "${runtime_files[@]}"
cp "$chrome_package" "$edge_package"

(
  cd dist
  shasum -a 256 "书签桥-v${version}.zip" "书签桥-edge-v${version}.zip" > "SHA256SUMS-v${version}.txt"
)

echo "已生成 v${version} Chrome/Edge 安装包和 SHA-256 校验文件。"
