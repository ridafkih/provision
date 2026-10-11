readonly homebrew_tailscale="/opt/homebrew/bin/tailscale"
readonly app_tailscale="/Applications/Tailscale.app/Contents/MacOS/Tailscale"

tailscale_cli() {
  if [[ -x "$homebrew_tailscale" || ! -x "$app_tailscale" ]]; then
    printf '%s\n' "$homebrew_tailscale"
  else
    printf '%s\n' "$app_tailscale"
  fi
}
readonly tailscale_login_timeout_seconds=1800

tailscale_field() {
  sudo "$(tailscale_cli)" status --json 2>/dev/null | /usr/bin/jq --raw-output "$1" 2>/dev/null || true
}

is_on_tailnet() {
  [[ "$(tailscale_field '.BackendState')" == "Running" ]]
}

login_url_in() {
  grep -Eo 'https://login\.tailscale\.com/[A-Za-z0-9/._?=&-]+' "$1" 2>/dev/null | head -n 1
}

ensure_tailscale_daemon() {
  if [[ "$(tailscale_cli)" == "$app_tailscale" ]]; then
    unchanged "using the Tailscale app already installed; it connects once $USER logs in automatically"
    return 0
  fi
  ensure_formula tailscale
  if sudo launchctl print system/homebrew.mxcl.tailscale >/dev/null 2>&1; then
    unchanged "tailscaled runs as a system daemon, before anyone logs in"
  else
    sudo "$brew" services start tailscale >/dev/null
    changed "tailscaled runs as a system daemon, before anyone logs in"
    sleep 3
  fi
}

step_tailscale() {
  ensure_tailscale_daemon
  if is_on_tailnet; then
    unchanged "on the tailnet as $(tailscale_field '.Self.DNSName')"
    return 0
  fi

  local login_log up_pid url deadline
  login_log="$(mktemp)"
  local up_arguments=(up --timeout=0s)
  [[ -z "$wanted_hostname" ]] || up_arguments+=(--hostname="$wanted_hostname")
  sudo "$(tailscale_cli)" "${up_arguments[@]}" >"$login_log" 2>&1 &
  up_pid=$!
  deadline=$((SECONDS + 60))
  url=""
  while [[ -z "$url" ]] && ((SECONDS < deadline)) && ! is_on_tailnet; do
    sleep 1
    url="$(login_url_in "$login_log")"
  done
  if [[ -n "$url" ]]; then
    printf '\n  Sign in to Tailscale to add this Mac to your tailnet:\n\n    %s\n\n  Opening it in your browser. Waiting until it joins...\n' "$url"
    open "$url" 2>/dev/null || true
  fi
  deadline=$((SECONDS + tailscale_login_timeout_seconds))
  until is_on_tailnet; do
    ((SECONDS < deadline)) || { kill "$up_pid" 2>/dev/null || true; die "Tailscale was not signed in within $((tailscale_login_timeout_seconds / 60)) minutes; run provision again"; }
    sleep 2
  done
  wait "$up_pid" 2>/dev/null || true
  rm -f "$login_log"
  changed "joined the tailnet as $(tailscale_field '.Self.DNSName')"
}

check_tailscale() {
  if ! is_on_tailnet; then
    miss "On the tailnet" "rerun provision and sign in to Tailscale"
    return 0
  fi
  pass "On the tailnet as $(tailscale_field '.Self.DNSName' | sed 's/\.$//') ($(sudo "$(tailscale_cli)" ip -4 2>/dev/null | head -n 1)); reconnects on any network"
  if [[ "$(tailscale_field '.Self.KeyExpiry // empty')" == "" ]]; then
    pass "Tailscale key never expires"
  else
    waiting_on_owner "Tailscale key expiry off, so it never drops off the tailnet" "login.tailscale.com/admin/machines > this Mac > ... > Disable key expiry"
  fi
}
