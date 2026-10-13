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
  local repository="$1" name="$2" labels="$3"
  jq --null-input --compact-output \
    --arg name "$name" \
    --arg labels "$labels" \
    '{name: $name, runner_group_id: 1, labels: ($labels | split(",")), work_folder: "_work"}' \
    | github_api POST "/repos/$repository/actions/runners/generate-jitconfig" --data @- \
    | jq --raw-output --exit-status '"\(.runner.id) \(.encoded_jit_config)"'
}

remove_offline_runners() {
  local repository="$1" name_prefix="$2"
  local runner_ids runner_id
  runner_ids="$(github_api GET "/repos/$repository/actions/runners?per_page=100" \
    | jq --raw-output --arg prefix "$name_prefix" \
      '.runners[] | select(.status == "offline" and (.name | startswith($prefix))) | .id')" || return 1
  for runner_id in $runner_ids; do
    github_api DELETE "/repos/$repository/actions/runners/$runner_id" >/dev/null || return 1
  done
}

runner_is_busy() {
  local repository="$1" runner_id="$2"
  github_api GET "/repos/$repository/actions/runners/$runner_id" | jq --exit-status '.busy' >/dev/null
}

delete_runner() {
  local repository="$1" runner_id="$2"
  github_api DELETE "/repos/$repository/actions/runners/$runner_id" >/dev/null 2>&1
}

active_run_ids() {
  local repository="$1" status
  for status in queued in_progress; do
    github_api GET "/repos/$repository/actions/runs?status=$status&per_page=100" | jq --raw-output '.workflow_runs[].id' || return 1
  done
}

queued_job_count() {
  local repository="$1" labels="$2"
  local run_ids run_id count=0 run_count
  run_ids="$(active_run_ids "$repository")" || return 1
  for run_id in $run_ids; do
    run_count="$(github_api GET "/repos/$repository/actions/runs/$run_id/jobs?filter=latest&per_page=100" \
      | jq --raw-output --arg labels "$labels" \
        '($labels | ascii_downcase | split(",")) as $offered
        | [.jobs[] | select(.status == "queued" and (((.labels | map(ascii_downcase)) - $offered) == []))] | length')" || return 1
    count=$((count + run_count))
  done
  printf '%s\n' "$count"
}

idle_runner_count() {
  local repository="$1" labels="$2"
  github_api GET "/repos/$repository/actions/runners?per_page=100" \
    | jq --raw-output --arg labels "$labels" \
      '($labels | ascii_downcase | split(",")) as $offered
      | [.runners[] | select(.status == "online" and .busy == false and (($offered - (.labels | map(.name | ascii_downcase))) == []))] | length'
}

unmet_demand() {
  local repository="$1" labels="$2"
  local queued idle
  queued="$(queued_job_count "$repository" "$labels")" || return 1
  if ((queued == 0)); then
    printf '0\n'
    return 0
  fi
  idle="$(idle_runner_count "$repository" "$labels")" || return 1
  printf '%s\n' "$((queued - idle))"
}

latest_runner_release() {
  local platform="$1"
  github_api GET "/repos/actions/runner/releases/latest" \
    | jq --raw-output --exit-status --arg platform "$platform" \
      '.tag_name as $tag | .assets[] | select(.name | test("^actions-runner-\($platform)-arm64-[0-9.]+\\.tar\\.gz$")) | "\($tag | ltrimstr("v")) \(.browser_download_url) \(.digest | ltrimstr("sha256:"))"'
}
