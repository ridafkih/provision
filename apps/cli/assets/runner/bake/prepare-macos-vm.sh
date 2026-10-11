#!/usr/bin/env bash
set -euo pipefail

[[ $# -eq 3 ]] || { printf 'usage: prepare-macos-vm.sh <runner version> <runner url> <runner sha256>\n' >&2; exit 2; }
readonly runner_version="$1"
readonly runner_url="$2"
readonly runner_sha256="$3"
readonly runner_home="/Users/admin/actions-runner"
readonly archive="$(mktemp)"
trap 'rm -f "$archive"' EXIT

curl --fail --silent --show-error --location --retry 3 --output "$archive" "$runner_url"
printf '%s  %s\n' "$runner_sha256" "$archive" | shasum -a 256 --check --strict
rm -rf "$runner_home"
install -d "$runner_home"
tar -xzf "$archive" -C "$runner_home"
chown -R admin:staff "$runner_home"
[[ "$(sudo -u admin "$runner_home/config.sh" --version)" == "$runner_version" ]]

xcode="$(xcodebuild -version | head -n 1)"
swift_version="$(swift --version 2>&1 | head -n 1)"
printf 'provisioned: actions runner %s with %s (%s)\n' "$runner_version" "$xcode" "$swift_version"
