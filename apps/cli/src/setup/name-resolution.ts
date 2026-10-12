import { existsSync } from "node:fs";
import { changed, fail } from "../core/output";
import { run, sleep, sudo, type Machine } from "../core/shell";
import { loadedTailscaleDaemon } from "./tailscale-daemon";

const nameResolutionProbe = "github.com";

const canResolveNames = (machine: Machine) =>
  /^ip_address:/m.test(run(machine, ["dscacheutil", "-q", "host", "-a", "name", nameResolutionProbe]).stdout);

async function flushNameCache(machine: Machine) {
  sudo(machine, ["dscacheutil", "-flushcache"]);
  sudo(machine, ["killall", "-HUP", "mDNSResponder"]);
  await sleep(1000);
}

async function repairNameResolution(machine: Machine) {
  if (canResolveNames(machine)) return true;
  const tailscale = machine.paths.homebrewTailscale;
  const repairs: [string, () => void][] = [
    ["flushed a stale DNS cache", () => {}],
    ["stopped Tailscale from taking over DNS", () => sudo(machine, [tailscale, "set", "--accept-dns=false"])],
    ["took Tailscale down until sign-in, so DNS works again", () => sudo(machine, [tailscale, "down"])],
    [
      "stopped tailscaled until sign-in, so DNS works again",
      () => {
        const label = loadedTailscaleDaemon(machine);
        if (label) sudo(machine, ["launchctl", "bootout", `system/${label}`]);
      },
    ],
  ];
  for (const [index, [description, repair]] of repairs.entries()) {
    if (index > 0 && !existsSync(tailscale)) return false;
    repair();
    await flushNameCache(machine);
    if (canResolveNames(machine)) {
      changed(machine, description);
      return true;
    }
  }
  return false;
}

export async function requireNameResolution(machine: Machine, when: string) {
  if (await repairNameResolution(machine)) return;
  fail(`this Mac can't look up ${nameResolutionProbe} ${when}. Check the network cable or Wi-Fi, then run the same command again.`);
}
