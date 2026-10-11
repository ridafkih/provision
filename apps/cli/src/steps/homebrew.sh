readonly brew="/opt/homebrew/bin/brew"

ensure_formula() {
  local formula="$1"
  if "$brew" list --formula "${formula##*/}" >/dev/null 2>&1; then
    unchanged "$formula installed"
  else
    "$brew" install --quiet "$formula"
    changed "$formula installed"
  fi
}

step_homebrew() {
  if [[ -x "$brew" ]]; then
    unchanged "Homebrew installed"
  else
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    changed "Homebrew installed"
  fi
}

check_homebrew() {
  [[ -x "$brew" ]] && pass "Homebrew installed" || miss "Homebrew installed" "rerun provision"
}
