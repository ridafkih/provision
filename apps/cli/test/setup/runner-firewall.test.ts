import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createChecklist, renderChecklist } from "../../src/core/checklist";
import {
  applyRunnerFirewall,
  checkRunnerFirewall,
  runnerFirewallAnchor,
  runnerFirewallDaemon,
  runnerFirewallDaemonFile,
  runnerFirewallRules,
  runnerFirewallRulesFile,
} from "../../src/setup/roles/runner-firewall";
import { addFakeCommand, createSandbox, disposeSandbox, type Sandbox } from "../sandbox";

const fakeFirewallHost = (sandbox: Sandbox) => {
  sandbox.machine.paths.pfAnchorsDirectory = join(sandbox.root, "pf.anchors");
  sandbox.machine.paths.launchDaemonsDirectory = join(sandbox.root, "LaunchDaemons");
  mkdirSync(sandbox.machine.paths.pfAnchorsDirectory);
  mkdirSync(sandbox.machine.paths.launchDaemonsDirectory);
  addFakeCommand(sandbox, "sudo", '[ "$1" = -n ] && shift; exec "$@"');
  addFakeCommand(sandbox, "install", 'printf "install %s\\n" "$*" >> "$HOME/calls"; cp "${@: -2:1}" "${@: -1}"');
  addFakeCommand(
    sandbox,
    "pfctl",
    `printf "pfctl %s\\n" "$*" >> "$HOME/calls"
case "$*" in
  "-s info") if [ -f "$HOME/pf-disabled" ]; then echo "Status: Disabled"; else echo "Status: Enabled for 0 days 01:00:00"; fi ;;
  "-E") rm -f "$HOME/pf-disabled" ;;
  "-n "*) [ -f "$HOME/pf-invalid" ] && exit 1; exit 0 ;;
  *" -s rules") cat "$HOME/pf-loaded" 2>/dev/null ;;
  *" -f "*) if [ -f "$HOME/pf-busy-once" ]; then rm "$HOME/pf-busy-once"; echo "DIOCADDRULE: Resource busy" >&2; exit 1; fi; cp "\${@: -1}" "$HOME/pf-loaded" ;;
esac`,
  );
  const daemonScript = `/usr/libexec/PlistBuddy -c "Print :ProgramArguments:2" "${runnerFirewallDaemonFile(sandbox.machine)}"`;
  addFakeCommand(
    sandbox,
    "launchctl",
    `printf "launchctl %s\\n" "$*" >> "$HOME/calls"
case "$1" in
  print) [ -f "$HOME/daemon-loaded" ] ;;
  bootstrap) touch "$HOME/daemon-loaded"; sh -c "$(${daemonScript})" ;;
  kickstart) sh -c "$(${daemonScript})" ;;
  bootout) rm -f "$HOME/daemon-loaded" ;;
esac`,
  );
};

const calls = (sandbox: Sandbox) => (existsSync(join(sandbox.home, "calls")) ? readFileSync(join(sandbox.home, "calls"), "utf8").trim().split("\n") : []);

const clearCalls = (sandbox: Sandbox) => rmSync(join(sandbox.home, "calls"), { force: true });

const checklistOf = (sandbox: Sandbox) => {
  const checklist = createChecklist();
  checkRunnerFirewall(sandbox.machine, checklist);
  return renderChecklist(checklist);
};

const hostOnlyLabel = "Runner VMs reach the host only for DHCP and DNS";

describe("runner firewall rules", () => {
  const rules = runnerFirewallRules();
  const lines = rules.trim().split("\n");
  const indexOf = (pattern: RegExp) => lines.findIndex((line) => pattern.test(line));

  it("lets runner VMs ask the host for DHCP and DNS before blocking everything else to it", () => {
    const dhcp = indexOf(/^pass in quick on \$vm_bridges inet proto udp from any port 68 to any port 67$/);
    const dns = indexOf(/^pass in quick on \$vm_bridges inet proto \{ udp, tcp \} from any to <runner_host_side> port 53$/);
    const block = indexOf(/^block return in quick on \$vm_bridges inet from any to <runner_host_side> label "provision-runner-[0-9a-f]{12}"$/);
    expect(dhcp).toBeGreaterThanOrEqual(0);
    expect(dns).toBeGreaterThanOrEqual(0);
    expect(block).toBeGreaterThan(Math.max(dhcp, dns));
  });

  it("blocks TCP and UDP to the host over IPv6 as well", () => {
    expect(indexOf(/^block return in quick on \$vm_bridges inet6 proto \{ tcp, udp \} from any to any label "provision-runner-[0-9a-f]{12}"$/)).toBeGreaterThan(0);
  });

  it("covers every host-side address range: private, tailnet, link-local, loopback and multicast", () => {
    for (const range of ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "169.254.0.0/16", "127.0.0.0/8", "224.0.0.0/4", "255.255.255.255/32"])
      expect(rules).toContain(range);
  });

  it("applies only to the vmnet bridges, never to the LAN, Wi-Fi, Thunderbolt bridge or loopback", () => {
    const bridges = rules.match(/^vm_bridges = "\{ (.*) \}"$/m)?.[1]?.split(" ") ?? [];
    expect(bridges[0]).toBe("bridge100");
    expect(bridges.at(-1)).toBe("bridge163");
    expect(bridges).toHaveLength(64);
    expect(rules).not.toMatch(/\b(en\d|lo0|bridge0|utun\d)\b/);
    expect(lines.filter((line) => /^(pass|block)/.test(line)).every((line) => line.includes(" on $vm_bridges "))).toBe(true);
  });

  it("labels the blocks with a hash of the rules, so a loaded anchor can be matched to the file", () => {
    const labels = new Set(rules.match(/provision-runner-[0-9a-f]{12}/g));
    expect(labels.size).toBe(1);
    expect(runnerFirewallRules()).toBe(rules);
  });
});

