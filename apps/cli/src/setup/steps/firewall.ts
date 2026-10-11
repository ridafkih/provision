import { changed, unchanged } from "../../core/output";
import { output, sudo, type Machine } from "../../core/shell";
import type { SetupStep } from "../context";

const switches: [string, string, string][] = [
  ["--getglobalstate", "--setglobalstate", "application firewall"],
  ["--getstealthmode", "--setstealthmode", "stealth mode"],
  ["--getallowsigned", "--setallowsigned", "automatic allow for signed software"],
];

const query = (machine: Machine, flag: string) => output(machine, [machine.paths.socketFilter, flag]);

export const firewall: SetupStep = {
  id: "firewall",
  title: "Firewall",
  apply({ machine }) {
    for (const [getter, setter, description] of switches) {
      if (/enabled|is on|State = 1/i.test(query(machine, getter))) {
        unchanged(machine, `${description} on`);
        continue;
      }
      sudo(machine, [machine.paths.socketFilter, setter, "on"]);
      changed(machine, `${description} on`);
    }
  },
  check({ machine }, checklist) {
    const isOn = /State = 1/.test(query(machine, "--getglobalstate")) && /is on/i.test(query(machine, "--getstealthmode"));
    if (isOn) checklist.pass("Firewall and stealth mode on");
    else checklist.miss("Firewall and stealth mode on", "rerun provision");
  },
};
