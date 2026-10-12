#!/usr/bin/env bash
set -euo pipefail

readonly kit_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$kit_directory/lib/config.sh"
source "$kit_directory/lib/github.sh"
source "$kit_directory/lib/vm.sh"
source "$kit_directory/lib/pool.sh"

[[ $# -eq 0 || ( $# -eq 1 && "$1" == "--force" ) ]] || fail "usage: bake-image.sh [--force]"
readonly is_forced="$([[ $# -eq 1 ]] && printf yes || printf no)"

load_runner_config
has_runner_credentials || fail "no GITHUB_RUNNER_TOKEN in $CREDENTIALS_FILE yet"

staging_vm=""
staging_pid=""

finish() {
  [[ -z "$staging_vm" ]] || discard_vm "$staging_vm"
  [[ -z "$staging_pid" ]] || wait "$staging_pid" 2>/dev/null || true
}
trap finish EXIT

is_golden_current() {
  local runner_version="$1"
  [[ "$is_forced" == no ]] || return 1
  vm_exists "$pool_golden_vm" || return 1
  [[ -f "$pool_state_file" ]] || return 1
  local BAKED_RUNNER_VERSION BAKED_AT_EPOCH
  source "$pool_state_file"
  local age_days=$((($(date +%s) - BAKED_AT_EPOCH) / 86400))
  [[ "$BAKED_RUNNER_VERSION" == "$runner_version" ]] && ((age_days < BAKE_MAX_AGE_DAYS))
}

prepare_arguments() {
  local prepull_images=()
  [[ "$pool_name" == linux && -n "$PREPULL_IMAGES" ]] && IFS=',' read -r -a prepull_images <<<"$PREPULL_IMAGES"
  printf '%s\n' ${prepull_images[@]+"${prepull_images[@]}"}
}

free_disk_gb() {
  df -k "$HOME" | awk 'NR == 2 { print int($4 / 1048576) }'
}

is_pull_free() {
  [[ "$pool_base_image" == *@sha256:* ]] && tart list --source oci --quiet | grep -Fxq "$pool_base_image"
}

has_pull_space() {
  is_pull_free && return 0
  (($(free_disk_gb) >= pool_pull_free_gb)) && return 0
  log "only $(free_disk_gb) GB free, $pool_pull_free_gb GB needed to pull $pool_base_image; clearing Tart's image cache"
  tart prune --entries=caches --space-budget=0
  (($(free_disk_gb) >= pool_pull_free_gb))
}

bake_pool() {
  select_pool "$1"
  local runner_version runner_url runner_sha256
  read -r runner_version runner_url runner_sha256 <<<"$(latest_runner_release "$pool_runner_platform")"
  [[ -n "$runner_sha256" ]] || fail "the latest actions runner release has no $pool_runner_platform arm64 digest"

  if is_golden_current "$runner_version"; then
    log "unchanged: $pool_golden_vm already has actions runner $runner_version and is under $BAKE_MAX_AGE_DAYS days old"
    return 0
  fi

  if ! has_pull_space; then
    log "skipped: $pool_golden_vm stays as it is, $(free_disk_gb) GB free is less than the $pool_pull_free_gb GB a pull of $pool_base_image needs"
    return 0
  fi

  log "baking $pool_golden_vm from $pool_base_image with actions runner $runner_version"
  staging_vm="$pool_golden_vm-staging"
  discard_vm "$staging_vm"
  tart pull "$pool_base_image"
  tart clone "$pool_base_image" "$staging_vm"
  tart set "$staging_vm" --cpu "$VM_CPU_COUNT" --memory "$pool_bake_memory_mb"
  [[ -z "$pool_disk_gb" ]] || tart set "$staging_vm" --disk-size "$pool_disk_gb"
  tart run --no-graphics --net-softnet "$staging_vm" >>"$LOG_DIRECTORY/bake-vm.log" 2>&1 &
  staging_pid=$!
  wait_for_guest_agent "$staging_vm" "$staging_pid"

  local extra_arguments=()
  local argument
  while IFS= read -r argument; do
    [[ -z "$argument" ]] || extra_arguments+=("$argument")
  done < <(prepare_arguments)
  tart exec -i "$staging_vm" sudo bash -s -- "$runner_version" "$runner_url" "$runner_sha256" ${extra_arguments[@]+"${extra_arguments[@]}"} \
    <"$kit_directory/bake/$pool_prepare_script"

  tart stop "$staging_vm" --timeout 120
  wait "$staging_pid" || true
  staging_pid=""
  tart set "$staging_vm" --memory "$pool_memory_mb"

  discard_vm "$pool_golden_vm"
  tart rename "$staging_vm" "$pool_golden_vm"
  staging_vm=""
  printf 'BAKED_RUNNER_VERSION=%s\nBAKED_AT_EPOCH=%s\n' "$runner_version" "$(date +%s)" >"$pool_state_file.next"
  mv "$pool_state_file.next" "$pool_state_file"
  log "baked: $pool_golden_vm has actions runner $runner_version"
}

while IFS= read -r pool; do
  bake_pool "$pool"
done < <(configured_pools)
tart prune --entries=caches --older-than="$BAKE_MAX_AGE_DAYS"
