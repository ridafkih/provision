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
repository_index=0
runner_id=""

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

is_shared_slot() {
  ((${#repositories[@]} > 1))
}

pick_repository() {
  local index demand
  if is_shared_slot; then
    for index in "${!repositories[@]}"; do
      demand="$(unmet_demand "${repositories[$index]}" "$(registration_labels "$index")")" || continue
      if ((demand > 0)); then
        printf '%s\n' "$index"
        return 0
      fi
    done
  fi
  printf '0\n'
}

clear_offline_runners() {
  local index
  for index in "${!repositories[@]}"; do
    remove_offline_runners "${repositories[$index]}" "$runner_prefix" && continue
    ((index != repository_index)) || return 1
    log "$pool_name slot $slot: could not clear offline runners in ${repositories[$index]}"
  done
}

repository_with_unmet_demand() {
  local index demand queued idle
  local current="${repositories[$repository_index]}" current_labels
  current_labels="$(registration_labels "$repository_index")"
  for index in "${!repositories[@]}"; do
    ((index != repository_index)) || continue
    demand="$(unmet_demand "${repositories[$index]}" "$(registration_labels "$index")")" || continue
    ((demand > 0)) || continue
    queued="$(queued_job_count "$current" "$current_labels")" || return 1
    idle="$(idle_runner_count "$current" "$current_labels")" || return 1
    ((idle > queued)) || return 1
    printf '%s\n' "$index"
    return 0
  done
  return 1
}

next_demand_check_time() {
  printf '%s\n' "$((SECONDS + DEMAND_CHECK_INTERVAL_SECONDS + RANDOM % (DEMAND_CHECK_INTERVAL_SECONDS / 2 + 1)))"
}

watch_runner() {
  local deadline=$((SECONDS + RUNNER_LIFETIME_SECONDS))
  local next_probe=$((SECONDS + GUEST_PROBE_INTERVAL_SECONDS))
  local missed_probes=0
  local is_watching_demand=0 next_demand_check target_index
  if is_shared_slot; then
    is_watching_demand=1
    next_demand_check="$(next_demand_check_time)"
  fi
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
    if ((is_watching_demand && SECONDS >= next_demand_check)); then
      if runner_is_busy "$served_repository" "$runner_id"; then
        is_watching_demand=0
      elif target_index="$(repository_with_unmet_demand)" && delete_runner "$served_repository" "$runner_id"; then
        stop_runner "handed its slot to ${repositories[$target_index]}, which has jobs waiting"
        return 0
      fi
      next_demand_check="$(next_demand_check_time)"
    fi
    sleep 1
  done
}

discard_vm "$vm_name"
has_runner_credentials || back_off "no GITHUB_RUNNER_TOKEN in $CREDENTIALS_FILE yet"
vm_exists "$pool_golden_vm" || back_off "no $pool_golden_vm image yet"
repository_index="$(pick_repository)"
readonly served_repository="${repositories[$repository_index]}"
clear_offline_runners || back_off "could not clear offline runners in $served_repository"
jit_registration="$(create_jit_config "$served_repository" "$runner_name" "$(registration_labels "$repository_index")")" \
  || back_off "could not create a just-in-time runner config for $served_repository"
runner_id="${jit_registration%% *}"
jit_config="${jit_registration#* }"

tart clone "$pool_golden_vm" "$vm_name"
tart set "$vm_name" --random-mac
tart run --no-graphics --net-softnet "$vm_name" >>"$LOG_DIRECTORY/${pool_name_tag}slot-$slot-vm.log" 2>&1 &
vm_pid=$!
wait_for_guest_agent "$vm_name" "$vm_pid"

log "$pool_name slot $slot: $runner_name is waiting for a job from $served_repository"
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
