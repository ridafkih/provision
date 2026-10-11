readonly bluetooth_preferences="/Library/Preferences/com.apple.Bluetooth"

step_headless() {
  ensure_system_bool "$bluetooth_preferences" BluetoothAutoSeekKeyboard 0
  ensure_system_bool "$bluetooth_preferences" BluetoothAutoSeekPointingDevice 0
  ensure_user_default com.apple.CrashReporter DialogType -string none
  if [[ "$(defaults -currentHost read com.apple.screensaver idleTime 2>/dev/null)" == 0 ]]; then
    unchanged "screen saver never starts"
  else
    defaults -currentHost write com.apple.screensaver idleTime -int 0
    changed "screen saver never starts"
  fi
}

attached_display_count() {
  system_profiler SPDisplaysDataType 2>/dev/null | grep -c 'Resolution:' || true
}

check_headless() {
  [[ "$(system_default_value "$bluetooth_preferences" BluetoothAutoSeekKeyboard)" == 0 ]] \
    && pass "No Bluetooth setup window when it boots without a keyboard or mouse" \
    || miss "No Bluetooth setup window when it boots without a keyboard or mouse" "rerun provision"
  [[ "$(defaults read com.apple.CrashReporter DialogType 2>/dev/null)" == none ]] \
    && pass "Crash dialogs never wait for a click" \
    || miss "Crash dialogs never wait for a click" "defaults write com.apple.CrashReporter DialogType -string none"
  note "Displays attached now: $(attached_display_count). It boots and serves SSH and Screen Sharing with none; for GPU or full-resolution GUI work add a virtual display app or an HDMI dummy plug"
}
