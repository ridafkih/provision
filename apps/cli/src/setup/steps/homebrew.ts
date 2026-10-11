import { existsSync } from "node:fs";
import { changed, fail, unchanged } from "../../core/output";
import { run, succeeds, type Machine } from "../../core/shell";
import type { SetupStep } from "../context";

export function ensureFormula(machine: Machine, formula: string) {
  const name = formula.split("/").pop()!;
  if (succeeds(machine, [machine.paths.brew, "list", "--formula", name])) {
    unchanged(machine, `${formula} installed`);
    return;
  }
  if (run(machine, [machine.paths.brew, "install", "--quiet", formula], { isInteractive: true }).code !== 0) fail(`brew could not install ${formula}`);
  changed(machine, `${formula} installed`);
}

export const homebrew: SetupStep = {
  id: "homebrew",
  title: "Homebrew",
  apply({ machine }) {
    if (existsSync(machine.paths.brew)) {
      unchanged(machine, "Homebrew installed");
      return;
    }
    const installer = run(machine, ["curl", "-fsSL", "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh"]);
    if (installer.code !== 0) fail("could not download the Homebrew installer");
    const result = run(machine, ["/bin/bash", "-c", installer.stdout], { environment: { NONINTERACTIVE: "1" }, isInteractive: true });
    if (result.code !== 0) fail("the Homebrew installer failed");
    changed(machine, "Homebrew installed");
  },
  check({ machine }, checklist) {
    if (existsSync(machine.paths.brew)) checklist.pass("Homebrew installed");
    else checklist.miss("Homebrew installed", "rerun provision");
  },
};
