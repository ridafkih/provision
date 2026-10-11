readonly runner_directory="$HOME/.provision/runner"
readonly runner_log_directory="$HOME/Library/Logs/provision"
readonly runner_agents_directory="$HOME/Library/LaunchAgents"
readonly runner_vm_cpu_count=4
readonly runner_vm_memory_mb=6144
readonly runner_host_reserved_memory_mb=4096
readonly runner_max_slots=4

runner_slot_count() {
  local host_memory_mb host_cpu_count slots
  host_memory_mb=$(($(sysctl -n hw.memsize) / 1024 / 1024))
  host_cpu_count="$(sysctl -n hw.ncpu)"
  slots=$(((host_memory_mb - runner_host_reserved_memory_mb) / runner_vm_memory_mb))
  ((slots <= runner_max_slots)) || slots=$runner_max_slots
  ((slots <= host_cpu_count / 2)) || slots=$((host_cpu_count / 2))
  ((slots >= 1)) || die "this Mac has $host_memory_mb MB of memory, too little for one $runner_vm_memory_mb MB runner VM"
  printf '%s\n' "$slots"
}

runner_config() {
  cat <<CONFIG
GITHUB_API_URL=https://api.github.com
GITHUB_REPOSITORY=$runner_repository
RUNNER_NAME_PREFIX=$(scutil --get LocalHostName | tr '[:upper:]' '[:lower:]')
RUNNER_LABELS=$(IFS=,; printf '%s' "self-hosted,Linux,ARM64${runner_labels[*]+,${runner_labels[*]}}")
RUNNER_LIFETIME_SECONDS=21600
LINUX_BASE_IMAGE=ghcr.io/cirruslabs/ubuntu-runner-arm64:24.04
LINUX_GOLDEN_VM=runner-linux
LINUX_SLOTS=$(runner_slot_count)
VM_CPU_COUNT=$runner_vm_cpu_count
VM_MEMORY_MB=$runner_vm_memory_mb
VM_DISK_GB=80
BAKE_MEMORY_MB=4096
BAKE_MAX_AGE_DAYS=7
PREPULL_IMAGES=$(IFS=,; printf '%s' "${runner_prepull_images[*]-}")
BOOT_TIMEOUT_SECONDS=180
RETRY_DELAY_SECONDS=60
CREDENTIALS_FILE=$runner_directory/credentials.env
LOG_DIRECTORY=$runner_log_directory
CONFIG
}

render_runner_agent() {
  local template="$1" label="$2" slot="$3"
  sed -e "s#@LABEL@#$label#g" \
    -e "s#@KIT@#$installed_kit_directory/roles/runner#g" \
    -e "s#@SLOT@#$slot#g" \
    -e "s#@PATH@#/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin#g" \
    -e "s#@HOME@#$HOME#g" \
    -e "s#@LOGS@#$runner_log_directory#g" \
    "$kit_directory/roles/runner/launchd/$template"
}

ensure_runner_agent() {
  local label="$1" contents="$2"
  local plist="$runner_agents_directory/$label.plist"
  local domain="gui/$(id -u)"
  if [[ -f "$plist" ]] && [[ "$(cat "$plist")" == "$contents" ]] && launchctl print "$domain/$label" >/dev/null 2>&1; then
    unchanged "$label loaded"
    return 0
  fi
  launchctl bootout "$domain/$label" >/dev/null 2>&1 || true
  printf '%s\n' "$contents" >"$plist"
  plutil -lint "$plist" >/dev/null
  launchctl bootstrap "$domain" "$plist"
  changed "$label loaded"
}

remove_extra_runner_agents() {
  local slots="$1" plist label slot
  for plist in "$runner_agents_directory"/dev.provision.runner-slot-*.plist; do
    [[ -e "$plist" ]] || continue
    label="$(basename "$plist" .plist)"
    slot="${label##*-}"
    ((slot <= slots)) && continue
    launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
    rm -f "$plist"
    changed "$label removed"
  done
}

ensure_runner_log_rotation() {
  local rotation_file="/etc/newsyslog.d/provision-runner.conf"
  local wanted="$runner_log_directory/*.log $USER:staff 644 5 10240 * GN"
  if [[ -f "$rotation_file" ]] && [[ "$(cat "$rotation_file")" == "$wanted" ]]; then
    unchanged "runner logs rotate at 10 MB, five kept"
  else
    printf '%s\n' "$wanted" | sudo tee "$rotation_file" >/dev/null
    sudo chmod 644 "$rotation_file"
    changed "runner logs rotate at 10 MB, five kept"
  fi
}

step_role_runner() {
  [[ -n "$runner_repository" ]] || die "--role runner needs --runner-repo <owner/repo>"
  step_role_worker
  install -d -m 700 "$runner_directory"
  install -d -m 755 "$runner_log_directory" "$runner_agents_directory"
  local wanted_config slots
  wanted_config="$(runner_config)"
  if [[ -f "$runner_directory/runner.env" ]] && [[ "$(cat "$runner_directory/runner.env")" == "$wanted_config" ]]; then
    unchanged "$runner_directory/runner.env"
  else
    printf '%s\n' "$wanted_config" >"$runner_directory/runner.env"
    changed "$runner_directory/runner.env"
  fi
  ensure_runner_log_rotation
  slots="$(sed -n 's/^LINUX_SLOTS=//p' "$runner_directory/runner.env")"
  ensure_runner_agent dev.provision.runner-bake "$(render_runner_agent dev.provision.runner-bake.plist dev.provision.runner-bake 0)"
  local slot
  for slot in $(seq 1 "$slots"); do
    ensure_runner_agent "dev.provision.runner-slot-$slot" "$(render_runner_agent dev.provision.runner-slot.plist "dev.provision.runner-slot-$slot" "$slot")"
  done
  remove_extra_runner_agents "$slots"
}

check_role_runner() {
  check_role_worker
  local slots
  slots="$(sed -n 's/^LINUX_SLOTS=//p' "$runner_directory/runner.env" 2>/dev/null || true)"
  [[ -n "$slots" ]] \
    && pass "GitHub runner for $runner_repository: $slots VM slots" \
    || miss "GitHub runner configured" "rerun provision --role runner --runner-repo <owner/repo>"
  if grep -q '^GITHUB_RUNNER_TOKEN=.\+' "$runner_directory/credentials.env" 2>/dev/null; then
    pass "Runner token in place"
  else
    waiting_on_owner "Runner token" "put GITHUB_RUNNER_TOKEN=<fine-grained token, Administration read and write on $runner_repository> in $runner_directory/credentials.env (mode 600), then: launchctl kickstart -k gui/$(id -u)/dev.provision.runner-bake"
  fi
  [[ -f "$runner_directory/golden.env" ]] \
    && pass "Runner VM image baked" \
    || note "The runner VM image bakes once the token is in place (about 15 minutes)"
}
