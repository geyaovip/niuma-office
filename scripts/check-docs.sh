#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

required_files=(
  README.md
  AGENTS.md
  docs/README.md
  docs/context-routes.md
  docs/project/current-story.md
  docs/stories/_template.md
  docs/product/product-baseline.md
  docs/product/ui-and-flows.md
  docs/product/website.md
  docs/product/brand.md
  assets/brand/niuma-mascot-mark-v3.png
  assets/brand/niuma-app-icon-v3.png
  docs/architecture/technical-baseline.md
  docs/project/decision-log.md
  docs/project/open-questions.md
  docs/project/mvp-backlog.md
  docs/archive/牛马办公_V1产品方案.md
)

for doc_file in "${required_files[@]}"; do
  if [[ ! -s "$doc_file" ]]; then
    echo "Missing or empty required document: $doc_file" >&2
    exit 1
  fi
done

decision_ids="$(rg -o 'D-[0-9]{3}' docs/project/decision-log.md | sort)"
if [[ "$(printf '%s\n' "$decision_ids" | wc -l | tr -d ' ')" != "$(printf '%s\n' "$decision_ids" | sort -u | wc -l | tr -d ' ')" ]]; then
  echo "Duplicate decision ID detected" >&2
  exit 1
fi

story_ids="$(rg -o 'XB-[0-9]{3}' docs/project/mvp-backlog.md | sort)"
if [[ "$(printf '%s\n' "$story_ids" | wc -l | tr -d ' ')" != "$(printf '%s\n' "$story_ids" | sort -u | wc -l | tr -d ' ')" ]]; then
  echo "Duplicate Story ID detected" >&2
  exit 1
fi

rg -q '默认 Workspace' README.md docs/product/product-baseline.md
rg -q 'macOS Human Interface Guidelines' docs/product/ui-and-flows.md
rg -q '企业微信与个人微信不在当前范围' docs/project/decision-log.md
rg -q '不建设独立“全部任务”页面' AGENTS.md
rg -q '不是 Demo' AGENTS.md docs/product/product-baseline.md
rg -q '第一版包含正式官网' docs/project/decision-log.md
rg -q 'D-023' docs/project/decision-log.md
rg -q 'D-024' docs/project/decision-log.md
rg -q 'D-025' docs/project/decision-log.md
rg -q '静态生成或服务端预渲染' docs/product/website.md docs/architecture/technical-baseline.md

if [[ -e '牛马办公_V1产品方案.md' ]]; then
  echo 'Original proposal must remain under docs/archive, not repository root' >&2
  exit 1
fi

while IFS= read -r active_doc; do
  line_count="$(wc -l < "$active_doc" | tr -d ' ')"
  if (( line_count > 250 )); then
    echo "Active document exceeds 250-line context budget; split it: $active_doc" >&2
    exit 1
  fi
done < <(find docs -type f -name '*.md' ! -path 'docs/archive/*' | sort)

echo "Documentation checks passed."
