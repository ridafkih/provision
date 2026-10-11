readonly remote_management_kickstart="/System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart"
readonly screen_sharing_plist="/System/Library/LaunchDaemons/com.apple.screensharing.plist"
readonly nat_preferences="/Library/Preferences/SystemConfiguration/com.apple.nat"

is_remote_management_on() {
  pgrep -xq ARDAgent && is_listening 3283
}

step_sharing() {
  if is_daemon_loaded com.apple.smbd; then
    sudo launchctl disable system/com.apple.smbd
    sudo launchctl bootout system/com.apple.smbd 2>/dev/null || true
    changed "file sharing (SMB) off"
  else
    unchanged "file sharing (SMB) off"
  fi
  if cupsctl | grep -q '^_share_printers=1'; then
    cupsctl --no-share-printers
    changed "printer sharing off"
  else
    unchanged "printer sharing off"
  fi
  if [[ "$(sudo defaults read "$nat_preferences" NAT 2>/dev/null | sed -n 's/^[[:space:]]*Enabled = \([0-9]\);/\1/p' | head -n 1)" == 1 ]]; then
    sudo defaults write "$nat_preferences" NAT -dict-add Enabled -int 0
    changed "internet sharing off"
  else
    unchanged "internet sharing off"
  fi
  if is_remote_management_on; then
    sudo "$remote_management_kickstart" -deactivate -configure -access -off >/dev/null
    changed "Remote Management off"
  else
    unchanged "Remote Management off"
  fi
  if is_listening 5900; then
    unchanged "Screen Sharing on"
  else
    start_system_daemon com.apple.screensharing "$screen_sharing_plist"
    sleep 2
    is_listening 5900 && changed "Screen Sharing on" || say "skipped: Screen Sharing did not start from the command line"
  fi
}

check_sharing() {
  is_listening 5900 \
    && pass "Screen Sharing on (vnc://$(scutil --get LocalHostName).local)" \
    || waiting_on_owner "Screen Sharing on" "System Settings > General > Sharing > Screen Sharing"
  is_remote_management_on \
    && miss "Remote Management off" "System Settings > General > Sharing > Remote Management off" \
    || pass "Remote Management off"
  is_daemon_loaded com.apple.smbd \
    && miss "File sharing off" "System Settings > General > Sharing > File Sharing off" \
    || pass "File, printer and internet sharing off"
}
