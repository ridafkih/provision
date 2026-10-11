import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  addVm,
  createSandbox,
  disposeSandbox,
  execStdin,
  hasVm,
  runnerRoleDirectory,
  runKitScript,
  runnerConfigDirectory,
  type Sandbox,
  tartCalls,
} from "./runner-sandbox.ts";

const bake = (sandbox: Sandbox, args: string[] = []) => runKitScript(sandbox, "bin/bake-image.sh", args, "0");

const goldenState = (sandbox: Sandbox) => readFileSync(join(runnerConfigDirectory(sandbox), "golden.env"), "utf8");

const recordBake = (sandbox: Sandbox, version: string, daysAgo: number) => {
  const bakedAt = Math.floor(Date.now() / 1000) - daysAgo * 86_400;
  writeFileSync(
    join(runnerConfigDirectory(sandbox), "golden.env"),
    `BAKED_RUNNER_VERSION=${version}\nBAKED_AT_EPOCH=${bakedAt}\n`,
  );
};

describe("bake-image.sh", () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await createSandbox();
  });

  afterEach(() => disposeSandbox(sandbox));

  it("bakes the golden image from the base image with the latest arm64 runner and prepulled images", async () => {
    const { status, output } = await bake(sandbox);
    expect({ status, output }).toMatchObject({ status: 0 });
    const calls = tartCalls(sandbox);
    expect(calls).toContain("pull ghcr.io/cirruslabs/ubuntu-runner-arm64:24.04");
    expect(calls).toContain("clone ghcr.io/cirruslabs/ubuntu-runner-arm64:24.04 runner-linux-staging");
    expect(calls).toContain("set runner-linux-staging --cpu 4 --memory 4096 --disk-size 80");
    expect(calls).toContain(
      "exec -i runner-linux-staging sudo bash -s -- 2.338.0 https://example.invalid/actions-runner-linux-arm64-2.338.0.tar.gz arm64digest postgres:18 amazon/dynamodb-local:3.3.1",
    );
    expect(calls).toContain("set runner-linux-staging --memory 6144");
    expect(calls).toContain("rename runner-linux-staging runner-linux");
    expect(execStdin(sandbox)).toBe(readFileSync(join(runnerRoleDirectory, "bake/prepare-linux-vm.sh"), "utf8"));
    expect(hasVm(sandbox, "runner-linux")).toBe(true);
    expect(hasVm(sandbox, "runner-linux-staging")).toBe(false);
    expect(goldenState(sandbox)).toContain("BAKED_RUNNER_VERSION=2.338.0");
  });

  it("leaves a fresh golden image with the current runner alone", async () => {
    addVm(sandbox, "runner-linux");
    recordBake(sandbox, "2.338.0", 1);
    const { status, output } = await bake(sandbox);
    expect({ status, output }).toMatchObject({ status: 0 });
    expect(output).toContain("unchanged: runner-linux already has actions runner 2.338.0");
    expect(tartCalls(sandbox).some((call) => call.startsWith("pull"))).toBe(false);
  });

  it("rebakes when GitHub ships a new runner", async () => {
    addVm(sandbox, "runner-linux");
    recordBake(sandbox, "2.337.0", 1);
    await bake(sandbox);
    expect(tartCalls(sandbox)).toContain("rename runner-linux-staging runner-linux");
    expect(goldenState(sandbox)).toContain("BAKED_RUNNER_VERSION=2.338.0");
  });

  it("rebakes a golden image older than the maximum age", async () => {
    addVm(sandbox, "runner-linux");
    recordBake(sandbox, "2.338.0", 8);
    await bake(sandbox);
    expect(tartCalls(sandbox)).toContain("rename runner-linux-staging runner-linux");
  });

  it("rebakes on --force", async () => {
    addVm(sandbox, "runner-linux");
    recordBake(sandbox, "2.338.0", 0);
    await bake(sandbox, ["--force"]);
    expect(tartCalls(sandbox)).toContain("rename runner-linux-staging runner-linux");
  });
});
