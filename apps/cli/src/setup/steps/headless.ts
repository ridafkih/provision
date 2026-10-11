import { changed, unchanged } from "../../core/output";
import { output, run } from "../../core/shell";
import type { SetupStep } from "../context";
import { ensureSystemBool, ensureUserDefault, systemDefaultValue } from "../system";

const bluetoothPreferences = "/Library/Preferences/com.apple.Bluetooth";

export const headless: SetupStep = {
  id: "headless",
  title: "Headless",
  apply({ machine }) {
    ensureSystemBool(machine, bluetoothPreferences, "BluetoothAutoSeekKeyboard", "0");
    ensureSystemBool(machine, bluetoothPreferences, "BluetoothAutoSeekPointingDevice", "0");
    ensureUserDefault(machine, "com.apple.CrashReporter", "DialogType", "-string", "none");
    if (output(machine, ["defaults", "-currentHost", "read", "com.apple.screensaver", "idleTime"]) === "0") {
      unchanged(machine, "screen saver never starts");
      return;
    }
    run(machine, ["defaults", "-currentHost", "write", "com.apple.screensaver", "idleTime", "-int", "0"]);
    changed(machine, "screen saver never starts");
  },
  check({ machine }, checklist) {
    const label = "No Bluetooth setup window when it boots without a keyboard or mouse";
    if (systemDefaultValue(machine, bluetoothPreferences, "BluetoothAutoSeekKeyboard") === "0") checklist.pass(label);
    else checklist.miss(label, "rerun provision");
    if (output(machine, ["defaults", "read", "com.apple.CrashReporter", "DialogType"]) === "none") checklist.pass("Crash dialogs never wait for a click");
    else checklist.miss("Crash dialogs never wait for a click", "defaults write com.apple.CrashReporter DialogType -string none");
    const displays = (run(machine, ["system_profiler", "SPDisplaysDataType"]).stdout.match(/Resolution:/g) ?? []).length;
    checklist.note(
      `Displays attached now: ${displays}. It boots and serves SSH and Screen Sharing with none; for GPU or full-resolution GUI work add a virtual display app or an HDMI dummy plug`,
    );
  },
};
