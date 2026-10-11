provision_home="$HOME/.provision"
installed_kit_directory="$provision_home/kit"

has_foreign_files_in_provision_home() {
  [[ -e "$provision_home" ]] || return 1
  [[ -n "$(find "$provision_home" \( ! -user "$(id -u)" -o ! -perm -u+w \) -print -quit 2>/dev/null)" ]] \
    || ! find "$provision_home" -print -quit >/dev/null 2>&1
}

repair_provision_home() {
  if has_foreign_files_in_provision_home; then
    sudo chown -R "$USER":staff "$provision_home"
    sudo chmod -R u+rwX "$provision_home"
    changed "gave $provision_home back to $USER"
  fi
  install -d -m 700 "$provision_home"
  [[ -w "$provision_home" ]] || die "$provision_home is still not writable by $USER"
}

install_kit() {
  if [[ "$kit_directory" == "$installed_kit_directory" ]]; then
    unchanged "provision kit at $installed_kit_directory"
    return 0
  fi
  rm -rf "$installed_kit_directory.next"
  cp -R "$kit_directory" "$installed_kit_directory.next"
  rm -rf "$installed_kit_directory"
  mv "$installed_kit_directory.next" "$installed_kit_directory"
  changed "provision kit at $installed_kit_directory"
}
