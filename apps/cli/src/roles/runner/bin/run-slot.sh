#!/usr/bin/env bash
set -euo pipefail

readonly kit_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$kit_directory/lib/config.sh"
source "$kit_directory/lib/github.sh"
source "$kit_directory/lib/vm.sh"

[[ $# -eq 1 && "$1" =~ ^[0-9]+$ ]] || fail "usage: run-slot.sh <slot number>"
readonly slot="$1"

load_runner_config

readonly vm_name="$RUNNER_NAME_PREFIX-slot-$slot"
readonly runner_prefix="$RUNNER_NAME_PREFIX-$slot-"
readonly runner_name="$runner_prefix$(date +%s)"
vm_pid=""
runner_pid=""
lifetime_watch_pid=""

finish() {
  [[ -z "$lifetime_watch_pid" ]] || kill "$lifetime_watch_pid" 2>/dev/null || true
  [[ -z "$runner_pid" ]] || kill "$runner_pid" 2>/dev/null || true
  discard_vm "$vm_name"
  [[ -z "$vm_pid" ]] || wait "$vm_pid" 2>/dev/null || true
}
trap finish EXIT

back_off() {
  log "slot $slot: $1; retrying in $RETRY_DELAY_SECONDS seconds"
  sleep "$RETRY_DELAY_SECONDS"
  exit 1
}

watch_lifetime() {
  local deadline=$((SECONDS + RUNNER_LIFETIME_SECONDS))
  while kill -0 "$runner_pid" 2>/dev/null; do
    if ((SECONDS >= deadline)); then
      log "slot $slot: $runner_name reached its $RUNNER_LIFETIME_SECONDS second lifetime"
      kill "$runner_pid" 2>/dev/null || true
      return 0
    fi
    sleep 1
  done
}

discard_vm "$vm_name"
has_runner_credentials || back_off "no GITHUB_RUNNER_TOKEN in $CREDENTIALS_FILE yet"
vm_exists "$LINUX_GOLDEN_VM" || back_off "no $LINUX_GOLDEN_VM image yet"
remove_offline_runners "$runner_prefix" || back_off "could not clear offline runners"
jit_config="$(create_jit_config "$runner_name")" || back_off "could not create a just-in-time runner config"

tart clone "$LINUX_GOLDEN_VM" "$vm_name"
tart set "$vm_name" --random-mac
tart run --no-graphics --net-softnet "$vm_name" >>"$LOG_DIRECTORY/slot-$slot-vm.log" 2>&1 &
vm_pid=$!
wait_for_guest_agent "$vm_name" "$vm_pid"

log "slot $slot: $runner_name is waiting for a job"
printf '%s\n' "$jit_config" | tart exec -i "$vm_name" sudo -u admin -H bash -c \
  'read -r jit_config && cd "$HOME/actions-runner" && exec ./run.sh --jitconfig "$jit_config"' &
runner_pid=$!
watch_lifetime &
lifetime_watch_pid=$!

if wait "$runner_pid"; then
  log "slot $slot: $runner_name finished"
else
  log "slot $slot: $runner_name exited with status $?"
fi
runner_pid=""
