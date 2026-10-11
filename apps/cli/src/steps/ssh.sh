readonly ssh_plist="/System/Library/LaunchDaemons/ssh.plist"
readonly keys_only_drop_in="/etc/ssh/sshd_config.d/000-provision-keys-only.conf"
readonly keys_only_settings=$'PasswordAuthentication no\nKbdInteractiveAuthentication no'

key_material() {
  awk 'NF >= 2 && $1 ~ /^(ssh-|ecdsa-|sk-)/ {print $1" "$2}' "$@" 2>/dev/null | sort -u
}

wanted_public_keys() {
  local github_user key
  for github_user in ${github_users[@]+"${github_users[@]}"}; do
    curl -fsSL --max-time 15 "https://github.com/$github_user.keys" | sed "s|\$| github:$github_user|"
  done
  for key in ${extra_public_keys[@]+"${extra_public_keys[@]}"}; do
    printf '%s\n' "$key"
  done
}

merge_authorized_keys() {
  local authorized_keys="$1" wanted_file="$2"
  local added=0 line material
  touch "$authorized_keys"
  chmod 600 "$authorized_keys"
  while IFS= read -r line; do
    material="$(printf '%s\n' "$line" | key_material /dev/stdin)"
    [[ -n "$material" ]] || continue
    if ! key_material "$authorized_keys" | grep -qxF "$material"; then
      printf '%s\n' "$line" >>"$authorized_keys"
      added=$((added + 1))
    fi
  done <"$wanted_file"
  printf '%s\n' "$added"
}

step_ssh() {
  local authorized_keys="$HOME/.ssh/authorized_keys"
  local wanted_file added
  install -d -m 700 "$HOME/.ssh"
  wanted_file="$(mktemp)"
  wanted_public_keys >"$wanted_file" || die "could not fetch the SSH keys for: ${github_users[*]-}"
  [[ -s "$wanted_file" ]] || die "no SSH public keys to authorize; pass --github <user> or --ssh-key '<key>'"
  added="$(merge_authorized_keys "$authorized_keys" "$wanted_file")"
  rm -f "$wanted_file"
  ((added == 0)) && unchanged "$authorized_keys holds every wanted key" || changed "added $added key(s) to $authorized_keys"

  if is_listening 22; then
    unchanged "Remote Login (SSH) on"
  else
    start_system_daemon com.openssh.sshd "$ssh_plist"
    sleep 1
    is_listening 22 || sudo systemsetup -f -setremotelogin on >/dev/null 2>&1 || true
    is_listening 22 && changed "Remote Login (SSH) on" || say "skipped: Remote Login did not start from the command line"
  fi

  if [[ -f "$keys_only_drop_in" ]] && [[ "$(sudo cat "$keys_only_drop_in")" == "$keys_only_settings" ]]; then
    unchanged "SSH accepts keys only"
  else
    printf '%s\n' "$keys_only_settings" | sudo tee "$keys_only_drop_in" >/dev/null
    sudo chmod 644 "$keys_only_drop_in"
    sudo sshd -t
    changed "SSH accepts keys only"
  fi
}

check_ssh() {
  local key_count
  key_count="$(key_material "$HOME/.ssh/authorized_keys" | grep -c . || true)"
  is_listening 22 \
    && pass "SSH on: ssh $USER@$(scutil --get LocalHostName).local" \
    || waiting_on_owner "SSH on" "System Settings > General > Sharing > Remote Login"
  sudo sshd -T 2>/dev/null | grep -qx 'passwordauthentication no' && ((key_count > 0)) \
    && pass "SSH takes keys only ($key_count authorized)" \
    || miss "SSH takes keys only" "rerun provision with --github <user>"
}
