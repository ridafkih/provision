service_position() {
  networksetup -listnetworkserviceorder 2>/dev/null | grep -E '^\([0-9]+\) ' | sed 's/^([0-9]*) //' | grep -n -x "$1" | cut -d: -f1 | head -n 1
}

check_network() {
  local ethernet wifi
  ethernet="$(service_position Ethernet)"
  wifi="$(service_position Wi-Fi)"
  if [[ -n "$ethernet" && -n "$wifi" ]] && ((ethernet > wifi)); then
    miss "Ethernet comes before Wi-Fi" "System Settings > Network > ... > Set Service Order, Ethernet first"
  else
    pass "Takes Ethernet when plugged in and falls back to known Wi-Fi"
  fi
}
