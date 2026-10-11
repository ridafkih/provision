import { accessSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { changed, fail, unchanged } from "../core/output";
import { output, sudo, type Machine } from "../core/shell";

export const provisionHome = (machine: Machine) => join(machine.home, ".provision");
export const installedBinary = (machine: Machine) => join(provisionHome(machine), "bin/provision");
export const installedKit = (machine: Machine) => join(provisionHome(machine), "kit");

const isOwnedAndWritable = (path: string, uid: number): boolean => {
  try {
    const stats = statSync(path);
    if (stats.uid !== uid || (stats.mode & 0o200) === 0) return false;
    if (!stats.isDirectory()) return true;
    accessSync(path, constants.R_OK | constants.X_OK);
    return readdirSync(path).every((name) => isOwnedAndWritable(join(path, name), uid));
  } catch {
    return false;
  }
};

export const hasForeignFilesInProvisionHome = (machine: Machine) =>
  existsSync(provisionHome(machine)) && !isOwnedAndWritable(provisionHome(machine), Number(output(machine, ["id", "-u"])));

export function repairProvisionHome(machine: Machine) {
  const home = provisionHome(machine);
  if (hasForeignFilesInProvisionHome(machine)) {
    sudo(machine, ["chown", "-R", `${machine.user}:staff`, home]);
    sudo(machine, ["chmod", "-R", "u+rwX", home]);
    changed(machine, `gave ${home} back to ${machine.user}`);
  }
  mkdirSync(home, { recursive: true, mode: 0o700 });
  chmodSync(home, 0o700);
  try {
    accessSync(home, constants.W_OK);
  } catch {
    fail(`${home} is still not writable by ${machine.user}`);
  }
}

export function installBinary(machine: Machine, runningBinary: string) {
  const target = installedBinary(machine);
  if (runningBinary === target) {
    unchanged(machine, `provision binary at ${target}`);
    return;
  }
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  copyFileSync(runningBinary, `${target}.next`);
  chmodSync(`${target}.next`, 0o755);
  renameSync(`${target}.next`, target);
  changed(machine, `provision binary at ${target}`);
}