describe("runner firewall", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = createSandbox();
    fakeFirewallHost(sandbox);
  });
  afterEach(() => disposeSandbox(sandbox));

  it("installs the rules and a boot daemon as root, has the daemon load the anchor, then leaves all of it alone", () => {
    applyRunnerFirewall(sandbox.machine);
    expect(readFileSync(runnerFirewallRulesFile(sandbox.machine), "utf8")).toBe(runnerFirewallRules());
    expect(readFileSync(runnerFirewallDaemonFile(sandbox.machine), "utf8")).toBe(runnerFirewallDaemon(sandbox.machine));
    const first = calls(sandbox);
    expect(first.filter((call) => call.startsWith("install -m 0644 -o root -g wheel ")).length).toBe(2);
    expect(first.findIndex((call) => call.startsWith("pfctl -n -a "))).toBeLessThan(first.findIndex((call) => call.startsWith("install ")));
    expect(first).toContain(`launchctl bootstrap system ${runnerFirewallDaemonFile(sandbox.machine)}`);
    expect(first).toContain("launchctl kickstart -k system/dev.provision.runner-firewall");
    expect(first).toContain(`pfctl -a ${runnerFirewallAnchor} -f ${runnerFirewallRulesFile(sandbox.machine)}`);
    expect(sandbox.printed).toEqual([`set: ${hostOnlyLabel} (pf anchor ${runnerFirewallAnchor})`]);

    clearCalls(sandbox);
    applyRunnerFirewall(sandbox.machine);
    expect(calls(sandbox).filter((call) => /^(install|launchctl bootstrap|launchctl bootout|launchctl kickstart)|-f /.test(call))).toEqual([]);
    expect(sandbox.printed.at(-1)).toBe(`unchanged: ${hostOnlyLabel}`);
  });

  it("loads the anchor again when pf lost it, without reinstalling anything", () => {
    applyRunnerFirewall(sandbox.machine);
    rmSync(join(sandbox.home, "pf-loaded"));
    clearCalls(sandbox);
    applyRunnerFirewall(sandbox.machine);
    expect(calls(sandbox)).toContain("launchctl kickstart -k system/dev.provision.runner-firewall");
    expect(calls(sandbox)).toContain(`pfctl -a ${runnerFirewallAnchor} -f ${runnerFirewallRulesFile(sandbox.machine)}`);
    expect(calls(sandbox).some((call) => call.startsWith("install "))).toBe(false);
  });

  it("replaces an anchor loaded from older rules", () => {
    applyRunnerFirewall(sandbox.machine);
    writeFileSync(join(sandbox.home, "pf-loaded"), 'block return in quick on bridge100 inet all label "provision-runner-000000000000"\n');
    clearCalls(sandbox);
    applyRunnerFirewall(sandbox.machine);
    expect(calls(sandbox)).toContain(`pfctl -a ${runnerFirewallAnchor} -f ${runnerFirewallRulesFile(sandbox.machine)}`);
  });

  it("turns pf on when it is off, so the anchor is enforced", () => {
    writeFileSync(join(sandbox.home, "pf-disabled"), "");
    applyRunnerFirewall(sandbox.machine);
    expect(calls(sandbox)).toContain("pfctl -E");
    expect(existsSync(join(sandbox.home, "pf-disabled"))).toBe(false);
  });

  it("retries a load that pf reports busy, as when another load of the anchor is in flight", () => {
    writeFileSync(join(sandbox.home, "pf-busy-once"), "");
    applyRunnerFirewall(sandbox.machine);
    expect(calls(sandbox).filter((call) => call === `pfctl -a ${runnerFirewallAnchor} -f ${runnerFirewallRulesFile(sandbox.machine)}`).length).toBeGreaterThanOrEqual(2);
    expect(checklistOf(sandbox)).toBe(`  ✓ ${hostOnlyLabel}\n`);
  });

  it("installs nothing when pfctl rejects the rules", () => {
    writeFileSync(join(sandbox.home, "pf-invalid"), "");
    expect(() => applyRunnerFirewall(sandbox.machine)).toThrow("pfctl rejected");
    expect(existsSync(runnerFirewallRulesFile(sandbox.machine))).toBe(false);
  });

  it("re-asserts the anchor from a root daemon at boot and every five minutes", () => {
    const daemon = runnerFirewallDaemon(sandbox.machine);
    expect(daemon).toContain("<string>dev.provision.runner-firewall</string>");
    expect(daemon).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(daemon).toContain("<key>StartInterval</key>\n  <integer>300</integer>");
    expect(daemon).toContain(`pfctl -a ${runnerFirewallAnchor} -f ${runnerFirewallRulesFile(sandbox.machine)} &amp;&amp; exit 0`);
    expect(daemon).toContain("|| pfctl -E;");
    expect(daemon).toContain("<string>/usr/bin:/bin:/usr/sbin:/sbin</string>");
  });

  it("shows in the checklist", () => {
    expect(checklistOf(sandbox)).toContain(`✗ ${hostOnlyLabel}`);
    applyRunnerFirewall(sandbox.machine);
    expect(checklistOf(sandbox)).toBe(`  ✓ ${hostOnlyLabel}\n`);
    rmSync(join(sandbox.home, "daemon-loaded"));
    expect(checklistOf(sandbox)).toContain(`✗ ${hostOnlyLabel}`);
  });
});
