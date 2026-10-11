import { isAutomaticCheckOn, softwareUpdateDomain, softwareUpdatePolicy } from "../../core/software-update";
import { changed, unchanged } from "../../core/output";
import { run, sudo, type Machine } from "../../core/shell";
import type { SetupStep } from "../context";
import { ensureSystemBool, systemDefaultValue } from "../system";

const wantedUpdateSettings = Object.entries(softwareUpdatePolicy).map(([key, value]) => [key, value ? "1" : "0"] as const);

const label = "macOS updates download but never install or restart on their own";

const readsAutomaticCheckOn = (machine: Machine) => {
  const schedule = run(machine, ["softwareupdate", "--schedule"]);
  return isAutomaticCheckOn(schedule.stdout + schedule.stderr);
};

export const updates: SetupStep = {
  id: "updates",
  title: "macOS updates",
  apply({ machine }) {
    if (readsAutomaticCheckOn(machine)) unchanged(machine, "checks for updates automatically");
    else {
      sudo(machine, ["softwareupdate", "--schedule", "on"]);
      changed(machine, "checks for updates automatically");
    }
    for (const [key, value] of wantedUpdateSettings) ensureSystemBool(machine, softwareUpdateDomain, key, value);
  },
  check({ machine }, checklist) {
    const isSet = readsAutomaticCheckOn(machine) && wantedUpdateSettings.every(([key, value]) => systemDefaultValue(machine, softwareUpdateDomain, key) === value);
    if (isSet) checklist.pass(label);
    else checklist.miss(label, "rerun provision");
  },
};
