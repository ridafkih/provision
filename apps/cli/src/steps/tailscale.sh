homebrew_tailscale="/opt/homebrew/bin/tailscale"
app_tailscale="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
tailscale_login_timeout_seconds=1800
tailscale_backend_timeout_seconds=60
tailscale_up_attempts=3
open_command="/usr/bin/open"

uses_tailscale_daemon() {
  [[ -x "$homebrew_tailscale" || ! -x "$app_tailscale" ]]
}

run_tailscale() {
  if uses_tailscale_daemon; then
    sudo "$homebrew_tailscale" "$@"
  else
    "$app_tailscale" "$@"
  fi
}

tailscale_field() {
  run_tailscale status --json 2>/dev/null | /usr/bin/jq --raw-output "$1" 2>/dev/null || true
}

is_on_tailnet() {
  [[ "$(tailscale_field '.BackendState')" == "Running" ]]
}

login_url_in() {
  grep -Eo 'https://login\.tailscale\.com/[A-Za-z0-9/._?=&-]+' "$1" 2>/dev/null | head -n 1 || true
}

console_user() {
  stat -f %Su /dev/console 2>/dev/null
}

open_for_console_user() {
  local url="$1" user
  user="$(console_user)"
  [[ -n "$user" && "$user" != root ]] || return 1
  sudo launchctl asuser "$(id -u "$user")" sudo -u "$user" "$open_command" "$url"
}

ensure_tailscale_daemon() {
  if ! uses_tailscale_daemon; then
    unchanged "using the Tailscale app already installed; it connects once $USER logs in automatically"
    return 0
  fi
  ensure_formula tailscale
  if sudo launchctl print system/homebrew.mxcl.tailscale >/dev/null 2>&1; then
    unchanged "tailscaled runs as a system daemon, before anyone logs in"
  else
    sudo "$brew" services start tailscale >/dev/null
    changed "tailscaled runs as a system daemon, before anyone logs in"
  fi
}

wait_for_tailscale_backend() {
  local deadline=$((SECONDS + tailscale_backend_timeout_seconds))
  until [[ -n "$(tailscale_field '.BackendState // empty')" ]]; do
    ((SECONDS < deadline)) || die "tailscaled did not answer within $tailscale_backend_timeout_seconds seconds; run the same command again"
    sleep 1
  done
}

tailscale_up_arguments() {
  printf '%s\n' up --reset --qr --timeout=0s
  uses_tailscale_daemon && printf '%s\n' --accept-dns=false
  [[ -z "$wanted_hostname" ]] || printf '%s\n' "--hostname=$wanted_hostname"
}

show_login_url() {
  local url="$1" login_log="$2"
  printf '\n\033[1m  ================================================================\n'
  printf '    Sign in to Tailscale to add this Mac to your tailnet:\n\n'
  printf '    %s\n' "$url"
  printf '  ================================================================\033[0m\n'
  if grep -q '█\|▀\|▄' "$login_log"; then
    printf '\n  Or scan this with your phone:\n\n'
    grep '█\|▀\|▄' "$login_log"
  fi
  if open_for_console_user "$url" 2>/dev/null; then
    printf '\n  Opened it in the browser. Waiting until this Mac joins...\n'
  else
    printf '\n  Open it on any device. Waiting until this Mac joins...\n'
  fi
}

sign_in_to_tailnet() {
  local login_log up_pid url deadline attempt=1 is_shown=no
  local arguments=()
  local argument
  while IFS= read -r argument; do
    arguments+=("$argument")
  done < <(tailscale_up_arguments)
  login_log="$(mktemp)"
  run_tailscale "${arguments[@]}" >"$login_log" 2>&1 &
  up_pid=$!
  deadline=$((SECONDS + tailscale_login_timeout_seconds))
  until is_on_tailnet; do
    ((SECONDS < deadline)) || { kill "$up_pid" 2>/dev/null || true; die "Tailscale was not signed in within $((tailscale_login_timeout_seconds / 60)) minutes; run the same command again"; }
    if [[ "$is_shown" == no ]]; then
      url="$(tailscale_field '.AuthURL // empty')"
      [[ -n "$url" ]] || url="$(login_url_in "$login_log")"
      if [[ -n "$url" ]]; then
        sleep 1
        show_login_url "$url" "$login_log"
        is_shown=yes
      elif ! kill -0 "$up_pid" 2>/dev/null; then
        ((attempt < tailscale_up_attempts)) || { cat "$login_log" >&2; die "tailscale up stopped without a sign-in link; run the same command again"; }
        attempt=$((attempt + 1))
        sleep 2
        run_tailscale "${arguments[@]}" >"$login_log" 2>&1 &
        up_pid=$!
      fi
    fi
    sleep 1
  done
  kill "$up_pid" 2>/dev/null || true
  wait "$up_pid" 2>/dev/null || true
  rm -f "$login_log"
  changed "joined the tailnet as $(tailscale_field '.Self.DNSName')"
}

keep_system_dns() {
  uses_tailscale_daemon || return 0
  run_tailscale set --accept-dns=false >/dev/null 2>&1 || true
}

step_tailscale() {
  ensure_tailscale_daemon
  wait_for_tailscale_backend
  if is_on_tailnet; then
    keep_system_dns
    unchanged "on the tailnet as $(tailscale_field '.Self.DNSName')"
  else
    sign_in_to_tailnet
  fi
  require_name_resolution "after joining the tailnet"
}

check_tailscale() {
  if ! is_on_tailnet; then
    miss "On the tailnet" "run the same command again and sign in to Tailscale"
    return 0
  fi
  pass "On the tailnet as $(tailscale_field '.Self.DNSName' | sed 's/\.$//') ($(run_tailscale ip -4 2>/dev/null | head -n 1)); reconnects on any network"
  if [[ "$(tailscale_field '.Self.KeyExpiry // empty')" == "" ]]; then
    pass "Tailscale key never expires"
  else
    waiting_on_owner "Tailscale key expiry off, so it never drops off the tailnet" "login.tailscale.com/admin/machines > this Mac > ... > Disable key expiry"
  fi
}
