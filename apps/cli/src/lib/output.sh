step() {
  printf '\n\033[1m== %s\033[0m\n' "$1"
}

say() {
  printf '%s\n' "$*"
}

changed() {
  printf 'set: %s\n' "$*"
}

unchanged() {
  printf 'unchanged: %s\n' "$*"
}

needs_owner() {
  printf 'needs you: %s\n' "$*"
}

die() {
  printf 'provision: %s\n' "$*" >&2
  exit 1
}
