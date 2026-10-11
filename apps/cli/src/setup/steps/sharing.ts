import { changed, say, unchanged } from "../../core/output";
import { output, run, sleep, succeeds, sudo, type Machine } from "../../core/shell";
import type { SetupStep } from "../context";
import { isDaemonLoaded, isListening, localHostName, startSystemDaemon } from "../system";

const screenSharingPlist = "/System/Library/LaunchDaemons/com.apple.screensharing.plist";
const natPreferences = "/Library/Preferences/SystemConfiguration/com.apple.nat";

const isRemoteManagementOn = (machine: Machine) => succeeds(machine, ["pgrep", "-xq", "ARDAgent"]) && isListening(machine, 3283);

const isInternetSharingOn = (machine: Machine) =>
  sudo(machine, ["defaults", "read", natPreferences, "NAT"]).stdout.match(/^\s*Enabled = (\d);/m)?.[1] === "1";

export const sharing: SetupStep = {
  id: "sharing",
  title: "Sharing",
  async apply({ machine }) {
    if (isDaemonLoaded(machine, "com.apple.smbd")) {
      sudo(machine, ["launchctl", "disable", "system/com.apple.smbd"]);
      sudo(machine, ["launchctl", "bootout", "system/com.apple.smbd"]);
      changed(machine, "file sharing (SMB) off");
    } else unchanged(machine, "file sharing (SMB) off");
    if (/^_share_printers=1/m.test(output(machine, ["cupsctl"]))) {
      run(machine, ["cupsctl", "--no-share-printers"]);
      changed(machine, "printer sharing off");
    } else unchanged(machine, "printer sharing off");
    if (isInternetSharingOn(machine)) {
      sudo(machine, ["defaults", "write", natPreferences, "NAT", "-dict-add", "Enabled", "-int", "0"]);
      changed(machine, "internet sharing off");
    } else unchanged(machine, "internet sharing off");
    if (isRemoteManagementOn(machine)) {
      sudo(machine, [machine.paths.remoteManagementKickstart, "-deactivate", "-configure", "-access", "-off"]);
      changed(machine, "Remote Management off");
    } else unchanged(machine, "Remote Management off");
    if (isListening(machine, 5900)) {
      unchanged(machine, "Screen Sharing on");
      return;
    }
    startSystemDaemon(machine, "com.apple.screensharing", screenSharingPlist);
    await sleep(2000);
    if (isListening(machine, 5900)) changed(machine, "Screen Sharing on");
    else say(machine, "skipped: Screen Sharing did not start from the command line");
  },
  check({ machine }, checklist) {
    if (isListening(machine, 5900)) checklist.pass(`Screen Sharing on (vnc://${localHostName(machine)}.local)`);
    else checklist.waitingOnOwner("Screen Sharing on", "System Settings > General > Sharing > Screen Sharing");
    if (isRemoteManagementOn(machine)) checklist.miss("Remote Management off", "System Settings > General > Sharing > Remote Management off");
    else checklist.pass("Remote Management off");
    if (isDaemonLoaded(machine, "com.apple.smbd")) checklist.miss("File sharing off", "System Settings > General > Sharing > File Sharing off");
    else checklist.pass("File, printer and internet sharing off");
  },
};
