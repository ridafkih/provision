import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { appliedProfile, expectedSlimProfile, slim, slimProfileFor, slimStateOf, unconfirmedRemoteAccess } from "../../src/setup/steps/slim";
import type { Context } from "../../src/slim/context";
import type { Journal } from "../../src/slim/journal";
import type { Inspection, Task } from "../../src/slim/task";
import { addFakeCommand, addFakeSudo, createSandbox, disposeSandbox, printedText, setupOf, type Sandbox } from "../sandbox";

describe("the slim step", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = createSandbox();
    addFakeSudo(sandbox);
    addFakeCommand(sandbox, "lsof", "exit 1");
    addFakeCommand(sandbox, "nc", "exit 1");
    addFakeCommand(sandbox, "fdesetup", 'echo "FileVault is On."');
    addFakeCommand(sandbox, "defaults", "exit 1");
  });
  afterEach(() => disposeSandbox(sandbox));

  it("slims VM hosts to the host profile and every other Mac to the lean one", () => {
    expect(slimProfileFor(setupOf(sandbox, ["--role", "runner", "--runner-repo", "o/r"]))).toBe("host");
    expect(slimProfileFor(setupOf(sandbox, ["--role", "worker"]))).toBe("host");
    expect(slimProfileFor(setupOf(sandbox))).toBe("lean");
  });

  it("does nothing with --no-slim", async () => {
    await slim.apply(setupOf(sandbox, ["--no-slim"]));
    expect(printedText(sandbox)).toBe("skipped: --no-slim");
  });

  it("waits until SSH, unattended boot and Tailscale are confirmed", async () => {
    expect(unconfirmedRemoteAccess(sandbox.machine)).toEqual([
      "SSH is not listening",
      "FileVault is not off",
      "automatic login is not set to rack",
      "this Mac is not on the tailnet",
    ]);
    await slim.apply(setupOf(sandbox));
    expect(printedText(sandbox)).toStartWith("skipped: slimming waits until remote access is confirmed");
  });
});

const task = (id: string, tier: "lean" | "host") => ({ id, tier, needs: { sipOff: true }, group: "host", title: id, summary: "", inspect: async () => ({ state: "done", items: [], apply: [], undo: [] }) }) as unknown as Task;

describe("slim state in the checklist", () => {
  it("counts a task by its state, not by the cleanup steps a disabled but still running job leaves", () => {
    const tasks = [task("telemetry", "lean"), task("siri", "lean"), task("dock", "host")];
    const inspections = new Map<string, Inspection>([
      ["telemetry", { state: "done", items: [], apply: [{ argv: ["launchctl", "bootout", "system/x"] }], undo: [] }],
      ["siri", { state: "todo", items: [], apply: [{ argv: ["launchctl", "disable", "gui/501/y"] }], undo: [] }],
      ["dock", { state: "partial", items: [], apply: [{ argv: ["launchctl", "disable", "gui/501/z"] }], undo: [] }],
    ]);
    expect(slimStateOf(tasks, inspections, { sip: false } as Context)).toEqual({ pending: ["siri", "dock"], waitingForSip: [] });
    expect(slimStateOf(tasks, inspections, { sip: true } as Context)).toEqual({ pending: [], waitingForSip: ["siri", "dock"] });
  });

  it("expects the host profile on a Mac with no role once the host profile was applied", () => {
    const sandbox = createSandbox();
    const journal: Journal = { version: 1, entries: [{ task: "telemetry", at: "", macos: "", undo: [] }, { task: "dock", at: "", macos: "", undo: [] }] };
    expect(appliedProfile(journal)).toBe("host");
    expect(expectedSlimProfile(setupOf(sandbox), journal)).toBe("host");
    expect(expectedSlimProfile(setupOf(sandbox), { version: 1, entries: [{ task: "telemetry", at: "", macos: "", undo: [] }] })).toBe("lean");
    expect(expectedSlimProfile(setupOf(sandbox), { version: 1, entries: [{ task: "dock", at: "", macos: "", undo: [], restoredAt: "x" }] })).toBe("lean");
    disposeSandbox(sandbox);
  });
});
