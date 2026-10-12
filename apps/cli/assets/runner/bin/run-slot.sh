#!/usr/bin/env bash
set -euo pipefail

readonly kit_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$kit_directory/lib/config.sh"
source "$kit_directory/lib/github.sh"
source "$kit_directory/lib/vm.sh"
source "$kit_directory/lib/pool.sh"

[[ $# -eq 2 && "$2" =~ ^[0-9]+$ ]] || fail "usage: run-slot.sh <linux|macos> <slot number>"
readonly slot="$2"

load_runner_config
select_pool "$1"

readonly vm_name="$RUNNER_NAME_PREFIX-${pool_name_tag}slot-$slot"
readonly runner_prefix="$RUNNER_NAME_PREFIX-${pool_name_tag}$slot-"
readonly runner_name="$runner_prefix$(date +%s)"
vm_pid=""
runner_pid=""
runner_watch_pid=""

finish() {
  [[ -z "$runner_watch_pid" ]] || kill "$runner_watch_pid" 2>/dev/null || true
  [[ -z "$runner_pid" ]] || kill "$runner_pid" 2>/dev/null || true
  discard_vm "$vm_name"
  [[ -z "$vm_pid" ]] || wait "$vm_pid" 2>/dev/null || true
}
trap finish EXIT

back_off() {
  log "$pool_name slot $slot: $1; retrying in $RETRY_DELAY_SECONDS seconds"
  sleep "$RETRY_DELAY_SECONDS"
  exit 1
}

stop_runner() {
  log "$pool_name slot $slot: $runner_name $1"
  kill "$runner_pid" 2>/dev/null || true
}

watch_runner() {
  local deadline=$((SECONDS + RUNNER_LIFETIME_SECONDS))
  local next_probe=$((SECONDS + GUEST_PROBE_INTERVAL_SECONDS))
  local missed_probes=0
  while kill -0 "$runner_pid" 2>/dev/null; do
    if ((SECONDS >= deadline)); then
      stop_runner "reached its $RUNNER_LIFETIME_SECONDS second lifetime"
      return 0
    fi
    if ! kill -0 "$vm_pid" 2>/dev/null; then
      stop_runner "lost its VM, which exited"
      return 0
    fi
    if ((SECONDS >= next_probe)); then
      if guest_answers "$vm_name"; then
        missed_probes=0
      else
        missed_probes=$((missed_probes + 1))
        if ((missed_probes >= GUEST_PROBE_FAILURES)); then
          stop_runner "lost its VM, which missed $missed_probes guest agent probes"
          return 0
        fi
      fi
      next_probe=$((SECONDS + GUEST_PROBE_INTERVAL_SECONDS))
    fi
    sleep 1
  done
}

discard_vm "$vm_name"
has_runner_credentials || back_off "no GITHUB_RUNNER_TOKEN in $CREDENTIALS_FILE yet"
vm_exists "$pool_golden_vm" || back_off "no $pool_golden_vm image yet"
remove_offline_runners "$runner_prefix" || back_off "could not clear offline runners"
jit_config="$(create_jit_config "$runner_name" "$pool_labels")" || back_off "could not create a just-in-time runner config"

tart clone "$pool_golden_vm" "$vm_name"
tart set "$vm_name" --random-mac
tart run --no-graphics --net-softnet "$vm_name" >>"$LOG_DIRECTORY/${pool_name_tag}slot-$slot-vm.log" 2>&1 &
vm_pid=$!
wait_for_guest_agent "$vm_name" "$vm_pid"

log "$pool_name slot $slot: $runner_name is waiting for a job"
printf '%s\n' "$jit_config" | tart exec -i "$vm_name" sudo -u admin -H bash -c \
  'read -r jit_config && cd "$HOME/actions-runner" && exec ./run.sh --jitconfig "$jit_config"' &
runner_pid=$!
watch_runner &
runner_watch_pid=$!

if wait "$runner_pid"; then
  log "$pool_name slot $slot: $runner_name finished"
else
  log "$pool_name slot $slot: $runner_name exited with status $?"
fi
runner_pid=""
