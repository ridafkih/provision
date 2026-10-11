is_listening() {
  /usr/sbin/lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1 || nc -z -G 2 127.0.0.1 "$1" >/dev/null 2>&1
}

pmset_value() {
  local key="$1"
  if [[ "$key" == disablesleep ]]; then
    pmset -g | sed -n 's/^[[:space:]]*SleepDisabled[[:space:]]*\([0-9]*\).*/\1/p'
  else
    pmset -g custom | sed -n "s/^[[:space:]]*$key[[:space:]]\{1,\}\([0-9]*\).*/\1/p" | head -n 1
  fi
}

system_default_value() {
  defaults read "$1" "$2" 2>/dev/null || sudo defaults read "$1" "$2" 2>/dev/null || true
}

ensure_system_bool() {
  local domain="$1" key="$2" wanted="$3"
  if [[ "$(system_default_value "$domain" "$key")" == "$wanted" ]]; then
    unchanged "$domain $key = $wanted"
    return 0
  fi
  if [[ "$wanted" == 1 ]]; then
    sudo defaults write "$domain" "$key" -bool true
  else
    sudo defaults write "$domain" "$key" -bool false
  fi
  changed "$domain $key = $wanted"
}

ensure_user_default() {
  local domain="$1" key="$2" type="$3" wanted="$4"
  if [[ "$(defaults read "$domain" "$key" 2>/dev/null)" == "$wanted" ]]; then
    unchanged "$domain $key = $wanted"
    return 0
  fi
  defaults write "$domain" "$key" "$type" "$wanted"
  changed "$domain $key = $wanted"
}

is_daemon_loaded() {
  sudo launchctl print "system/$1" >/dev/null 2>&1
}

start_system_daemon() {
  local label="$1" plist="$2"
  sudo launchctl enable "system/$label"
  is_daemon_loaded "$label" || sudo launchctl bootstrap system "$plist" 2>/dev/null || true
}
