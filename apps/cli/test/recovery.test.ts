import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addFakeCommand, createShellSandbox, disposeShellSandbox, runWithProvision, type ShellSandbox } from "./shell.ts";

const loginUrl = "https://login.tailscale.com/a/1a2b3c4d5e";

const addFakeSudo = (sandbox: ShellSandbox) =>
  addFakeCommand(sandbox, "sudo", 'printf "%s\\n" "$*" >> "$HOME/sudo.log"; [ "$1" = -n ] && shift; [ "$1" = -u ] && shift 2; exec "$@"');

const addFakeTailscale = (sandbox: ShellSandbox, firstUpFails = false) => {
  const fake = join(sandbox.bin, "tailscale-daemon");
  writeFileSync(
    fake,
    `#!/bin/bash
state="$HOME/tailscale"
mkdir -p "$state"
printf '%s\\n' "$*" >> "$state/calls"
case "$1" in
  status)
    if [ -e "$state/joined" ]; then
      echo '{"BackendState":"Running","Self":{"DNSName":"rack-1.tailnet.ts.net."}}'
    elif [ -e "$state/up-running" ]; then
      echo '{"BackendState":"NeedsLogin","AuthURL":"${loginUrl}"}'
    else
      echo '{"BackendState":"NeedsLogin"}'
    fi
    ;;
  up)
    if ${firstUpFails ? "true" : "false"} && [ ! -e "$state/failed-once" ]; then
      touch "$state/failed-once"
      echo "failed to connect to local tailscaled" >&2
      exit 1
    fi
    touch "$state/up-running"
    printf 'To authenticate, visit:\\n\\n\\t${loginUrl}\\n\\n\\342\\226\\210\\342\\226\\200\\342\\226\\200 qr line\\n'
    while [ ! -e "$state/joined" ]; do sleep 0.2; done
    ;;
  set|down) ;;
esac
`,
    { mode: 0o755 },
  );
  return fake;
};

const addConsoleUser = (sandbox: ShellSandbox) => {
  addFakeCommand(sandbox, "stat", "echo rack");
  addFakeCommand(sandbox, "id", "echo 501");
  addFakeCommand(sandbox, "launchctl", '[ "$1" = asuser ] && { shift 2; exec "$@"; }; exit 0');
  addFakeCommand(sandbox, "browser-open", 'printf "%s\\n" "$1" > "$HOME/opened"; touch "$HOME/tailscale/joined"');
};

