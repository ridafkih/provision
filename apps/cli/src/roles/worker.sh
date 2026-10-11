softnet_binary() {
  readlink -f /opt/homebrew/bin/softnet
}

is_softnet_setuid_root() {
  local binary
  binary="$(softnet_binary)"
  [[ -u "$binary" && "$(stat -f %Su "$binary")" == root ]]
}

step_role_worker() {
  ensure_formula openai/tools/tart
  ensure_formula openai/tools/softnet
  if is_softnet_setuid_root; then
    unchanged "softnet runs set-uid root, so Tart can isolate VM networks without sudo"
  else
    sudo chown root:wheel "$(softnet_binary)"
    sudo chmod 4755 "$(softnet_binary)"
    changed "softnet runs set-uid root, so Tart can isolate VM networks without sudo"
  fi
}

check_role_worker() {
  /opt/homebrew/bin/tart --version >/dev/null 2>&1 && is_softnet_setuid_root \
    && pass "VM host: Tart and Softnet ready" \
    || miss "VM host: Tart and Softnet ready" "rerun provision (a Homebrew upgrade of softnet clears its set-uid bit)"
  [[ -f "$HOME/Library/Keychains/login.keychain-db" ]] \
    && pass "Login keychain exists, so headless VMs can start" \
    || waiting_on_owner "Login keychain exists" "log in to the desktop once (Screen Sharing works)"
}
