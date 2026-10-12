github_api() {
  local method="$1" path="$2"
  shift 2
  curl --fail-with-body --silent --show-error --max-time 30 \
    --request "$method" \
    --header "Authorization: Bearer $GITHUB_RUNNER_TOKEN" \
    --header "Accept: application/vnd.github+json" \
    --header "X-GitHub-Api-Version: 2022-11-28" \
    "$GITHUB_API_URL$path" "$@"
}

create_jit_config() {
  local name="$1"
  jq --null-input --compact-output \
    --arg name "$name" \
    --arg labels "$RUNNER_LABELS" \
    '{name: $name, runner_group_id: 1, labels: ($labels | split(",")), work_folder: "_work"}' \
    | github_api POST "/repos/$GITHUB_REPOSITORY/actions/runners/generate-jitconfig" --data @- \
    | jq --raw-output --exit-status '.encoded_jit_config'
}

remove_offline_runners() {
  local name_prefix="$1"
  local runner_id
  for runner_id in $(github_api GET "/repos/$GITHUB_REPOSITORY/actions/runners?per_page=100" \
    | jq --raw-output --arg prefix "$name_prefix" \
      '.runners[] | select(.status == "offline" and (.name | startswith($prefix))) | .id'); do
    github_api DELETE "/repos/$GITHUB_REPOSITORY/actions/runners/$runner_id" >/dev/null
  done
}

latest_runner_release() {
  github_api GET "/repos/actions/runner/releases/latest" \
    | jq --raw-output --exit-status \
      '.tag_name as $tag | .assets[] | select(.name | test("^actions-runner-linux-arm64-[0-9.]+\\.tar\\.gz$")) | "\($tag | ltrimstr("v")) \(.browser_download_url) \(.digest | ltrimstr("sha256:"))"'
}
