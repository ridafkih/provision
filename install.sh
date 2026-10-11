#!/bin/bash
set -euo pipefail

binary_url="https://github.com/ridafkih/provision/releases/latest/download/provision-darwin-arm64"
provision_arguments=()

while (($# > 0)); do
  case "$1" in
    --binary) binary_url="${2:?--binary needs a url}"; shift 2 ;;
    *) provision_arguments+=("$1"); shift ;;
  esac
done

[[ "$(uname -s)" == Darwin ]] || { printf 'provision runs on macOS only\n' >&2; exit 1; }
[[ "$(uname -m)" == arm64 ]] || { printf 'provision needs a Mac with Apple silicon\n' >&2; exit 1; }

staging="$(mktemp -d)"
curl -fsSL "$binary_url" -o "$staging/provision"
curl -fsSL "$binary_url.sha256" -o "$staging/provision.sha256"
expected="$(awk '{print $1}' "$staging/provision.sha256")"
actual="$(shasum -a 256 "$staging/provision" | awk '{print $1}')"
[[ -n "$expected" && "$expected" == "$actual" ]] || { printf 'install: the downloaded provision binary does not match its checksum\n' >&2; exit 1; }
chmod 755 "$staging/provision"

provision="$staging/provision"
if { : </dev/tty; } 2>/dev/null; then
  exec "$provision" ${provision_arguments[@]+"${provision_arguments[@]}"} </dev/tty
fi
exec "$provision" ${provision_arguments[@]+"${provision_arguments[@]}"}
