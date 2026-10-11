readonly socket_filter="/usr/libexec/ApplicationFirewall/socketfilterfw"

ensure_firewall_switch() {
  local query="$1" setter="$2" description="$3"
  if "$socket_filter" "$query" | grep -qiE 'enabled|is on|State = 1'; then
    unchanged "$description on"
  else
    sudo "$socket_filter" "$setter" on >/dev/null
    changed "$description on"
  fi
}

step_firewall() {
  ensure_firewall_switch --getglobalstate --setglobalstate "application firewall"
  ensure_firewall_switch --getstealthmode --setstealthmode "stealth mode"
  ensure_firewall_switch --getallowsigned --setallowsigned "automatic allow for signed software"
}

check_firewall() {
  "$socket_filter" --getglobalstate | grep -q 'State = 1' && "$socket_filter" --getstealthmode | grep -qi 'is on' \
    && pass "Firewall and stealth mode on" \
    || miss "Firewall and stealth mode on" "rerun provision"
}
