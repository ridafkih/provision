import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addVm,
  createSandbox,
  disposeSandbox,
  execStdin,
  hasVm,
  jitConfig,
  runKitScript,
  runnerConfigDirectory,
  type Sandbox,
  tartCalls,
  writeConfig,
} from "./runner-sandbox.ts";

const runSlot = (sandbox: Sandbox, slot: string, jobSeconds: string) =>
  runKitScript(sandbox, "bin/run-slot.sh", [slot], jobSeconds);

describe("run-slot.sh", { timeout: 20_000 }, () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await createSandbox();
  });

  afterEach(() => disposeSandbox(sandbox));

  it("runs one just-in-time runner in a fresh isolated clone and deletes the clone afterwards", async () => {
    addVm(sandbox, "runner-linux");
    const { status, output } = await runSlot(sandbox, "1", "0");
    expect({ status, output }).toMatchObject({ status: 0 });
    const calls = tartCalls(sandbox);
    expect(calls).toContain("clone runner-linux rack-runner-slot-1");
    expect(calls).toContain("set rack-runner-slot-1 --random-mac");
    expect(calls).toContain("run --no-graphics --net-softnet rack-runner-slot-1");
    expect(calls.at(-1)).toBe("delete rack-runner-slot-1");
    expect(hasVm(sandbox, "rack-runner-slot-1")).toBe(false);
    expect(hasVm(sandbox, "runner-linux")).toBe(true);
  });

  it("asks GitHub for a single-use runner with the app labels", async () => {
    addVm(sandbox, "runner-linux");
    await runSlot(sandbox, "1", "0");
    const jitRequest = sandbox.requests.find((request) => request.method === "POST");
    const body = JSON.parse(jitRequest?.body ?? "{}") as { name: string; labels: string[]; runner_group_id: number };
    expect(body.labels).toEqual(["self-hosted", "Linux", "ARM64", "app"]);
    expect(body.runner_group_id).toBe(1);
    expect(body.name).toMatch(/^rack-runner-1-\d+$/);
  });

  it("hands the runner its config on stdin, never on a command line", async () => {
    addVm(sandbox, "runner-linux");
    await runSlot(sandbox, "1", "0");
    expect(execStdin(sandbox)).toBe(`${jitConfig}\n`);
    expect(tartCalls(sandbox).some((call) => call.includes(jitConfig))).toBe(false);
  });

  it("removes only this slot's offline runners", async () => {
    addVm(sandbox, "runner-linux");
    await runSlot(sandbox, "1", "0");
    const deleted = sandbox.requests.filter((request) => request.method === "DELETE").map((request) => request.path);
    expect(deleted).toEqual(["/repos/example/app/actions/runners/11"]);
  });

  it("discards a clone left behind by a crashed cycle before starting", async () => {
    addVm(sandbox, "runner-linux");
    addVm(sandbox, "rack-runner-slot-1");
    await runSlot(sandbox, "1", "0");
    const calls = tartCalls(sandbox);
    expect(calls.indexOf("delete rack-runner-slot-1")).toBeLessThan(calls.indexOf("clone runner-linux rack-runner-slot-1"));
  });

  it("backs off without registering a runner until the golden image exists", async () => {
    const { status, output } = await runSlot(sandbox, "1", "0");
    expect(status).toBe(1);
    expect(output).toContain("no runner-linux image yet");
    expect(sandbox.requests.some((request) => request.method === "POST")).toBe(false);
    expect(tartCalls(sandbox).some((call) => call.startsWith("clone"))).toBe(false);
  });

  it("stops a runner that outlives its lifetime and still deletes the clone", async () => {
    addVm(sandbox, "runner-linux");
    writeConfig(sandbox, { RUNNER_LIFETIME_SECONDS: "1" });
    const { output } = await runSlot(sandbox, "2", "60");
    expect(output).toContain("reached its 1 second lifetime");
    expect(tartCalls(sandbox).at(-1)).toBe("delete rack-runner-slot-2");
  });

  it("refuses to start with a config key missing and names it", async () => {
    addVm(sandbox, "runner-linux");
    writeConfig(sandbox, { LINUX_GOLDEN_VM: "" });
    const { status, output } = await runSlot(sandbox, "1", "0");
    expect(status).toBe(1);
    expect(output).toContain("is missing: LINUX_GOLDEN_VM");
    expect(tartCalls(sandbox)).toEqual([]);
  });

  it("waits for the GitHub token without touching GitHub or Tart", async () => {
    addVm(sandbox, "runner-linux");
    writeFileSync(join(runnerConfigDirectory(sandbox), "credentials.env"), "\n");
    const { status, output } = await runSlot(sandbox, "1", "0");
    expect(status).toBe(1);
    expect(output).toContain("no GITHUB_RUNNER_TOKEN");
    expect(sandbox.requests).toEqual([]);
    expect(tartCalls(sandbox).filter((call) => !call.startsWith("get"))).toEqual([]);
  });
});
