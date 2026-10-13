import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  addVm,
  crashVm,
  createSandbox,
  disposeSandbox,
  execStdin,
  fakeRepository,
  hasVm,
  jitConfig,
  runKitScript,
  runnerConfigDirectory,
  type Sandbox,
  tartCalls,
  wedgeGuest,
  writeConfig,
} from "./runner-sandbox.ts";

const runSlot = (sandbox: Sandbox, pool: string, slot: string, jobSeconds: string) =>
  runKitScript(sandbox, "bin/run-slot.sh", [pool, slot], jobSeconds);

const macosConfig = {
  MACOS_SLOTS: "1",
  MACOS_BASE_IMAGE: "ghcr.io/cirruslabs/macos-tahoe-xcode:26.5",
  MACOS_GOLDEN_VM: "runner-macos",
  MACOS_RUNNER_LABELS: "self-hosted,macOS,ARM64,app-swift",
  MACOS_VM_MEMORY_MB: "6144",
  MACOS_PULL_FREE_GB: "1",
};

const registrations = (sandbox: Sandbox) =>
  sandbox.requests
    .filter((request) => request.method === "POST")
    .map((request) => ({ path: request.path, labels: (JSON.parse(request.body) as { labels: string[] }).labels }));
const whenRegistered = (sandbox: Sandbox, repository: string, then: () => void) => {
  const poll = setInterval(() => {
    const runner = sandbox.github.repositories[repository]?.runners.find((each) => each.id === 900);
    if (!runner) return;
    clearInterval(poll);
    runner.status = "online";
    then();
  }, 50);
};

