import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createChecklist, renderChecklist } from "../../src/core/checklist";
import { bootOutAgent, renderRunnerAgent, runnerConfig, runnerSlotCount } from "../../src/setup/roles/runner";
import { checkRunnerRole } from "../../src/setup/roles/runner";
import { runnerAgentTemplates } from "../../src/setup/roles/runner-kit";
import { addFakeCommand, createSandbox, disposeSandbox, setupOf, type Sandbox } from "../sandbox";

const fakeHost = (sandbox: Sandbox, memoryBytes: number, cpuCount: number) => {
  addFakeCommand(sandbox, "sysctl", `case "$2" in hw.memsize) echo ${memoryBytes} ;; hw.ncpu) echo ${cpuCount} ;; esac`);
  addFakeCommand(sandbox, "scutil", "echo Rack-Mini");
};

describe("runner role config", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = createSandbox();
  });
  afterEach(() => disposeSandbox(sandbox));

  it("labels the runner, names it after the host and bakes the prepulled images", () => {
    fakeHost(sandbox, 16 * 1024 ** 3, 10);
    const config = runnerConfig(setupOf(sandbox, ["--runner-repo", "example/app", "--runner-label", "app", "--runner-prepull", "postgres:18", "--runner-prepull", "redis:8"]));
    expect(config).toContain("GITHUB_REPOSITORIES=example/app\n");
    expect(config).toContain("RUNNER_LABELS=self-hosted,Linux,ARM64,app\n");
    expect(config).toContain("RUNNER_NAME_PREFIX=rack-mini\n");
    expect(config).toContain("PREPULL_IMAGES=postgres:18,redis:8\n");
    expect(config).toContain("LINUX_SLOTS=2\n");
  });

  it("shares one pool between every repository it serves, each with its own label", () => {
    fakeHost(sandbox, 16 * 1024 ** 3, 10);
    const config = runnerConfig(setupOf(sandbox, ["--runner-repo", "example/app=app", "--runner-repo", "example/tool=tool"]));
    expect(config).toContain("GITHUB_REPOSITORIES=example/app=app,example/tool=tool\n");
    expect(config).toContain("RUNNER_LABELS=self-hosted,Linux,ARM64\n");
    expect(config).toContain("DEMAND_CHECK_INTERVAL_SECONDS=30\n");
  });

  it("keeps the base labels and an empty prepull list when none are given", () => {
    fakeHost(sandbox, 16 * 1024 ** 3, 10);
    const config = runnerConfig(setupOf(sandbox, ["--runner-repo", "o/r"]));
    expect(config).toContain("RUNNER_LABELS=self-hosted,Linux,ARM64\n");
    expect(config).toContain("PREPULL_IMAGES=\n");
  });

  it.each([
    [32, 10, 4],
    [24, 8, 3],
    [64, 4, 2],
  ])("sizes %i GB and %i cores to %i slots", (gigabytes, cores, slots) => {
    fakeHost(sandbox, gigabytes * 1024 ** 3, cores);
    expect(runnerSlotCount(sandbox.machine, 0)).toBe(slots);
  });

  it("refuses a host too small for one runner VM", () => {
    fakeHost(sandbox, 8 * 1024 ** 3, 8);
    expect(() => runnerSlotCount(sandbox.machine, 0)).toThrow("too little for one 6144 MB Linux runner VM");
  });

  it("reports a runner role that was never set up instead of stopping the checklist", () => {
    addFakeCommand(sandbox, "tart", "exit 1");
    const checklist = createChecklist();
    checkRunnerRole(setupOf(sandbox, ["--role", "runner", "--runner-repo", "o/r"]), checklist);
    expect(renderChecklist(checklist)).toContain("GitHub runner configured");
  });

  it("points the launch agents at the installed runner scripts", () => {
    const agent = renderRunnerAgent(sandbox.machine, runnerAgentTemplates.slot, "dev.provision.runner-slot-2", 2, "linux");
    expect(agent).toContain(`<string>${sandbox.home}/.provision/kit/roles/runner/bin/run-slot.sh</string>`);
    expect(agent).toContain("<string>dev.provision.runner-slot-2</string>");
    expect(agent).not.toContain("@");
  });

  it("adds one macOS slot from the given image and gives the Linux slots what memory is left", () => {
    fakeHost(sandbox, 24 * 1024 ** 3, 12);
    const config = runnerConfig(
      setupOf(sandbox, ["--runner-repo", "o/r", "--runner-macos-image", "ghcr.io/cirruslabs/macos-tahoe-xcode:26.5", "--runner-macos-label", "app-swift"]),
    );
    expect(config).toContain("LINUX_SLOTS=2\n");
    expect(config).toContain("MACOS_SLOTS=1\n");
    expect(config).toContain("MACOS_BASE_IMAGE=ghcr.io/cirruslabs/macos-tahoe-xcode:26.5\n");
    expect(config).toContain("MACOS_RUNNER_LABELS=self-hosted,macOS,ARM64,app-swift\n");
  });

  it("has no macOS slot unless an image is given", () => {
    fakeHost(sandbox, 24 * 1024 ** 3, 12);
    const config = runnerConfig(setupOf(sandbox, ["--runner-repo", "o/r"]));
    expect(config).toContain("LINUX_SLOTS=3\n");
    expect(config).toContain("MACOS_SLOTS=0\n");
  });

  it("runs one Linux slot beside the macOS one on a 16 GB host", () => {
    fakeHost(sandbox, 16 * 1024 ** 3, 10);
    const config = runnerConfig(setupOf(sandbox, ["--runner-repo", "o/r", "--runner-macos-image", "img"]));
    expect(config).toContain("LINUX_SLOTS=1\n");
    expect(config).toContain("MACOS_SLOTS=1\n");
    expect(config).toContain("MACOS_VM_MEMORY_MB=6144");
  });

  it("refuses a macOS slot on a host that would then have no room for a Linux one", () => {
    fakeHost(sandbox, 12 * 1024 ** 3, 12);
    expect(() => runnerConfig(setupOf(sandbox, ["--runner-repo", "o/r", "--runner-macos-image", "img"]))).toThrow("beside a 6144 MB macOS runner VM");
  });

  it("starts the macOS slot agent on the macOS pool with its own log", () => {
    const agent = renderRunnerAgent(sandbox.machine, runnerAgentTemplates.slot, "dev.provision.runner-macos-slot-1", 1, "macos");
    expect(agent).toContain("<string>macos</string>\n    <string>1</string>");
    expect(agent).toContain(`<string>${sandbox.home}/Library/Logs/provision/macos-slot-1.log</string>`);
    expect(agent).not.toContain("@");
  });

  it("waits for a booted-out slot to finish tearing down before going on", () => {
    addFakeCommand(
      sandbox,
      "launchctl",
      `case "$1" in
  bootout) echo 3 > "$HOME/unloading" ;;
  print) left=$(cat "$HOME/unloading"); [ "$left" -gt 0 ] || exit 1; echo $((left - 1)) > "$HOME/unloading" ;;
esac`,
    );
    bootOutAgent(sandbox.machine, "gui/501", "dev.provision.runner-slot-1");
    expect(readFileSync(join(sandbox.home, "unloading"), "utf8").trim()).toBe("0");
  });
});
