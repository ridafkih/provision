import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Checklist } from "../../core/checklist";
import { changed, fail, unchanged } from "../../core/output";
import { succeeds, sudo, type Machine } from "../../core/shell";

export const runnerFirewallAnchor = "com.apple/300.provision-runner";
const daemonLabel = "dev.provision.runner-firewall";
const description = "Runner VMs reach the host only for DHCP and DNS";

const vmBridges = Array.from({ length: 64 }, (_, index) => `bridge${100 + index}`);

const hostSideRanges = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "169.254.0.0/16", "127.0.0.0/8", "224.0.0.0/4", "255.255.255.255/32"];

const rulesWithLabel = (label: string) =>
  [
    `vm_bridges = "{ ${vmBridges.join(" ")} }"`,
    `table <runner_host_side> const { ${hostSideRanges.join(", ")} }`,
    "pass in quick on $vm_bridges inet proto udp from any port 68 to any port 67",
    "pass in quick on $vm_bridges inet proto { udp, tcp } from any to <runner_host_side> port 53",
    `block return in quick on $vm_bridges inet from any to <runner_host_side>${label}`,
    `block return in quick on $vm_bridges inet6 proto { tcp, udp } from any to any${label}`,
    "",
  ].join("\n");

const rulesLabel = () => `provision-runner-${createHash("sha256").update(rulesWithLabel("")).digest("hex").slice(0, 12)}`;

export const runnerFirewallRules = () => rulesWithLabel(` label "${rulesLabel()}"`);

export const runnerFirewallRulesFile = (machine: Machine) => join(machine.paths.pfAnchorsDirectory, "provision-runner");

export const runnerFirewallDaemonFile = (machine: Machine) => join(machine.paths.launchDaemonsDirectory, `${daemonLabel}.plist`);

export const runnerFirewallLoadScript = (machine: Machine) =>
  `pfctl -s info 2>/dev/null | grep -q '^Status: Enabled' || pfctl -E; for attempt in 1 2 3 4 5; do pfctl -a ${runnerFirewallAnchor} -f ${runnerFirewallRulesFile(machine)} && exit 0; sleep 1; done; exit 1`;

const escapeXml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export const runnerFirewallDaemon = (machine: Machine) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${daemonLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>${escapeXml(runnerFirewallLoadScript(machine))}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>300</integer>
</dict>
</plist>
`;

const readIfPresent = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : undefined);

const withCandidate = <T>(contents: string, use: (candidate: string) => T) => {
  const directory = mkdtempSync(join(tmpdir(), "provision-runner-firewall-"));
  const candidate = join(directory, "candidate");
  try {
    writeFileSync(candidate, contents);
    return use(candidate);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

function installRootFile(machine: Machine, target: string, contents: string, validate?: (candidate: string) => void) {
  if (readIfPresent(target) === contents) return false;
  withCandidate(contents, (candidate) => {
    validate?.(candidate);
    if (sudo(machine, ["install", "-m", "0644", "-o", "root", "-g", "wheel", candidate, target]).code !== 0) fail(`could not install ${target}`);
  });
  return true;
}

const validateRules = (machine: Machine) => (candidate: string) => {
  if (sudo(machine, ["pfctl", "-n", "-a", runnerFirewallAnchor, "-f", candidate]).code !== 0) fail("pfctl rejected the runner firewall rules");
};

const daemonTarget = `system/${daemonLabel}`;

const isDaemonLoaded = (machine: Machine) => succeeds(machine, ["sudo", "-n", "launchctl", "print", daemonTarget]);

const isPfEnabled = (machine: Machine) => /^Status: Enabled/m.test(sudo(machine, ["pfctl", "-s", "info"]).stdout);

const isAnchorCurrent = (machine: Machine) => sudo(machine, ["pfctl", "-a", runnerFirewallAnchor, "-s", "rules"]).stdout.includes(`label "${rulesLabel()}"`);

const enforcementWaitMilliseconds = 20_000;

const isEnforced = (machine: Machine) => isPfEnabled(machine) && isAnchorCurrent(machine);

function waitUntilEnforced(machine: Machine) {
  const deadline = Date.now() + enforcementWaitMilliseconds;
  while (!isEnforced(machine)) {
    if (Date.now() > deadline) fail(`${daemonLabel} did not load ${runnerFirewallAnchor}`);
    Bun.sleepSync(250);
  }
}

export function applyRunnerFirewall(machine: Machine) {
  const daemonFile = runnerFirewallDaemonFile(machine);
  const isRulesChanged = installRootFile(machine, runnerFirewallRulesFile(machine), runnerFirewallRules(), validateRules(machine));
  const isDaemonChanged = installRootFile(machine, daemonFile, runnerFirewallDaemon(machine));
  const isDaemonReloaded = isDaemonChanged || !isDaemonLoaded(machine);
  if (isDaemonReloaded) {
    sudo(machine, ["launchctl", "bootout", daemonTarget]);
    if (sudo(machine, ["launchctl", "bootstrap", "system", daemonFile]).code !== 0) fail(`launchctl could not load ${daemonLabel}`);
  }
  const isAnchorReloaded = isRulesChanged || !isEnforced(machine);
  if (isAnchorReloaded) {
    if (sudo(machine, ["launchctl", "kickstart", "-k", daemonTarget]).code !== 0) fail(`launchctl could not start ${daemonLabel}`);
    waitUntilEnforced(machine);
  }
  if (isRulesChanged || isDaemonReloaded || isAnchorReloaded) changed(machine, `${description} (pf anchor ${runnerFirewallAnchor})`);
  else unchanged(machine, description);
}

export function checkRunnerFirewall(machine: Machine, checklist: Checklist) {
  const isInPlace =
    readIfPresent(runnerFirewallRulesFile(machine)) === runnerFirewallRules() &&
    readIfPresent(runnerFirewallDaemonFile(machine)) === runnerFirewallDaemon(machine) &&
    isDaemonLoaded(machine) &&
    isEnforced(machine);
  if (isInPlace) checklist.pass(description);
  else checklist.miss(description, "rerun provision --role runner");
}
