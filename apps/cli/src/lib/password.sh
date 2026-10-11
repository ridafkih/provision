login_password=""

prompt_password_once() {
  [[ -z "$login_password" ]] || return 0
  [[ -r /dev/tty ]] || die "needs a terminal to ask for your password"
  local attempt
  for attempt in 1 2 3; do
    printf 'Password for %s (used for sudo, FileVault and automatic login; never stored or sent): ' "$USER" >/dev/tty
    IFS= read -r -s login_password </dev/tty
    printf '\n' >/dev/tty
    if printf '%s\n' "$login_password" | sudo -S -p '' -v 2>/dev/null; then
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

keep_sudo_alive() {
  local parent_pid="$$"
  (
    while kill -0 "$parent_pid" 2>/dev/null; do
      sudo -n -v 2>/dev/null || true
      sleep 30
    done
  ) &
}
