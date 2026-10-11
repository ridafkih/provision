# provision

One command that turns a fresh Mac into a headless machine you can rack: no display, keyboard or mouse, reachable over SSH, Screen Sharing and Tailscale, and back on its own after a power cut.

## Quick start

On a fresh Mac, in Terminal:

```
curl -fsSL https://raw.githubusercontent.com/ridafkih/provision/main/install.sh | bash -s -- --github <your GitHub user>
```

It downloads this repository's `main`, unpacks the kit to `~/.provision/kit` and runs it. `--github` authorizes the SSH keys you publish at github.com/<user>.keys; every other option below works the same way. `--profile <name>` adds the arguments in `apps/cli/profiles/<name>.args` first, so a profile can hold your usual keys:

```
curl -fsSL https://raw.githubusercontent.com/ridafkih/provision/main/install.sh | bash -s -- --profile rida
```

Without network access to GitHub, `bun run build` writes one self-contained installer per profile to `apps/cli/dist/` (`provision.sh`, plus `<profile>.sh`); copy one over and run `bash provision.sh --github <you>`.

## The flow

1. Finish macOS Setup Assistant with your own admin account. Plug in power and network.
2. Open Terminal and run the command. It asks for your password once, in the terminal. The password unlocks sudo, turns FileVault off and turns on automatic login; it is kept in memory for those steps only and never written or sent.
3. When Tailscale's sign-in page opens in the browser, sign in. The command waits until the Mac is on the tailnet.
4. Read the ready-to-rack checklist. Do the items marked `!`, then unplug the display, keyboard and mouse and rack it.

Run `provision` again any time (it is linked into `/usr/local/bin`); with no options it replays the options of the last run. `provision --check` only prints the checklist.

## What it sets

| Area | Settings |
|---|---|
| Power and recovery | Never sleeps (`pmset` sleep, display, disk and standby 0, sleep disabled, Power Nap off), starts up after a power cut, wakes for network access, keeps TCP alive, restarts after a freeze where `systemsetup` allows it. |
| Unattended boot | FileVault off (it waits for decryption to finish) and automatic login as you, so a power cut ends at your desktop with the login keychain unlocked. |
| Remote access | Remote Login (SSH) on, your GitHub keys and any `--ssh-key` authorized, passwords off for SSH. Screen Sharing on, Remote Management off. |
| Tailscale | The open-source `tailscaled` from Homebrew as a system daemon, so it connects before anyone logs in and follows the Mac across networks and between Wi-Fi and Ethernet. A Tailscale app that is already installed is used instead of adding a second daemon. |
| Headless | No Bluetooth setup window when it boots without a keyboard or mouse, no crash dialogs, no screen saver. |
| macOS updates | Download only. They never install or restart on their own; security responses and system data files still install. |
| Privacy and noise | Spotlight indexing off, guest account off, analytics and crash submission off, firewall and stealth mode on, file, printer and internet sharing off. |
| Tooling | Homebrew (with the Xcode Command Line Tools it installs). |

Every step is idempotent and prints `set:` or `unchanged:`.

## What it never does

- It never writes the privacy (TCC) database. Full Disk Access, Screen Recording and Accessibility stay clicks in System Settings; none is needed for the base setup.
- It doesn't turn off notifications: Focus and Do Not Disturb have no supported command line. With no display attached, nothing waits on a banner.

## What still needs your hands

The checklist marks these with `!` when they apply:

- **Tailscale key expiry.** A node key expires after 180 days and the Mac would drop off the tailnet. In the admin console, open the machine and choose Disable key expiry.
- **Screen Sharing or Remote Login** if this macOS refuses to start them from the command line. System Settings → General → Sharing.

## Display

A Mac with no display boots and serves SSH and Screen Sharing normally. For GPU work or a full-resolution desktop over Screen Sharing, add a virtual display app or an HDMI dummy plug.

## Roles

Roles add a job on top of the base layer:

- `--role worker`: a VM host. Tart and Softnet from Homebrew, Softnet set-uid root so Tart can isolate VM networks without sudo.
- `--role runner --runner-repo <owner/repo>`: ephemeral GitHub Actions runners for one repository. Each job runs in its own Tart Linux VM (`ghcr.io/cirruslabs/ubuntu-runner-arm64:24.04`) cloned from a golden image, registered as a just-in-time runner that takes exactly one job, isolated with Softnet from the host, the LAN and the tailnet, and deleted afterwards. A slot always has a booted runner waiting. The golden image is rebuilt when GitHub ships a new runner and at least weekly. Labels are `self-hosted, Linux, ARM64` plus any `--runner-label`; `--runner-prepull <image>` bakes service images into the VM. Slots are sized from memory and cores (two on a 16 GB Mac).

  The runner needs one secret: `GITHUB_RUNNER_TOKEN`, a fine-grained token for that repository with Administration read and write, in `~/.provision/runner/credentials.env` (mode 600). Slots wait for it. Then start the first bake with `launchctl kickstart -k gui/$(id -u)/dev.provision.runner-bake`.

Example, run over SSH after racking:

```
provision --github <you> --role runner --runner-repo example/app --runner-label app \
  --runner-prepull postgres:18 --runner-prepull amazon/dynamodb-local:3.3.1 \
  --runner-prepull nsmithuk/local-kms:3.12.0 --runner-prepull zricethezav/gitleaks:v8.30.1
```

## Options

```
--github <user>           authorize github.com/<user>.keys (repeatable)
--ssh-key '<public key>'  authorize one more key (repeatable)
--hostname <name>         name the Mac and its tailnet device
--role runner|worker      add a role (repeatable)
--runner-repo, --runner-label, --runner-prepull
--notify-url <url>        POST a JSON summary when done
--check                   print the checklist only
```

## Layout

| Path | What |
|---|---|
| `apps/cli/src/provision.sh` | The command. Bash 3.2, since a fresh Mac has nothing newer. |
| `apps/cli/src/steps/` | One file per area, each with a `step_` function that applies it and a `check_` function for the checklist. |
| `apps/cli/src/roles/` | The worker and runner roles; the runner's VM scripts live in `roles/runner/`. |
| `apps/cli/build/` | Bundles `src` into one self-extracting installer per profile (`dist/provision.sh`, `dist/<profile>.sh`). |
| `apps/cli/profiles/` | One argument per line. |

```
bun install
bun run test
bun run typecheck
bun run lint
```
