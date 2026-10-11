readonly runner_config_directory="$HOME/.provision/runner"
readonly runner_config_file="$runner_config_directory/runner.env"
readonly runner_required_keys=(
  GITHUB_API_URL
  GITHUB_REPOSITORY
  RUNNER_NAME_PREFIX
  RUNNER_LABELS
  RUNNER_LIFETIME_SECONDS
  LINUX_BASE_IMAGE
  LINUX_GOLDEN_VM
  LINUX_SLOTS
  VM_CPU_COUNT
  VM_MEMORY_MB
  VM_DISK_GB
  BAKE_MEMORY_MB
  BAKE_MAX_AGE_DAYS
  BOOT_TIMEOUT_SECONDS
  RETRY_DELAY_SECONDS
  CREDENTIALS_FILE
  LOG_DIRECTORY
)

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

missing_keys() {
  local key
  for key in "$@"; do
    [[ -n "${!key-}" ]] || printf '%s ' "$key"
  done
}

load_runner_config() {
  [[ -f "$runner_config_file" ]] || fail "missing $runner_config_file; run provision --role runner"
  set -a
  source "$runner_config_file"
  set +a
  local missing
  missing="$(missing_keys "${runner_required_keys[@]}")"
  [[ -z "$missing" ]] || fail "$runner_config_file is missing: ${missing% }"
  [[ -n "${PREPULL_IMAGES+set}" ]] || fail "$runner_config_file is missing: PREPULL_IMAGES"
}

has_runner_credentials() {
  [[ -f "$CREDENTIALS_FILE" ]] || return 1
  set -a
  source "$CREDENTIALS_FILE"
  set +a
  [[ -z "$(missing_keys GITHUB_RUNNER_TOKEN)" ]]
}
