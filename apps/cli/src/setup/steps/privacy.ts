import { changed, unchanged } from "../../core/output";
import { output, run, sudo } from "../../core/shell";
import type { SetupStep } from "../context";
import { ensureSystemBool } from "../system";

const diagnosticsPreferences = "/Library/Application Support/CrashReporter/DiagnosticMessagesHistory.plist";

const isSpotlightOff = (text: string) => /Indexing disabled/.test(text);

export const privacy: SetupStep = {
  id: "privacy",
  title: "Privacy and Spotlight",
  apply({ machine }) {
    const guest = run(machine, ["sysadminctl", "-guestAccount", "status"]);
    if (/Guest account disabled/.test(guest.stdout + guest.stderr)) unchanged(machine, "guest account off");
    else {
      sudo(machine, ["sysadminctl", "-guestAccount", "off"]);
      changed(machine, "guest account off");
    }
    ensureSystemBool(machine, diagnosticsPreferences, "AutoSubmit", "0");
    ensureSystemBool(machine, diagnosticsPreferences, "ThirdPartyDataSubmit", "0");
    if (isSpotlightOff(output(machine, ["mdutil", "-s", "/"]))) unchanged(machine, "Spotlight indexing off");
    else {
      sudo(machine, ["mdutil", "-a", "-i", "off"]);
      changed(machine, "Spotlight indexing off on every volume");
    }
  },
  check({ machine }, checklist) {
    if (isSpotlightOff(output(machine, ["mdutil", "-s", "/"]))) checklist.pass("Spotlight indexing off");
    else checklist.miss("Spotlight indexing off", "sudo mdutil -a -i off");
  },
};
