#!/bin/bash
set -euo pipefail

archive_url="https://github.com/ridafkih/provision/archive/refs/heads/main.tar.gz"
profile=""
provision_arguments=()

while (($# > 0)); do
  case "$1" in
    --profile) profile="${2:?--profile needs a name}"; shift 2 ;;
    --archive) archive_url="${2:?--archive needs a url}"; shift 2 ;;
    *) provision_arguments+=("$1"); shift ;;
  esac
done

[[ "$(uname -s)" == Darwin ]] || { printf 'provision runs on macOS only\n' >&2; exit 1; }
[[ -z "$profile" || "$profile" =~ ^[a-z0-9-]+$ ]] || { printf 'install: bad profile name %s\n' "$profile" >&2; exit 1; }

provision_home="$HOME/.provision"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
curl -fsSL "$archive_url" | tar -xzf - -C "$staging" --strip-components=1

profile_arguments=()
if [[ -n "$profile" ]]; then
  profile_file="$staging/apps/cli/profiles/$profile.args"
  [[ -f "$profile_file" ]] || { printf 'install: no profile named %s\n' "$profile" >&2; exit 1; }
  while IFS= read -r argument || [[ -n "$argument" ]]; do
    [[ -z "$argument" ]] || profile_arguments+=("$argument")
  done <"$profile_file"
fi

mkdir -p -m 700 "$provision_home"
rm -rf "$provision_home/kit"
mv "$staging/apps/cli/src" "$provision_home/kit"
exec /bin/bash "$provision_home/kit/provision.sh" ${profile_arguments[@]+"${profile_arguments[@]}"} ${provision_arguments[@]+"${provision_arguments[@]}"}
