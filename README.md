# provision

One command that turns a fresh Mac into a headless machine you can rack: no display, keyboard or mouse, reachable over SSH, Screen Sharing and Tailscale, back on its own after a power cut, and slimmed down to what a headless host needs.

## Quick start

On a fresh Mac, in Terminal:

```
curl -fsSL https://raw.githubusercontent.com/ridafkih/provision/main/install.sh | bash -s -- --github <your GitHub user>
```

It downloads the latest released `provision` binary (Apple silicon), checks it against its published SHA-256 and runs it. `--github` authorizes the SSH keys you publish at github.com/<user>.keys; every other option below works the same way. `--profile <name>` adds the arguments in `apps/cli/assets/profiles/<name>.args` first (profiles are built into the binary), so a profile can hold your usual keys:

```
curl -fsSL https://raw.githubusercontent.com/ridafkih/provision/main/install.sh | bash -s -- --profile rida
```

Without the one-liner, copy the binary over yourself: `bun run build` writes it to `apps/cli/dist/provision`, and `./provision --profile rida` on the Mac does the same as the command above.

### How the binary reaches a fresh Mac

A fresh Mac has no Bun, so provision ships as one compiled arm64 executable. Every push to `main` runs `.github/workflows/release.yml` on a GitHub-hosted Apple silicon runner: lint, type-check, the full test suite, then `bun build --compile`, an ad-hoc signature, and a GitHub release holding `provision-darwin-arm64` and its `.sha256`. `install.sh` fetches `releases/latest/download/provision-darwin-arm64` with `curl`, so nothing on the Mac builds, installs a toolchain or reaches the npm registry; the download is one file, verified, with no quarantine flag. Building on the Mac instead would mean installing Bun and resolving packages during setup, on the very machine whose network and DNS provision is still repairing. Branches publish pre-releases (never `latest`) that `install.sh --binary <url>` can try before they land.

## The flow

1. Finish macOS Setup Assistant with your own admin account. Plug in power and network.
2. Open Terminal and run the command. It asks for your password once, in the terminal. The password unlocks sudo, turns FileVault off and turns on automatic login; it is kept in memory for those steps only and never written or sent.
3. Tailscale's sign-in page opens in the browser by itself. Sign in and approve the Mac; the command waits until it is on the tailnet.
4. For each `--grant`, System Settings opens at the right privacy pane and Finder shows the item. Drag it into the list and switch it on; the command checks the grant took before it moves on.
5. Once SSH answers, automatic login is set and the Mac is on the tailnet, provision slims it (see Slimming). It skips this until all of those are confirmed, so a half-finished run never leaves you locked out.
6. Read the ready-to-rack checklist. Do the items marked `!`, then unplug the display, keyboard and mouse and rack it.

Run `provision` again any time (it is copied to `~/.provision/bin` and linked into `/usr/local/bin`); with no options it replays the options of the last run. Every step, slimming included, checks before it changes anything, so a rerun only touches what drifted. `provision --check` only prints the checklist, slim state included, and works over SSH without sudo.

`provision tui` opens the same thing interactively: a Setup tab with every step and what its check found, and a Slim tab with every slim task, its state and the exact commands it would run. Pick what to apply with space and press `x`; setup steps run in the terminal as a normal run would, and slim tasks run under `sudo provision slim apply`.

## What it sets

| Area | Settings |
|---|---|
| Power and recovery | Never sleeps (`pmset` sleep, display, disk and standby 0, sleep disabled, Power Nap off), starts up after a power cut, wakes for network access, keeps TCP alive, restarts after a freeze where `systemsetup` allows it. |
| Passwordless sudo | `/etc/sudoers.d/provision-<user>` (root:wheel, 0440) with `<user> ALL=(ALL) NOPASSWD: ALL`, checked with `visudo` before it is installed and again after. It is the first step, so every later root step, and every rerun over SSH, runs without your password. `--no-passwordless-sudo` keeps sudo asking. |
| Unattended boot | FileVault off (it waits for decryption to finish) and automatic login as you, so a power cut ends at your desktop with the login keychain unlocked. |
| Remote access | Remote Login (SSH) on, your GitHub keys and any `--ssh-key` authorized, passwords off for SSH. Screen Sharing on, Remote Management off. |
| Tailscale | The open-source `tailscaled` from Homebrew as a system daemon, so it connects before anyone logs in and follows the Mac across networks and between Wi-Fi and Ethernet. It joins with `--accept-dns=false`, so the Mac keeps its own DNS: other devices still reach it by its tailnet name. A Tailscale app that is already installed is used instead of adding a second daemon. |
| Headless | No Bluetooth setup window when it boots without a keyboard or mouse, no crash dialogs, no screen saver. |
| macOS updates | Download only. They never install or restart on their own; security responses and system data files still install. |
| Privacy and noise | Spotlight indexing off, guest account off, analytics and crash submission off, firewall and stealth mode on, file, printer and internet sharing off. |
| Tooling | Homebrew (with the Xcode Command Line Tools it installs). |
| Slimming | Telemetry, Apple Intelligence, Siri, suggestions, media analysis and consumer services off; for VM hosts also iCloud, the App Store, Mail and Messages, Continuity, the desktop shell, enterprise services, Spotlight's UI, Time Machine and the bundled creative apps (about 8 GB). See Slimming. |

