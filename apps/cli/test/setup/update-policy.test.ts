import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createChecklist, renderChecklist } from "../../src/core/checklist";
import { softwareUpdateDomain, softwareUpdatePolicy } from "../../src/core/software-update";
import { updates } from "../../src/setup/steps/updates";
import { TASKS } from "../../src/slim/catalog";
import type { Env } from "../../src/slim/task";
import { addFakeCommand, createSandbox, disposeSandbox, setupOf, type Sandbox } from "../sandbox";

const policyAsDefaults = Object.entries(softwareUpdatePolicy)
  .map(([key, value]) => `*" ${key}") echo ${value ? 1 : 0} ;;`)
  .join("\n");

const slimUpdates = TASKS.find((task) => task.id === "updates")!;

describe("the macOS update policy", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = createSandbox();
    addFakeCommand(sandbox, "defaults", `case "$*" in\n${policyAsDefaults}\n*"commerce AutoUpdate") echo 0 ;;\n*) exit 1 ;;\nesac`);
    addFakeCommand(sandbox, "sudo", "exit 1");
  });
  afterEach(() => disposeSandbox(sandbox));

  it("reads automatic checking from softwareupdate, since macOS 27 drops the AutomaticCheckEnabled key", () => {
    addFakeCommand(sandbox, "softwareupdate", 'echo "Automatic checking for updates is turned on"');
    const checklist = createChecklist();
    updates.check?.(setupOf(sandbox), checklist);
    expect(renderChecklist(checklist)).toBe("  ✓ macOS updates download but never install or restart on their own\n");
  });

  it("fails the check while automatic checking is off", () => {
    addFakeCommand(sandbox, "softwareupdate", 'echo "Automatic checking for updates is turned off"');
    const checklist = createChecklist();
    updates.check?.(setupOf(sandbox), checklist);
    expect(renderChecklist(checklist)).toContain("✗ macOS updates");
  });

  it("is what slimming wants too, so both are done on a Mac that has it", async () => {
    const environment = {
      exec: async ({ argv }: { argv: string[] }) => {
        const key = argv.at(-1)!;
        const domain = argv.at(-2)!;
        const value = domain === softwareUpdateDomain ? softwareUpdatePolicy[key] : domain.endsWith("commerce") ? false : undefined;
        return value === undefined ? { code: 1, stdout: "", stderr: "" } : { code: 0, stdout: value ? "1\n" : "0\n", stderr: "" };
      },
    } as unknown as Env;
    const inspection = await slimUpdates.inspect(environment);
    expect(inspection.state).toBe("done");
    expect(inspection.items.map((item) => item.name)).not.toContain("com.apple.SoftwareUpdate AutomaticCheckEnabled");
  });
});
