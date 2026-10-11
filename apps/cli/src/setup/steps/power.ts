import { changed, say, unchanged } from "../../core/output";
import { sudo } from "../../core/shell";
import type { SetupStep } from "../context";
import { pmsetValue } from "../system";

const wantedPowerSettings: [string, string][] = [
  ["sleep", "0"],
  ["displaysleep", "0"],
  ["disksleep", "0"],
  ["standby", "0"],
  ["powernap", "0"],
  ["autorestart", "1"],
  ["womp", "1"],
  ["tcpkeepalive", "1"],
  ["disablesleep", "1"],
];

const restartsAfterFreeze = (output: string) => /: On$/m.test(output);

export const power: SetupStep = {
  id: "power",
  title: "Power and recovery",
  apply({ machine }) {
    for (const [key, value] of wantedPowerSettings) {
      const current = pmsetValue(machine, key);
      if (current === value) {
        unchanged(machine, `pmset ${key} = ${value}`);
        continue;
      }
      sudo(machine, ["pmset", "-a", key, value]);
      changed(machine, `pmset ${key} = ${value} (was ${current || "unset"})`);
    }
    if (restartsAfterFreeze(sudo(machine, ["systemsetup", "-getrestartfreeze"]).stdout)) unchanged(machine, "restart after a freeze");
    else if (sudo(machine, ["systemsetup", "-setrestartfreeze", "on"]).code === 0) changed(machine, "restart after a freeze");
    else say(machine, "skipped: restart after a freeze (systemsetup refused it)");
  },
  check({ machine }, checklist) {
    if (pmsetValue(machine, "sleep") === "0" && pmsetValue(machine, "disablesleep") === "1") checklist.pass("Never sleeps");
    else checklist.miss("Never sleeps", "sudo pmset -a sleep 0 disablesleep 1");
    if (pmsetValue(machine, "autorestart") === "1") checklist.pass("Starts up by itself after a power cut");
    else checklist.miss("Starts up by itself after a power cut", "sudo pmset -a autorestart 1");
    if (pmsetValue(machine, "womp") === "1") checklist.pass("Wakes for network access");
    else checklist.miss("Wakes for network access", "sudo pmset -a womp 1");
    if (restartsAfterFreeze(sudo(machine, ["systemsetup", "-getrestartfreeze"]).stdout)) checklist.pass("Restarts after a freeze");
    else checklist.note("Restart after a freeze could not be confirmed (systemsetup needs Full Disk Access for Terminal on this macOS)");
  },
};
