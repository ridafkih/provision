readonly system_tcc_database="/Library/Application Support/com.apple.TCC/TCC.db"
readonly tcc_probe_key="$HOME/.provision/tcc-probe/id_ed25519"
readonly tcc_probe_known_hosts="$HOME/.provision/tcc-probe/known_hosts"
readonly grant_wait_seconds=900

privacy_service_of() {
  case "$1" in
    full-disk-access) printf 'kTCCServiceSystemPolicyAllFiles\n' ;;
    screen-recording) printf 'kTCCServiceScreenCapture\n' ;;
    accessibility) printf 'kTCCServiceAccessibility\n' ;;
    *) return 1 ;;
  esac
}

privacy_pane_of() {
  case "$1" in
    full-disk-access) printf 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles\n' ;;
    screen-recording) printf 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture\n' ;;
    accessibility) printf 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility\n' ;;
  esac
}

privacy_title_of() {
  case "$1" in
    full-disk-access) printf 'Full Disk Access\n' ;;
    screen-recording) printf 'Screen & System Audio Recording\n' ;;
    accessibility) printf 'Accessibility\n' ;;
  esac
}

expand_grants() {
  local grant kind path expanded
  expanded="$(
    for grant in ${requested_grants[@]+"${requested_grants[@]}"}; do
      kind="${grant%%:*}"
      path="${grant#*:}"
      if [[ "$kind" == all ]]; then
        printf 'full-disk-access:%s\nscreen-recording:%s\naccessibility:%s\n' "$path" "$path" "$path"
      else
        printf '%s\n' "$grant"
      fi
    done | awk '!seen[$0]++'
  )"
  [[ -n "$expanded" ]] || return 0
  grep '^full-disk-access:' <<<"$expanded" || true
  grep -v '^full-disk-access:' <<<"$expanded" || true
}

tcc_client_of() {
  local path="$1"
  if [[ "$path" == *.app ]]; then
    defaults read "$path/Contents/Info" CFBundleIdentifier 2>/dev/null
  else
    printf '%s\n' "$path"
  fi
}

grant_query() {
  local service="$1" client="$2"
  printf "SELECT auth_value FROM access WHERE service = '%s' AND client = '%s';" "$service" "$client"
}

ensure_tcc_probe_key() {
  local public_key
  [[ -f "$tcc_probe_key" ]] || {
    install -d -m 700 "$(dirname "$tcc_probe_key")"
    ssh-keygen -q -t ed25519 -N '' -C "provision tcc probe" -f "$tcc_probe_key"
  }
  public_key="$(cat "$tcc_probe_key.pub")"
  grep -qF "$public_key" "$HOME/.ssh/authorized_keys" 2>/dev/null \
    || printf 'from="127.0.0.1,::1",no-port-forwarding,no-agent-forwarding,no-X11-forwarding %s\n' "$public_key" >>"$HOME/.ssh/authorized_keys"
}

read_tcc_database() {
  local sql="$1"
  if sqlite3 "$system_tcc_database" "$sql" 2>/dev/null; then
    return 0
  fi
  [[ -f "$tcc_probe_key" ]] || return 1
  ssh -i "$tcc_probe_key" -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new \
    -o UserKnownHostsFile="$tcc_probe_known_hosts" "$USER@127.0.0.1" \
    "/usr/bin/sqlite3 '$system_tcc_database' \"$sql\"" 2>/dev/null
}

grant_state() {
  local kind="$1" path="$2" client value
  client="$(tcc_client_of "$path")" || { printf 'missing\n'; return 0; }
  if ! value="$(read_tcc_database "$(grant_query "$(privacy_service_of "$kind")" "$client")")"; then
    printf 'unreadable\n'
  elif [[ "$value" == 2 ]]; then
    printf 'granted\n'
  else
    printf 'absent\n'
  fi
}

guide_grant() {
  local kind="$1" path="$2" title deadline state
  title="$(privacy_title_of "$kind")"
  printf '\n  %s for %s\n' "$title" "$path"
  printf '  System Settings is open at %s and Finder shows the item. Drag it into the list (or click + and pick it), then turn it on.\n' "$title"
  open "$(privacy_pane_of "$kind")"
  open -R "$path" 2>/dev/null || true
  deadline=$((SECONDS + grant_wait_seconds))
  while ((SECONDS < deadline)); do
    state="$(grant_state "$kind" "$path")"
    case "$state" in
      granted) changed "$title for $path"; return 0 ;;
      unreadable)
        printf '  Press Return once it is on: ' >/dev/tty
        IFS= read -r _ </dev/tty
        say "confirmed by you: $title for $path"
        return 0
        ;;
    esac
    sleep 2
  done
  say "skipped: $title for $path was not turned on within $((grant_wait_seconds / 60)) minutes"
}

step_privacy_grants() {
  local grant kind path
  [[ ${#requested_grants[@]} -gt 0 ]] || return 0
  ensure_tcc_probe_key
  while IFS= read -r grant; do
    kind="${grant%%:*}"
    path="${grant#*:}"
    [[ -e "$path" ]] || { say "skipped: $path does not exist"; continue; }
    if [[ "$(grant_state "$kind" "$path")" == granted ]]; then
      unchanged "$(privacy_title_of "$kind") for $path"
    else
      guide_grant "$kind" "$path"
    fi
  done < <(expand_grants)
}

check_privacy_grants() {
  local grant kind path title
  while IFS= read -r grant; do
    [[ -n "$grant" ]] || continue
    kind="${grant%%:*}"
    path="${grant#*:}"
    title="$(privacy_title_of "$kind") for $(basename "$path")"
    case "$(grant_state "$kind" "$path")" in
      granted) pass "$title" ;;
      unreadable) note "$title: can't be read back until Terminal or remote SSH users have Full Disk Access" ;;
      *) waiting_on_owner "$title" "run provision at the Mac and follow the System Settings steps" ;;
    esac
  done < <(expand_grants)
}
