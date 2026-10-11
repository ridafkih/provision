import type { SetupStep } from "../context";
import { ensureSystemBool, systemDefaultValue } from "../system";

const softwareUpdateDomain = "/Library/Preferences/com.apple.SoftwareUpdate";
const wantedUpdateSettings: [string, "0" | "1"][] = [
  ["AutomaticCheckEnabled", "1"],
  ["AutomaticDownload", "1"],
  ["AutomaticallyInstallMacOSUpdates", "0"],
  ["ConfigDataInstall", "1"],
  ["CriticalUpdateInstall", "1"],
];

const label = "macOS updates download but never install or restart on their own";

export const updates: SetupStep = {
  id: "updates",
  title: "macOS updates",
  apply({ machine }) {
    for (const [key, value] of wantedUpdateSettings) ensureSystemBool(machine, softwareUpdateDomain, key, value);
  },
  check({ machine }, checklist) {
    const isSet = wantedUpdateSettings.every(([key, value]) => systemDefaultValue(machine, softwareUpdateDomain, key) === value);
    if (isSet) checklist.pass(label);
    else checklist.miss(label, "rerun provision");
  },
};
