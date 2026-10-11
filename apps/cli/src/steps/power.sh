readonly wanted_power_settings=(
  "sleep 0"
  "displaysleep 0"
  "disksleep 0"
  "standby 0"
  "powernap 0"
  "autorestart 1"
  "womp 1"
  "tcpkeepalive 1"
  "disablesleep 1"
)

step_power() {
  local entry key value current
  for entry in "${wanted_power_settings[@]}"; do
    key="${entry% *}"
    value="${entry#* }"
    current="$(pmset_value "$key")"
    if [[ "$current" == "$value" ]]; then
      unchanged "pmset $key = $value"
    else
      sudo pmset -a "$key" "$value"
      changed "pmset $key = $value (was ${current:-unset})"
    fi
  done
  if sudo systemsetup -getrestartfreeze 2>/dev/null | grep -q ': On$'; then
    unchanged "restart after a freeze"
  elif sudo systemsetup -setrestartfreeze on >/dev/null 2>&1; then
    changed "restart after a freeze"
  else
    say "skipped: restart after a freeze (systemsetup refused it)"
  fi
}

check_power() {
  [[ "$(pmset_value sleep)" == 0 && "$(pmset_value disablesleep)" == 1 ]] \
    && pass "Never sleeps" \
    || miss "Never sleeps" "sudo pmset -a sleep 0 disablesleep 1"
  [[ "$(pmset_value autorestart)" == 1 ]] \
    && pass "Starts up by itself after a power cut" \
    || miss "Starts up by itself after a power cut" "sudo pmset -a autorestart 1"
  [[ "$(pmset_value womp)" == 1 ]] \
    && pass "Wakes for network access" \
    || miss "Wakes for network access" "sudo pmset -a womp 1"
  if sudo systemsetup -getrestartfreeze 2>/dev/null | grep -q ': On$'; then
    pass "Restarts after a freeze"
  else
    note "Restart after a freeze could not be confirmed (systemsetup needs Full Disk Access for Terminal on this macOS)"
  fi
}
