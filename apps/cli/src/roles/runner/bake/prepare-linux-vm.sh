#!/usr/bin/env bash
set -euo pipefail

[[ $# -ge 3 ]] || { printf 'usage: prepare-linux-vm.sh <runner version> <runner url> <runner sha256> [image ...]\n' >&2; exit 2; }
readonly runner_version="$1"
readonly runner_url="$2"
readonly runner_sha256="$3"
shift 3
readonly runner_home="/home/admin/actions-runner"
readonly archive="$(mktemp)"
trap 'rm -f "$archive"' EXIT

export DEBIAN_FRONTEND=noninteractive
apt-get update --quiet
apt-get upgrade --yes --quiet
usermod --append --groups docker admin

curl --fail --silent --show-error --location --retry 3 --output "$archive" "$runner_url"
printf '%s  %s\n' "$runner_sha256" "$archive" | sha256sum --check --strict
rm -rf "$runner_home"
install -d "$runner_home"
tar -xzf "$archive" -C "$runner_home"
chown -R admin:admin "$runner_home"
"$runner_home/bin/installdependencies.sh" >/dev/null
[[ "$(sudo -u admin "$runner_home/config.sh" --version)" == "$runner_version" ]]

systemctl enable --now docker
for image in "$@"; do
  docker pull --quiet "$image"
done

apt-get clean
fstrim --all --quiet-unsupported
printf 'provisioned: actions runner %s and %s prepulled images\n' "$runner_version" "$#"
