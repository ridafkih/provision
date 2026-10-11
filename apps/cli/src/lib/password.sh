login_password=""
sudo_keeper_pid=""

sudo() {
  command sudo -n "$@"
}

prompt_password_once() {
  [[ -z "$login_password" ]] || return 0
  { : </dev/tty; } 2>/dev/null || die "needs a terminal to ask for your password; run it in Terminal on the Mac"
  local attempt
  for attempt in 1 2 3; do
    printf 'Password for %s (used for sudo, FileVault and automatic login; never stored or sent): ' "$USER" >/dev/tty
    IFS= read -r -s login_password </dev/tty
    printf '\n' >/dev/tty
    if printf '%s\n' "$login_password" | command sudo -S -p '' -v 2>/dev/null; then
      return 0
    fi
    printf 'That password did not work.\n' >/dev/tty
  done
  die "three wrong passwords"
}

forget_password() {
  login_password=""
}

answer_password_prompts() {
  PROVISION_ANSWER="$login_password" /usr/bin/expect -f "$kit_directory/lib/answer-prompts.exp" "$USER" "$@"
}

stop_keeping_sudo() {
  [[ -z "$sudo_keeper_pid" ]] || kill "$sudo_keeper_pid" 2>/dev/null || true
}

keep_sudo_alive() {
  local parent_pid="$$"
  (
    while kill -0 "$parent_pid" 2>/dev/null; do
      command sudo -n -v 2>/dev/null || true
      sleep 30
    done
  ) &
  sudo_keeper_pid=$!
  trap stop_keeping_sudo EXIT
}

collect_credentials() {
  if ! sudo true 2>/dev/null || needs_unattended_boot_password; then
    prompt_password_once
  fi
  sudo true 2>/dev/null || die "sudo still asks for a password; run the same command again"
  keep_sudo_alive
}
