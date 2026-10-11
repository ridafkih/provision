step_hostname() {
  [[ -n "$wanted_hostname" ]] || return 0
  local kind
  for kind in ComputerName LocalHostName HostName; do
    if [[ "$(scutil --get "$kind" 2>/dev/null)" == "$wanted_hostname" ]]; then
      unchanged "$kind = $wanted_hostname"
    else
      sudo scutil --set "$kind" "$wanted_hostname"
      changed "$kind = $wanted_hostname"
    fi
  done
}
