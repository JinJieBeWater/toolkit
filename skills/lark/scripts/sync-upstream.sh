#!/usr/bin/env bash
set -euo pipefail

skill_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source_dir=${1:-}
tmp_dir=

cleanup() {
  if [[ -n "$tmp_dir" ]]; then
    rm -rf "$tmp_dir"
  fi
}
trap cleanup EXIT

if [[ -z "$source_dir" ]]; then
  tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/lark-cli-skills.XXXXXX")
  git clone --depth 1 --filter=blob:none --sparse https://github.com/larksuite/cli.git "$tmp_dir/repo" >/dev/null
  git -C "$tmp_dir/repo" sparse-checkout set --no-cone '/skills/' '/LICENSE' '/README.md'
  source_dir="$tmp_dir/repo"
fi

if [[ ! -d "$source_dir/skills" || ! -f "$source_dir/LICENSE" ]]; then
  echo "source must be a larksuite/cli checkout containing skills/ and LICENSE" >&2
  exit 2
fi

commit=$(git -C "$source_dir" rev-parse HEAD 2>/dev/null || printf 'unknown')
stage=$(mktemp -d "${TMPDIR:-/tmp}/lark-skill-stage.XXXXXX")
tmp_dir=${tmp_dir:-$stage}
if [[ "$tmp_dir" != "$stage" ]]; then
  old_tmp_dir=$tmp_dir
  trap 'rm -rf "$old_tmp_dir" "$stage"' EXIT
else
  trap 'rm -rf "$stage"' EXIT
fi

mkdir -p "$stage/upstream"
cp -R "$source_dir/skills/." "$stage/upstream/"
cp "$source_dir/LICENSE" "$stage/upstream/LICENSE"

while IFS= read -r -d '' file; do
  mv "$file" "${file%SKILL.md}DOMAIN.md"
done < <(find "$stage/upstream" -type f -name SKILL.md -print0)

while IFS= read -r -d '' file; do
  perl -pi -e 's/SKILL\.md/DOMAIN.md/g' "$file"
done < <(find "$stage/upstream" -type f -name '*.md' -print0)

# Repair upstream links that point outside their current file or the vendored skills tree.
find "$stage/upstream/lark-mail/references" -type f -name '*.md' -print0 \
  | xargs -0 perl -pi -e 's#\(references/lark-mail-html\.md\)#(lark-mail-html.md)#g'
perl -pi -e 's#\(\.\./\.\./lark-event/references/lark-event-subscribe\.md\)#(../../lark-event/DOMAIN.md)#g' \
  "$stage/upstream/lark-mail/references/lark-mail-watch.md"
perl -pi -e 's#\(\.\./\.\./lark-vc/references/lark-vc-notes\.md\)#(../../lark-vc/DOMAIN.md)#g' \
  "$stage/upstream/lark-minutes/references/lark-minutes-speaker-replace.md"
perl -pi -e 's#\(\.\./creative-design/DOMAIN\.md\)#(../creative-design/creative-design.md)#g' \
  "$stage/upstream/lark-apps/references/lark-apps-local-dev.md"
perl -pi -e 's#\(\.\./\.\./\.\./events/im/message_receive\.go\)#(https://github.com/larksuite/cli/blob/main/events/im/message_receive.go)#g' \
  "$stage/upstream/lark-event/references/lark-event-im.md"

printf '%s\n' "$commit" > "$stage/upstream/UPSTREAM_COMMIT"
printf 'https://github.com/larksuite/cli\n' > "$stage/upstream/UPSTREAM_SOURCE"

rm -rf "$skill_dir/references/upstream"
mkdir -p "$skill_dir/references"
mv "$stage/upstream" "$skill_dir/references/upstream"

domain_count=$(find "$skill_dir/references/upstream" -type f -name DOMAIN.md | wc -l | tr -d ' ')
file_count=$(find "$skill_dir/references/upstream" -type f | wc -l | tr -d ' ')
printf 'synced commit=%s domains=%s files=%s\n' "$commit" "$domain_count" "$file_count"