describe("run-slot.sh", () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await createSandbox();
  });

  afterEach(() => disposeSandbox(sandbox));

  it("runs one just-in-time runner in a fresh isolated clone and deletes the clone afterwards", async () => {
    addVm(sandbox, "runner-linux");
    const { status, output } = await runSlot(sandbox, "linux", "1", "0");
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
    await runSlot(sandbox, "linux", "1", "0");
    const jitRequest = sandbox.requests.find((request) => request.method === "POST");
    const body = JSON.parse(jitRequest?.body ?? "{}") as { name: string; labels: string[]; runner_group_id: number };
    expect(body.labels).toEqual(["self-hosted", "Linux", "ARM64", "app"]);
    expect(body.runner_group_id).toBe(1);
    expect(body.name).toMatch(/^rack-runner-1-\d+$/);
  });

  it("runs without shell errors", async () => {
    addVm(sandbox, "runner-linux");
    const { output } = await runSlot(sandbox, "linux", "1", "0");
    expect(output).not.toContain("readonly variable");
  });

  it("hands the runner its config on stdin, never on a command line", async () => {
    addVm(sandbox, "runner-linux");
    await runSlot(sandbox, "linux", "1", "0");
    expect(execStdin(sandbox)).toBe(`${jitConfig}\n`);
    expect(tartCalls(sandbox).some((call) => call.includes(jitConfig))).toBe(false);
  });

  it("removes only this slot's offline runners", async () => {
    addVm(sandbox, "runner-linux");
    await runSlot(sandbox, "linux", "1", "0");
    const deleted = sandbox.requests.filter((request) => request.method === "DELETE").map((request) => request.path);
    expect(deleted).toEqual(["/repos/example/app/actions/runners/11"]);
  });

  it("discards a clone left behind by a crashed cycle before starting", async () => {
    addVm(sandbox, "runner-linux");
    addVm(sandbox, "rack-runner-slot-1");
    await runSlot(sandbox, "linux", "1", "0");
    const calls = tartCalls(sandbox);
    expect(calls.indexOf("delete rack-runner-slot-1")).toBeLessThan(calls.indexOf("clone runner-linux rack-runner-slot-1"));
  });

  it("backs off without registering a runner until the golden image exists", async () => {
    const { status, output } = await runSlot(sandbox, "linux", "1", "0");
    expect(status).toBe(1);
    expect(output).toContain("no runner-linux image yet");
    expect(sandbox.requests.some((request) => request.method === "POST")).toBe(false);
    expect(tartCalls(sandbox).some((call) => call.startsWith("clone"))).toBe(false);
  });

  it("stops a runner that outlives its lifetime and still deletes the clone", async () => {
    addVm(sandbox, "runner-linux");
    writeConfig(sandbox, { RUNNER_LIFETIME_SECONDS: "1" });
    const { output } = await runSlot(sandbox, "linux", "2", "60");
    expect(output).toContain("reached its 1 second lifetime");
    expect(tartCalls(sandbox).at(-1)).toBe("delete rack-runner-slot-2");
  });

  it("stops the runner and deletes the clone when the VM exits mid-job", async () => {
    addVm(sandbox, "runner-linux");
    const slotRun = runSlot(sandbox, "linux", "1", "60");
    setTimeout(() => crashVm(sandbox, "rack-runner-slot-1"), 1500);
    const { output } = await slotRun;
    expect(output).toContain("lost its VM, which exited");
    expect(tartCalls(sandbox).at(-1)).toBe("delete rack-runner-slot-1");
    expect(hasVm(sandbox, "rack-runner-slot-1")).toBe(false);
  });

  it("stops the runner and deletes the clone when the guest stops answering", async () => {
    addVm(sandbox, "runner-macos");
    writeConfig(sandbox, macosConfig);
    const slotRun = runSlot(sandbox, "macos", "1", "60");
    setTimeout(() => wedgeGuest(sandbox, "rack-runner-macos-slot-1"), 1500);
    const { output } = await slotRun;
    expect(output).toContain("lost its VM, which missed 2 guest agent probes");
    expect(tartCalls(sandbox).at(-1)).toBe("delete rack-runner-macos-slot-1");
  }, 15_000);

  it("refuses to start with a config key missing and names it", async () => {
    addVm(sandbox, "runner-linux");
    writeConfig(sandbox, { LINUX_GOLDEN_VM: "" });
    const { status, output } = await runSlot(sandbox, "linux", "1", "0");
    expect(status).toBe(1);
    expect(output).toContain("is missing: LINUX_GOLDEN_VM");
    expect(tartCalls(sandbox)).toEqual([]);
  });

  it("waits for the GitHub token without touching GitHub or Tart", async () => {
    addVm(sandbox, "runner-linux");
    writeFileSync(join(runnerConfigDirectory(sandbox), "credentials.env"), "\n");
    const { status, output } = await runSlot(sandbox, "linux", "1", "0");
    expect(status).toBe(1);
    expect(output).toContain("no GITHUB_RUNNER_TOKEN");
    expect(sandbox.requests).toEqual([]);
    expect(tartCalls(sandbox).filter((call) => !call.startsWith("get"))).toEqual([]);
  });

  it("runs the macOS slot from the macOS golden image with the macOS labels and its own names", async () => {
    writeConfig(sandbox, macosConfig);
    addVm(sandbox, "runner-macos");
    const { status, output } = await runSlot(sandbox, "macos", "1", "0");
    expect({ status, output }).toMatchObject({ status: 0 });
    const calls = tartCalls(sandbox);
    expect(calls).toContain("clone runner-macos rack-runner-macos-slot-1");
    expect(calls).toContain("run --no-graphics --net-softnet rack-runner-macos-slot-1");
    expect(calls.at(-1)).toBe("delete rack-runner-macos-slot-1");
    const body = JSON.parse(sandbox.requests.find((request) => request.method === "POST")?.body ?? "{}") as { name: string; labels: string[] };
    expect(body.labels).toEqual(["self-hosted", "macOS", "ARM64", "app-swift"]);
    expect(body.name).toMatch(/^rack-runner-macos-1-\d+$/);
    expect(sandbox.requests.filter((request) => request.method === "DELETE")).toEqual([]);
  });

  it("refuses the macOS pool on a host configured without a macOS slot", async () => {
    addVm(sandbox, "runner-linux");
    const { status, output } = await runSlot(sandbox, "macos", "1", "0");
    expect(status).toBe(1);
    expect(output).toContain("no macOS runner slot");
    expect(tartCalls(sandbox)).toEqual([]);
  });

  describe("shared between repositories", () => {
    const sharedConfig = { GITHUB_REPOSITORIES: "example/app=app,example/tool=tool", RUNNER_LABELS: "self-hosted,Linux,ARM64" };
    const toolJob = ["self-hosted", "Linux", "ARM64", "tool"];
    const appJob = ["self-hosted", "Linux", "ARM64", "app"];
    beforeEach(() => {
      sandbox.github.repositories["example/tool"] = fakeRepository();
      writeConfig(sandbox, sharedConfig);
      addVm(sandbox, "runner-linux");
    });

    it("waits on the first repository when no repository has jobs queued", async () => {
      const { status } = await runSlot(sandbox, "linux", "1", "0");
      expect(status).toBe(0);
      expect(registrations(sandbox)).toEqual([
        { path: "/repos/example/app/actions/runners/generate-jitconfig", labels: ["self-hosted", "Linux", "ARM64", "app"] },
      ]);
    });

    it("registers with the repository whose jobs are waiting, under that repository's label", async () => {
      sandbox.github.repositories["example/tool"]!.queuedJobLabels.push(toolJob);
      const { status, output } = await runSlot(sandbox, "linux", "1", "0");
      expect({ status, output }).toMatchObject({ status: 0 });
      expect(output).toContain("waiting for a job from example/tool");
      expect(registrations(sandbox)).toEqual([
        { path: "/repos/example/tool/actions/runners/generate-jitconfig", labels: ["self-hosted", "Linux", "ARM64", "tool"] },
      ]);
    });

    it("prefers the earlier repository when both have jobs waiting", async () => {
      sandbox.github.repositories["example/app"]!.queuedJobLabels.push(appJob);
      sandbox.github.repositories["example/tool"]!.queuedJobLabels.push(toolJob);
      await runSlot(sandbox, "linux", "1", "0");
      expect(registrations(sandbox).map((registration) => registration.path)).toEqual(["/repos/example/app/actions/runners/generate-jitconfig"]);
    });

    it("ignores jobs that ask for labels this pool does not offer", async () => {
      sandbox.github.repositories["example/tool"]!.queuedJobLabels.push(["self-hosted", "macOS", "ARM64", "tool"]);
      await runSlot(sandbox, "linux", "1", "0");
      expect(registrations(sandbox).map((registration) => registration.path)).toEqual(["/repos/example/app/actions/runners/generate-jitconfig"]);
    });

    it("hands an idle runner's slot to a repository whose jobs start waiting", async () => {
      const slotRun = runSlot(sandbox, "linux", "1", "60");
      whenRegistered(sandbox, "example/app", () => sandbox.github.repositories["example/tool"]!.queuedJobLabels.push(toolJob));
      const { output } = await slotRun;
      expect(output).toContain("handed its slot to example/tool, which has jobs waiting");
      expect(sandbox.requests.some((request) => request.method === "DELETE" && request.path === "/repos/example/app/actions/runners/900")).toBe(true);
      expect(sandbox.github.repositories["example/app"]!.runners.some((runner) => runner.id === 900)).toBe(false);
      expect(tartCalls(sandbox).at(-1)).toBe("delete rack-runner-slot-1");
    }, 15_000);

    it("keeps a busy runner on its job however long other repositories wait", async () => {
      sandbox.github.repositories["example/tool"]!.queuedJobLabels.push(toolJob);
      sandbox.github.repositories["example/tool"]!.runners.push({ id: 5, name: "other-host-1-1", status: "online", busy: true, labels: [] });
      const slotRun = runSlot(sandbox, "linux", "1", "4");
      whenRegistered(sandbox, "example/tool", () => {
        sandbox.github.repositories["example/tool"]!.runners.find((runner) => runner.id === 900)!.busy = true;
        sandbox.github.repositories["example/app"]!.queuedJobLabels.push(appJob);
      });
      const { output } = await slotRun;
      expect(output).not.toContain("handed its slot");
      expect(output).toContain("finished");
    }, 15_000);

    it("stays with its repository while that repository has more jobs waiting than idle runners", async () => {
      sandbox.github.repositories["example/app"]!.queuedJobLabels.push(appJob);
      const slotRun = runSlot(sandbox, "linux", "1", "4");
      whenRegistered(sandbox, "example/app", () => sandbox.github.repositories["example/tool"]!.queuedJobLabels.push(toolJob));
      const { output } = await slotRun;
      expect(output).not.toContain("handed its slot");
    }, 15_000);

    it("keeps serving the first repository when the token cannot see another", async () => {
      writeConfig(sandbox, { ...sharedConfig, GITHUB_REPOSITORIES: "example/app=app,example/hidden=hidden" });
      const { status, output } = await runSlot(sandbox, "linux", "1", "0");
      expect({ status, output }).toMatchObject({ status: 0 });
      expect(output).toContain("could not clear offline runners in example/hidden");
      expect(output).toContain("could not read queued jobs in example/hidden; the token needs Actions read there");
      expect(output).toContain("waiting for a job from example/app");
    });

    it("refuses a repository entry that is not owner/repo", async () => {
      writeConfig(sandbox, { ...sharedConfig, GITHUB_REPOSITORIES: "example/app,tool" });
      const { status, output } = await runSlot(sandbox, "linux", "1", "0");
      expect(status).toBe(1);
      expect(output).toContain("entry 'tool' is not owner/repo");
      expect(tartCalls(sandbox)).toEqual([]);
    });
  });
});
