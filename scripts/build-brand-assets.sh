#!/bin/sh

set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_image="$repo_root/assets/brand/source/niuma-doubao-reference.png"
mascot="$repo_root/assets/brand/niuma-mascot-mark-v3.png"
app_icon="$repo_root/assets/brand/niuma-app-icon-v3.png"
iconset_dir=$(mktemp -d "${TMPDIR:-/tmp}/niuma-iconset.XXXXXX")
trap 'rm -rf "$iconset_dir"' EXIT

swift "$repo_root/scripts/extract-brand-mascot.swift" "$source_image" "$mascot"
swift "$repo_root/scripts/compose-brand-icon.swift" "$mascot" "$app_icon"

install -m 0644 "$mascot" "$repo_root/apps/desktop/public/brand/niuma-mascot-mark-v3.png"
install -m 0644 "$mascot" "$repo_root/apps/website/public/brand/niuma-mascot-mark-v3.png"
install -m 0644 "$app_icon" "$repo_root/apps/desktop/build/niuma-app-icon-v3.png"
install -m 0644 "$app_icon" "$repo_root/apps/website/public/brand/niuma-app-icon-v3.png"

iconset="$iconset_dir/niuma.iconset"
mkdir -p "$iconset"
sips -z 16 16 "$app_icon" --out "$iconset/icon_16x16.png" >/dev/null
sips -z 32 32 "$app_icon" --out "$iconset/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$app_icon" --out "$iconset/icon_32x32.png" >/dev/null
sips -z 64 64 "$app_icon" --out "$iconset/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$app_icon" --out "$iconset/icon_128x128.png" >/dev/null
sips -z 256 256 "$app_icon" --out "$iconset/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$app_icon" --out "$iconset/icon_256x256.png" >/dev/null
sips -z 512 512 "$app_icon" --out "$iconset/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$app_icon" --out "$iconset/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$app_icon" --out "$iconset/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$iconset" -o "$repo_root/apps/desktop/build/icon.icns"

printf '品牌资产已更新：\n%s\n%s\n%s\n' "$mascot" "$app_icon" "$repo_root/apps/desktop/build/icon.icns"
