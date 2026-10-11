readonly diagnostics_preferences="/Library/Application Support/CrashReporter/DiagnosticMessagesHistory.plist"

step_privacy() {
  if sysadminctl -guestAccount status 2>&1 | grep -q 'Guest account disabled'; then
    unchanged "guest account off"
  else
    sudo sysadminctl -guestAccount off 2>/dev/null
    changed "guest account off"
  fi
  ensure_system_bool "$diagnostics_preferences" AutoSubmit 0
  ensure_system_bool "$diagnostics_preferences" ThirdPartyDataSubmit 0
  if mdutil -s / 2>/dev/null | grep -q 'Indexing disabled'; then
    unchanged "Spotlight indexing off"
  else
    sudo mdutil -a -i off >/dev/null
    changed "Spotlight indexing off on every volume"
  fi
}

check_privacy() {
  mdutil -s / 2>/dev/null | grep -q 'Indexing disabled' \
    && pass "Spotlight indexing off" \
    || miss "Spotlight indexing off" "sudo mdutil -a -i off"
}
