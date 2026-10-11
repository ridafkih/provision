import { existsSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { changed, unchanged } from "../../core/output";
import { succeeds, sudo, type Machine } from "../../core/shell";
import type { Setup } from "../context";
import { ensureFormula } from "../steps/homebrew";
import type { Checklist } from "../../core/checklist";

const homebrewBin = (machine: Machine) => join(machine.paths.brew, "..");

const softnetBinary = (machine: Machine) => {
  const link = join(homebrewBin(machine), "softnet");
  return existsSync(link) ? realpathSync(link) : link;
};

const isSoftnetSetuidRoot = (machine: Machine) => {
  const binary = softnetBinary(machine);
  if (!existsSync(binary)) return false;
  const stats = statSync(binary);
  return (stats.mode & 0o4000) !== 0 && stats.uid === 0;
};

const softnetDescription = "softnet runs set-uid root, so Tart can isolate VM networks without sudo";

export function applyWorkerRole({ machine }: Setup) {
  ensureFormula(machine, "openai/tools/tart");
  ensureFormula(machine, "openai/tools/softnet");
  if (isSoftnetSetuidRoot(machine)) {
    unchanged(machine, softnetDescription);
    return;
  }
  sudo(machine, ["chown", "root:wheel", softnetBinary(machine)]);
  sudo(machine, ["chmod", "4755", softnetBinary(machine)]);
  changed(machine, softnetDescription);
}

export function checkWorkerRole({ machine }: Setup, checklist: Checklist) {
  if (succeeds(machine, [join(homebrewBin(machine), "tart"), "--version"]) && isSoftnetSetuidRoot(machine)) checklist.pass("VM host: Tart and Softnet ready");
  else checklist.miss("VM host: Tart and Softnet ready", "rerun provision (a Homebrew upgrade of softnet clears its set-uid bit)");
  if (existsSync(join(machine.home, "Library/Keychains/login.keychain-db"))) checklist.pass("Login keychain exists, so headless VMs can start");
  else checklist.waitingOnOwner("Login keychain exists", "log in to the desktop once (Screen Sharing works)");
}
