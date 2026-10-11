readonly login_window_preferences="/Library/Preferences/com.apple.loginwindow"

filevault_status() {
  fdesetup status 2>/dev/null | head -n 1
}

auto_login_user() {
  defaults read "$login_window_preferences" autoLoginUser 2>/dev/null || true
}

needs_unattended_boot_password() {
  [[ "$(filevault_status)" != "FileVault is Off." || "$(auto_login_user)" != "$USER" ]]
}

wait_for_decryption() {
  local status
  while true; do
    status="$(filevault_status)"
    [[ "$status" == "FileVault is Off." ]] && return 0
    say "waiting: $(fdesetup status | tr '\n' ' ')"
    sleep 30
  done
}

step_unattended_boot() {
  case "$(filevault_status)" in
    "FileVault is Off.")
      unchanged "FileVault off"
      ;;
    "FileVault is On.")
      answer_password_prompts sudo fdesetup disable
      changed "FileVault turned off; decrypting"
      wait_for_decryption
      ;;
    *)
      wait_for_decryption
      ;;
  esac
  if [[ "$(auto_login_user)" == "$USER" ]]; then
    unchanged "logs in automatically as $USER"
  else
    answer_password_prompts sudo sysadminctl -autologin set -userName "$USER" -password -
    [[ "$(auto_login_user)" == "$USER" ]] || die "automatic login was not set"
    changed "logs in automatically as $USER"
  fi
}

check_unattended_boot() {
  [[ "$(filevault_status)" == "FileVault is Off." ]] \
    && pass "FileVault off, so it boots without anyone typing a password" \
    || miss "FileVault off" "rerun provision"
  [[ "$(auto_login_user)" == "$USER" ]] \
    && pass "Logs in automatically as $USER after a restart" \
    || miss "Logs in automatically as $USER" "rerun provision"
}