Every step is idempotent and prints `set:` or `unchanged:`. The password is the only thing it asks for, and it asks first; every later `sudo` is non-interactive. Before the first download it checks that the Mac can look up github.com and repairs DNS if an unsigned-in Tailscale broke it, so running the same command again picks up wherever a previous run stopped.

## Privacy grants

Full Disk Access, Screen Recording and Accessibility can only be switched on by a person in System Settings, or pre-approved by an MDM server. `--grant <kind>:<path>` (kind `full-disk-access`, `screen-recording`, `accessibility` or `all`) makes that a guided step: provision opens the exact pane, reveals the app or tool in Finder, and polls the privacy database until the switch is on. Full Disk Access is always asked for first, because the other grants are read back through it: directly when Terminal has it, otherwise over SSH to this Mac with a key that only works from 127.0.0.1.

For a Mac you drive over SSH, the client to grant is `/usr/libexec/sshd-keygen-wrapper` (the same switch as "Allow full disk access for remote users" under Remote Login). The `rida` profile asks for all three on it.

## Slimming

The last step runs `provision slim apply` for the role: `--role runner` and `--role worker` get the `host` profile, any other Mac the `lean` one. `--no-slim` skips it. On its own:

```
provision slim status            state of every task
provision slim plan -p host      every command apply would run, nothing changed
sudo provision slim apply -p host
sudo provision slim restore      undo everything slimming changed
provision slim protected         what it never touches
```

It only ever uses `launchctl disable` and `bootout`, `defaults`, `pmset`, `mdutil`, and deleting the bundled apps in `/Applications`. Every change except the deleted apps is journaled in `/var/db/macslim/journal.json` with the steps that undo it. It never mounts, edits or re-seals the system volume and never asks for `csrutil authenticated-root disable`: on 2026-10-11 editing the sealed volume left a Mac stuck at boot twice, and the tests now fail if any step could touch it.

Services that launchd only keeps disabled with System Integrity Protection off are skipped while SIP is on, which is the default; the checklist lists them. provision never turns SIP off.

It never disables what a racked host needs: the GUI login session (WindowManager, Control Center and the menu bar agent, without which automatic login falls back to the password prompt), Virtualization.framework and vmnet (`bootpd`, `NetworkSharing`), sshd, Screen Sharing, software update, networking and DNS, the security daemons, Xcode and simulator tooling, and anything that isn't Apple's, such as Tailscale. On a host profile it adds one small login agent that keeps a Terminal window open.

## What it never does

