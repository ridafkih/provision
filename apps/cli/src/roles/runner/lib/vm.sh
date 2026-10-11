log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

vm_exists() {
  tart get "$1" >/dev/null 2>&1
}

discard_vm() {
  local target_vm="$1"
  vm_exists "$target_vm" || return 0
  tart stop "$target_vm" --timeout 10 >/dev/null 2>&1 || true
  tart delete "$target_vm" >/dev/null 2>&1 || true
}

wait_for_guest_agent() {
  local target_vm="$1" target_pid="$2"
  local deadline=$((SECONDS + BOOT_TIMEOUT_SECONDS))
  while ((SECONDS < deadline)); do
    kill -0 "$target_pid" 2>/dev/null || fail "$target_vm exited while booting"
    tart exec "$target_vm" true >/dev/null 2>&1 && return 0
    sleep 2
  done
  fail "$target_vm did not answer tart exec within $BOOT_TIMEOUT_SECONDS seconds"
}
