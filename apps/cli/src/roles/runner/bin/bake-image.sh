#!/usr/bin/env bash
set -euo pipefail

readonly kit_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$kit_directory/lib/config.sh"
source "$kit_directory/lib/github.sh"
source "$kit_directory/lib/vm.sh"

[[ $# -eq 0 || ( $# -eq 1 && "$1" == "--force" ) ]] || fail "usage: bake-image.sh [--force]"
readonly is_forced="$([[ $# -eq 1 ]] && printf yes || printf no)"

load_runner_config
has_runner_credentials || fail "no GITHUB_RUNNER_TOKEN in $CREDENTIALS_FILE yet"

readonly state_file="$runner_config_directory/golden.env"
readonly staging_vm="$LINUX_GOLDEN_VM-staging"
staging_pid=""

finish() {
  discard_vm "$staging_vm"
  [[ -z "$staging_pid" ]] || wait "$staging_pid" 2>/dev/null || true
}
trap finish EXIT

read -r runner_version runner_url runner_sha256 <<<"$(latest_runner_release)"
[[ -n "$runner_sha256" ]] || fail "the latest actions runner release has no linux arm64 digest"

is_golden_current() {
  [[ "$is_forced" == no ]] || return 1
  vm_exists "$LINUX_GOLDEN_VM" || return 1
  [[ -f "$state_file" ]] || return 1
  local BAKED_RUNNER_VERSION BAKED_AT_EPOCH
  source "$state_file"
  local age_days=$((($(date +%s) - BAKED_AT_EPOCH) / 86400))
  [[ "$BAKED_RUNNER_VERSION" == "$runner_version" ]] && ((age_days < BAKE_MAX_AGE_DAYS))
}

if is_golden_current; then
  log "unchanged: $LINUX_GOLDEN_VM already has actions runner $runner_version and is under $BAKE_MAX_AGE_DAYS days old"
  tart prune --entries=caches --older-than="$BAKE_MAX_AGE_DAYS"
  exit 0
fi

log "baking $LINUX_GOLDEN_VM from $LINUX_BASE_IMAGE with actions runner $runner_version"
discard_vm "$staging_vm"
tart pull "$LINUX_BASE_IMAGE"
tart clone "$LINUX_BASE_IMAGE" "$staging_vm"
tart set "$staging_vm" --cpu "$VM_CPU_COUNT" --memory "$BAKE_MEMORY_MB" --disk-size "$VM_DISK_GB"
tart run --no-graphics --net-softnet "$staging_vm" >>"$LOG_DIRECTORY/bake-vm.log" 2>&1 &
staging_pid=$!
wait_for_guest_agent "$staging_vm" "$staging_pid"

prepull_images=()
[[ -z "$PREPULL_IMAGES" ]] || IFS=',' read -r -a prepull_images <<<"$PREPULL_IMAGES"
tart exec -i "$staging_vm" sudo bash -s -- "$runner_version" "$runner_url" "$runner_sha256" ${prepull_images[@]+"${prepull_images[@]}"} \
  <"$kit_directory/bake/prepare-linux-vm.sh"

tart stop "$staging_vm" --timeout 120
wait "$staging_pid" || true
staging_pid=""
tart set "$staging_vm" --memory "$VM_MEMORY_MB"

discard_vm "$LINUX_GOLDEN_VM"
tart rename "$staging_vm" "$LINUX_GOLDEN_VM"
printf 'BAKED_RUNNER_VERSION=%s\nBAKED_AT_EPOCH=%s\n' "$runner_version" "$(date +%s)" >"$state_file.next"
mv "$state_file.next" "$state_file"
tart prune --entries=caches --older-than="$BAKE_MAX_AGE_DAYS"
log "baked: $LINUX_GOLDEN_VM has actions runner $runner_version"