describe("recovering a half-finished run", { timeout: 30_000 }, () => {
  let sandbox: ShellSandbox;

  beforeEach(() => {
    sandbox = createShellSandbox();
    addFakeSudo(sandbox);
  });

  afterEach(() => disposeShellSandbox(sandbox));

  describe("Tailscale sign-in", () => {
    const signIn = (fake: string) =>
      runWithProvision(
        sandbox,
        `homebrew_tailscale="${fake}"; open_command="${join(sandbox.bin, "browser-open")}"; wanted_hostname=rack-1; sign_in_to_tailnet`,
      );

    it("opens the sign-in page in the console user's browser session, prints it big with a QR code, and waits until it joins", () => {
      const fake = addFakeTailscale(sandbox);
      addConsoleUser(sandbox);
      const result = signIn(fake);
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(join(sandbox.home, "opened"), "utf8").trim()).toBe(loginUrl);
      expect(readFileSync(join(sandbox.home, "sudo.log"), "utf8")).toContain(`-n launchctl asuser 501 sudo -u rack ${join(sandbox.bin, "browser-open")} ${loginUrl}`);
      expect(result.stdout).toContain(`    ${loginUrl}\n`);
      expect(result.stdout).toContain("Or scan this with your phone");
      expect(result.stdout).toContain("qr line");
      expect(result.stdout).toContain("joined the tailnet as rack-1.tailnet.ts.net.");
      const calls = readFileSync(join(sandbox.home, "tailscale/calls"), "utf8");
      expect(calls).toContain("up --reset --qr --timeout=0s --accept-dns=false --hostname=rack-1");
    });

    it("starts tailscale up again when the daemon was not ready the first time", () => {
      const fake = addFakeTailscale(sandbox, true);
      addConsoleUser(sandbox);
      const result = signIn(fake);
      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
      expect(readFileSync(join(sandbox.home, "tailscale/calls"), "utf8").match(/^up /gm)).toHaveLength(2);
    });

    it("still prints the link when no one is logged in at the screen", () => {
      const fake = addFakeTailscale(sandbox);
      addFakeCommand(sandbox, "stat", "echo root");
      const signInWithoutConsole = spawnSync(
        "/bin/bash",
        ["-c", `set -euo pipefail; source "${join(import.meta.dirname, "../src/provision.sh")}"; homebrew_tailscale="${fake}"; (sleep 3; touch "$HOME/tailscale/joined") & sign_in_to_tailnet`],
        { encoding: "utf8", env: { PATH: `${sandbox.bin}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: sandbox.home, USER: "rack" } },
      );
      expect(signInWithoutConsole.status, signInWithoutConsole.stderr).toBe(0);
      expect(signInWithoutConsole.stdout).toContain("Open it on any device");
      expect(signInWithoutConsole.stdout).toContain(loginUrl);
    });
  });

  describe("DNS broken by an unauthenticated tailscaled", () => {
    const dnsFixedBy = (sandbox: ShellSandbox, fixingCall: string) => {
      addFakeCommand(sandbox, "dscacheutil", '[ "$1" = -flushcache ] && exit 0; [ -e "$HOME/dns-fixed" ] && echo "ip_address: 140.82.112.3"; exit 0');
      addFakeCommand(sandbox, "killall", "exit 0");
      const fake = join(sandbox.bin, "tailscale-daemon");
      writeFileSync(fake, `#!/bin/bash\nprintf '%s\\n' "$*" >> "$HOME/tailscale-calls"\n[ "$*" = "${fixingCall}" ] && touch "$HOME/dns-fixed"\nexit 0\n`, { mode: 0o755 });
      return fake;
    };

    it("takes Tailscale down before any download when that is what brings DNS back", () => {
      const fake = dnsFixedBy(sandbox, "down");
      const result = runWithProvision(sandbox, `homebrew_tailscale="${fake}"; require_name_resolution "before setup starts"`);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("took Tailscale down until sign-in, so DNS works again");
      expect(readFileSync(join(sandbox.home, "tailscale-calls"), "utf8")).toBe("set --accept-dns=false\ndown\n");
    });

    it("stops at accept-dns when that is enough", () => {
      const fake = dnsFixedBy(sandbox, "set --accept-dns=false");
      const result = runWithProvision(sandbox, `homebrew_tailscale="${fake}"; require_name_resolution "before setup starts"`);
      expect(result.stdout).toContain("stopped Tailscale from taking over DNS");
    });

    it("stops with a clear message when nothing brings DNS back", () => {
      addFakeCommand(sandbox, "dscacheutil", "exit 0");
      addFakeCommand(sandbox, "killall", "exit 0");
      const result = runWithProvision(sandbox, `homebrew_tailscale="${join(sandbox.bin, "absent")}"; require_name_resolution "before setup starts"`);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("can't look up github.com before setup starts. Check the network cable or Wi-Fi, then run the same command again.");
    });
  });

  describe("SSH keys", () => {
    it("falls back to the keys saved by the last run when GitHub can't be reached", () => {
      mkdirSync(join(sandbox.home, ".provision"), { recursive: true });
      writeFileSync(join(sandbox.home, ".provision/authorized-keys"), "ssh-ed25519 AAAAsaved github:owner\n");
      addFakeCommand(sandbox, "curl", "exit 6");
      const result = runWithProvision(sandbox, "parse_arguments --github owner; fetch_public_keys");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("using the ones saved by the last run");
    });

    it("saves freshly fetched keys for the next run", () => {
      addFakeCommand(sandbox, "curl", 'echo "ssh-ed25519 AAAAfresh"');
      runWithProvision(sandbox, "parse_arguments --github owner; fetch_public_keys");
      expect(readFileSync(join(sandbox.home, ".provision/authorized-keys"), "utf8")).toBe("ssh-ed25519 AAAAfresh github:owner\n");
    });
  });

  describe("step order", () => {
    const applyOrder = () => {
      const body = runWithProvision(sandbox, "declare -f apply").stdout;
      return [...body.matchAll(/\b(collect_credentials|require_name_resolution|fetch_public_keys|step_[a-z_]+|"step_role_\$role"|forget_password)\b/g)].map((match) => match[1]);
    };

    it("collects the password first, repairs DNS before the first download, and does every download before Tailscale", () => {
      const order = applyOrder();
      expect(order.slice(0, 3)).toEqual(["collect_credentials", "require_name_resolution", "fetch_public_keys"]);
      const tailscale = order.indexOf("step_tailscale");
      for (const download of ["fetch_public_keys", "step_ssh", "step_homebrew"]) expect(order.indexOf(download)).toBeLessThan(tailscale);
      expect(runWithProvision(sandbox, "declare -f apply").stdout.indexOf("step_role_")).toBeLessThan(runWithProvision(sandbox, "declare -f apply").stdout.indexOf("step_tailscale"));
      expect(order.indexOf("forget_password")).toBeGreaterThan(order.indexOf("step_unattended_boot"));
    });

    it("never lets a later sudo stop to ask for a password", () => {
      const result = runWithProvision(sandbox, "sudo whoami");
      expect(readFileSync(join(sandbox.home, "sudo.log"), "utf8")).toBe("-n whoami\n");
      expect(result.status).toBe(0);
    });
  });
});
