import { changed, fail, say, unchanged } from "../../core/output";
import { output, sleep, type Machine } from "../../core/shell";
import type { SetupStep } from "../context";
import { answerPasswordPrompts } from "../credentials";

const loginWindowPreferences = "/Library/Preferences/com.apple.loginwindow";
const fileVaultOff = "FileVault is Off.";

export const fileVaultStatus = (machine: Machine) => output(machine, ["fdesetup", "status"]).split("\n")[0] ?? "";

export const autoLoginUser = (machine: Machine) => output(machine, ["defaults", "read", loginWindowPreferences, "autoLoginUser"]);

export const needsUnattendedBootPassword = (machine: Machine) =>
  fileVaultStatus(machine) !== fileVaultOff || autoLoginUser(machine) !== machine.user;

async function waitForDecryption(machine: Machine) {
  while (fileVaultStatus(machine) !== fileVaultOff) {
    say(machine, `waiting: ${output(machine, ["fdesetup", "status"]).replaceAll("\n", " ")}`);
    await sleep(30_000);
  }
}

export const unattendedBoot: SetupStep = {
  id: "unattended-boot",
  title: "Unattended boot",
  async apply({ machine }) {
    const status = fileVaultStatus(machine);
    if (status === fileVaultOff) unchanged(machine, "FileVault off");
    else if (status === "FileVault is On.") {
      answerPasswordPrompts(machine, ["sudo", "fdesetup", "disable"]);
      changed(machine, "FileVault turned off; decrypting");
      await waitForDecryption(machine);
    } else await waitForDecryption(machine);
    if (autoLoginUser(machine) === machine.user) {
      unchanged(machine, `logs in automatically as ${machine.user}`);
      return;
    }
    answerPasswordPrompts(machine, ["sudo", "sysadminctl", "-autologin", "set", "-userName", machine.user, "-password", "-"]);
    if (autoLoginUser(machine) !== machine.user) fail("automatic login was not set");
    changed(machine, `logs in automatically as ${machine.user}`);
  },
  check({ machine }, checklist) {
    if (fileVaultStatus(machine) === fileVaultOff) checklist.pass("FileVault off, so it boots without anyone typing a password");
    else checklist.miss("FileVault off", "rerun provision");
    if (autoLoginUser(machine) === machine.user) checklist.pass(`Logs in automatically as ${machine.user} after a restart`);
    else checklist.miss(`Logs in automatically as ${machine.user}`, "rerun provision");
  },
};