- It never writes to the sealed system volume and never turns off System Integrity Protection.
- It never writes the privacy (TCC) database; System Integrity Protection guards it, and a grant written around it would not be trustworthy.
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
- `--role runner --runner-repo <owner/repo>[=<label>]`: ephemeral GitHub Actions runners for one or more repositories. Each job runs in its own Tart Linux VM (`ghcr.io/cirruslabs/ubuntu-runner-arm64:24.04`) cloned from a golden image, registered as a just-in-time runner that takes exactly one job, isolated with Softnet from the host, the LAN and the tailnet, and deleted afterwards. A slot always has a booted runner waiting. The golden image is rebuilt when GitHub ships a new runner and at least weekly. Labels are `self-hosted, Linux, ARM64` plus any `--runner-label`; `--runner-prepull <image>` bakes service images into the VM. Slots are sized from memory and cores (two on a 16 GB Mac).

  Repeat `--runner-repo` to share the slots between repositories. GitHub binds a runner to one repository, so each cycle a slot registers with the first repository that has a matching job queued and no idle runner to take it, and with the first repository otherwise. While its runner sits idle, a slot checks every 30 to 45 seconds; when another repository has jobs waiting and its own repository has a spare idle runner, it deletes its registration (GitHub refuses that for a runner that has just picked up a job) and recycles to serve the other one. A busy runner is never touched. The `=<label>` part adds a label to that repository's runners only, so `--runner-repo example/app=app --runner-repo example/tool=tool` gives `self-hosted, Linux, ARM64, app` and `self-hosted, Linux, ARM64, tool`. A repository the token cannot see is skipped and logged, and the others keep running.

  Softnet keeps a VM off the LAN and the tailnet but always lets it reach its bridge gateway, which is the host itself. A pf anchor, `com.apple/300.provision-runner` (rules in `/etc/pf.anchors/provision-runner`), closes that gap. On the vmnet bridges it lets a VM ask the host for DHCP and DNS and refuses everything else, SSH and Screen Sharing included. The LaunchDaemon `dev.provision.runner-firewall` loads it at boot and re-asserts it every five minutes. The anchor sits under `com.apple/*`, so `/etc/pf.conf` stays untouched.

  `--runner-macos-image <tart image>` adds one macOS slot that works the same way: a macOS VM cloned from a golden image baked from that image (for example `ghcr.io/cirruslabs/macos-tahoe-xcode:26.5`, which carries Xcode), a just-in-time runner labelled `self-hosted, macOS, ARM64` plus any `--runner-macos-label`, Softnet isolation, and deletion after the one job. A host gets at most one, because Apple's licence allows two macOS VMs per Mac and the bake needs the second. It takes 6 GB, so the Linux slots get what is left: a 24 GB Mac runs two Linux slots beside the macOS one and a 16 GB Mac runs one. The pf anchor above covers it like any other VM. The first macOS bake downloads about 70 GB and takes about 85 GB of disk, so pin the image by digest (`ghcr.io/cirruslabs/macos-tahoe-xcode@sha256:…`): a pinned image that is already cached is never pulled again, while a tag is checked for a new build on every bake. Before any pull the bake checks for free space (40 GB for Linux, 100 GB for macOS), clears Tart's image cache if it is short, and otherwise keeps the current golden image and skips that bake rather than fill the disk. The slot's watchdog stops a runner whose VM exits or stops answering its guest agent, so the slot recycles instead of holding a dead runner.

  The runner needs one secret: `GITHUB_RUNNER_TOKEN`, a fine-grained token covering every `--runner-repo` with Administration read and write and Actions read (a shared pool reads queued jobs to decide where to go), in `~/.provision/runner/credentials.env` (mode 600). Slots wait for it. Then start the first bake with `launchctl kickstart -k gui/$(id -u)/dev.provision.runner-bake`.

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
--runner-repo, --runner-label, --runner-prepull, --runner-macos-image, --runner-macos-label
--no-slim                 leave the services and apps macOS ships alone
--no-passwordless-sudo    keep asking for your password for sudo after setup
--notify-url <url>        POST a JSON summary when done
--check                   print the checklist only
--profile <name>          add a built-in profile's arguments first
```

`provision tui` and `provision slim <command>` are described above.

## Layout

| Path | What |
|---|---|
| `install.sh` | The one-liner: downloads the released binary, checks its SHA-256 and runs it. |
| `apps/cli/src/cli.ts` | The command: setup, `tui` and `slim`. TypeScript on Bun, compiled to one binary. |
| `apps/cli/src/setup/` | Setup: options, credentials, and `steps/` with one file per area, each with an `apply` and a `check` for the checklist; `roles/` holds the worker and runner roles. |
| `apps/cli/src/slim/` | Slimming: the task catalog, the protected list, the engine and journal. |
| `apps/cli/src/core/` | What both share: the command runner, output and the checklist. |
| `apps/cli/src/tui/` | The Ink TUI. |
| `apps/cli/assets/` | Files built into the binary: profiles, the runner's VM scripts and launch agents, and the expect script that answers FileVault and automatic-login prompts. |
| `.github/workflows/release.yml` | Tests, builds and publishes the binary. |

```
bun install
bun run test
bun run typecheck
bun run lint
bun run build      # apps/cli/dist/provision
```
