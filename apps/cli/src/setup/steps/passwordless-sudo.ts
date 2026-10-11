import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changed, fail, say, unchanged } from "../../core/output";
import { run, sudo, type Machine } from "../../core/shell";
import type { SetupStep } from "../context";

export const sudoersFile = (machine: Machine) => join(machine.paths.sudoersDirectory, `provision-${machine.user.replaceAll(/[^A-Za-z0-9_-]/g, "_")}`);

export const sudoersRule = (user: string) => `${user} ALL=(ALL) NOPASSWD: ALL\n`;

export const grantsPasswordlessSudo = (sudoList: string) => /\(ALL(\s*:\s*ALL)?\)\s+NOPASSWD:\s*ALL\s*$/m.test(sudoList);

const hasPasswordlessSudo = (machine: Machine) => {
  const listing = sudo(machine, ["-l"]);
  return listing.code === 0 && grantsPasswordlessSudo(listing.stdout);
};

const label = (machine: Machine) => `Passwordless sudo for ${machine.user}`;

export const passwordlessSudo: SetupStep = {
  id: "passwordless-sudo",
  title: "Passwordless sudo",
  apply({ machine, options }) {
    if (options.isPasswordlessSudoSkipped) return say(machine, "skipped: --no-passwordless-sudo");
    if (hasPasswordlessSudo(machine)) return unchanged(machine, label(machine));
    const directory = mkdtempSync(join(tmpdir(), "provision-sudoers-"));
    const candidate = join(directory, "rule");
    try {
      writeFileSync(candidate, sudoersRule(machine.user), { mode: 0o600 });
      if (run(machine, ["visudo", "-cf", candidate]).code !== 0) fail(`visudo rejected the sudoers rule for ${machine.user}`);
      const target = sudoersFile(machine);
      if (sudo(machine, ["install", "-m", "0440", "-o", "root", "-g", "wheel", candidate, target]).code !== 0) fail(`could not install ${target}`);
      if (sudo(machine, ["visudo", "-c"]).code !== 0) {
        sudo(machine, ["rm", "-f", target]);
        fail(`sudo's configuration did not validate with ${target}, so it was removed`);
      }
      changed(machine, `${label(machine)} (${target})`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  check({ machine, options }, checklist) {
    if (options.isPasswordlessSudoSkipped) return checklist.note(`Passwordless sudo skipped (--no-passwordless-sudo)`);
    if (hasPasswordlessSudo(machine)) checklist.pass(label(machine));
    else checklist.miss(label(machine), "rerun provision");
  },
};
