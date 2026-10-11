#!/bin/bash
set -euo pipefail

readonly kit_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for library in "$kit_directory"/lib/*.sh "$kit_directory"/steps/*.sh "$kit_directory"/roles/*.sh; do
  source "$library"
done

readonly command_link="/usr/local/bin/provision"
readonly supported_roles=" runner worker "

github_users=()
extra_public_keys=()
roles=()
runner_labels=()
requested_grants=()
runner_prepull_images=()
runner_repository=""
wanted_hostname=""
notify_url=""
mode="apply"

usage() {
  cat <<'USAGE'
provision: set up this Mac to run headless, then report whether it is ready to rack.

  provision [options]

  --github <user>           authorize the SSH keys published at github.com/<user>.keys (repeatable)
  --ssh-key '<public key>'  authorize one more SSH public key (repeatable)
  --hostname <name>         name the Mac and its tailnet device
  --role runner             host ephemeral GitHub Actions runner VMs (needs --runner-repo)
  --role worker             host Tart VMs
  --runner-repo <owner/repo>
  --runner-label <label>    extra runner label beyond self-hosted, Linux, ARM64 (repeatable)
  --runner-prepull <image>  container image to bake into the runner VM (repeatable)
  --grant <kind>:<path>     walk you through a privacy grant in System Settings and check it took;
                            kind is full-disk-access, screen-recording, accessibility or all (repeatable)
  --notify-url <url>        POST a JSON summary here when done
  --check                   only print the checklist
  --help
USAGE
}

parse_arguments() {
  while (($# > 0)); do
    case "$1" in
      --github) github_users+=("${2:?--github needs a user}"); shift 2 ;;
      --ssh-key) extra_public_keys+=("${2:?--ssh-key needs a key}"); shift 2 ;;
      --hostname) wanted_hostname="${2:?--hostname needs a name}"; shift 2 ;;
      --role)
        [[ "$supported_roles" == *" ${2:-} "* ]] || die "unknown role '${2:-}'; roles:$supported_roles"
        roles+=("$2")
        shift 2
        ;;
      --runner-repo) runner_repository="${2:?--runner-repo needs owner/repo}"; shift 2 ;;
      --runner-label) runner_labels+=("${2:?--runner-label needs a label}"); shift 2 ;;
      --runner-prepull) runner_prepull_images+=("${2:?--runner-prepull needs an image}"); shift 2 ;;
      --grant)
        [[ "${2:-}" =~ ^(all|full-disk-access|screen-recording|accessibility):/ ]] || die "--grant takes <all|full-disk-access|screen-recording|accessibility>:<absolute path>"
        requested_grants+=("$2")
        shift 2
        ;;
      --notify-url) notify_url="${2:?--notify-url needs a url}"; shift 2 ;;
      --check) mode="check"; shift ;;
      --help | -h) usage; exit 0 ;;
      *) usage >&2; die "unknown option '$1'" ;;
    esac
  done
  [[ -z "$wanted_hostname" || "$wanted_hostname" =~ ^[A-Za-z0-9-]{1,63}$ ]] || die "--hostname takes letters, digits and dashes"
}

has_role() {
  [[ " ${roles[*]-} " == *" $1 "* ]]
}

require_macos_admin() {
  [[ "$(uname -s)" == Darwin ]] || die "runs on macOS only"
  (($(sw_vers -productVersion | cut -d. -f1) >= 15)) || die "needs macOS 15 or later"
  ((EUID != 0)) || die "run it as your own user, not root; it asks for your password once"
  id -Gn | tr ' ' '\n' | grep -qx admin || die "$USER is not an administrator"
}

saved_arguments_file="$HOME/.provision/arguments"

save_arguments() {
  install -d -m 700 "$HOME/.provision"
  printf '%s\0' "$@" >"$saved_arguments_file"
}

load_saved_arguments() {
  local saved=()
  local argument
  [[ -f "$saved_arguments_file" ]] || return 0
  while IFS= read -r -d '' argument; do
    saved+=("$argument")
  done <"$saved_arguments_file"
  parse_arguments ${saved[@]+"${saved[@]}"}
}

install_command() {
  if [[ "$(readlink "$command_link" 2>/dev/null)" == "$kit_directory/provision.sh" ]]; then
    unchanged "provision command at $command_link"
  else
    sudo install -d /usr/local/bin
    sudo ln -sf "$kit_directory/provision.sh" "$command_link"
    changed "provision command at $command_link"
  fi
}

run_checks() {
  check_power
  check_headless
  check_network
  check_updates
  check_privacy
  check_firewall
  check_sharing
  check_ssh
  check_unattended_boot
  check_homebrew
  check_tailscale
  local role
  for role in ${roles[@]+"${roles[@]}"}; do
    "check_role_$role"
  done
  check_privacy_grants
  note "Privacy grants are switched on by you in System Settings; provision opens each pane and checks it, and never writes the privacy database"
}

print_report() {
  run_checks
  printf '\n\033[1mReady-to-rack checklist for %s\033[0m\n' "$(scutil --get LocalHostName)"
  render_checklist
  printf '\n'
  checklist_verdict
}

apply() {
  if ! sudo -n true 2>/dev/null || needs_unattended_boot_password; then
    prompt_password_once
  fi
  keep_sudo_alive
  step "Name"; step_hostname
  step "Power and recovery"; step_power
  step "Headless"; step_headless
  step "macOS updates"; step_updates
  step "Privacy and Spotlight"; step_privacy
  step "Firewall"; step_firewall
  step "SSH"; step_ssh
  step "Sharing"; step_sharing
  step "Unattended boot"; step_unattended_boot
  forget_password
  step "Homebrew"; step_homebrew
  step "Tailscale"; step_tailscale
  step "Privacy grants"; step_privacy_grants
  local role
  for role in ${roles[@]+"${roles[@]}"}; do
    step "Role: $role"; "step_role_$role"
  done
  step "provision command"; install_command
}

main() {
  require_macos_admin
  if (($# == 0)); then
    load_saved_arguments
  else
    parse_arguments "$@"
  fi
  if [[ "$mode" == check ]]; then
    print_report
    return 0
  fi
  ((${#github_users[@]} + ${#extra_public_keys[@]} > 0)) || die "pass --github <user> or --ssh-key '<key>' so you can still get in once passwords are off"
  (($# == 0)) || save_arguments "$@"
  apply
  print_report
  send_notification
}

[[ "${BASH_SOURCE[0]}" != "$0" ]] || main "$@"
