readonly software_update_domain="/Library/Preferences/com.apple.SoftwareUpdate"
readonly wanted_update_settings=(
  "AutomaticCheckEnabled 1"
  "AutomaticDownload 1"
  "AutomaticallyInstallMacOSUpdates 0"
  "ConfigDataInstall 1"
  "CriticalUpdateInstall 1"
)

step_updates() {
  local entry
  for entry in "${wanted_update_settings[@]}"; do
    ensure_system_bool "$software_update_domain" "${entry% *}" "${entry#* }"
  done
}

check_updates() {
  local entry
  for entry in "${wanted_update_settings[@]}"; do
    if [[ "$(system_default_value "$software_update_domain" "${entry% *}")" != "${entry#* }" ]]; then
      miss "macOS updates download but never install or restart on their own" "rerun provision"
      return 0
    fi
  done
  pass "macOS updates download but never install or restart on their own"
}
