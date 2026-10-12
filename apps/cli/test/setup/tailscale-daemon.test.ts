import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ensureTailscaleDaemon } from "../../src/setup/steps/tailscale";
import { addFakeCommand, addFakeSudo, createSandbox, disposeSandbox, type Sandbox } from "../sandbox";

const daemonMessage = "tailscaled runs as a system daemon, before anyone logs in";

const fakeHomebrewHost = (sandbox: Sandbox, loadedLabel?: string) => {
  addFakeSudo(sandbox);
  sandbox.machine.paths.homebrewTailscale = addFakeCommand(sandbox, "tailscale", "exit 0");
  sandbox.machine.paths.brew = addFakeCommand(sandbox, "brew", 'printf "brew %s\\n" "$*" >> "$HOME/calls"; exit 0');
  addFakeCommand(sandbox, "launchctl", `printf "launchctl %s\\n" "$*" >> "$HOME/calls"; [ "$1" = print ] && [ "$2" = "system/${loadedLabel ?? "none"}" ]`);
};

const brewCalls = (sandbox: Sandbox) => {
  const file = join(sandbox.home, "calls");
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((call) => call.startsWith("brew services")) : [];
};

describe("tailscaled system daemon", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = createSandbox();
  });
  afterEach(() => disposeSandbox(sandbox));

  it.each(["sh.brew.tailscale", "homebrew.mxcl.tailscale"])("leaves a daemon Homebrew loaded as %s alone", (label) => {
    fakeHomebrewHost(sandbox, label);
    ensureTailscaleDaemon(sandbox.machine);
    expect(sandbox.printed.at(-1)).toBe(`unchanged: ${daemonMessage}`);
    expect(brewCalls(sandbox)).toEqual([]);
  });

  it("starts the Homebrew service when no tailscaled daemon is loaded", () => {
    fakeHomebrewHost(sandbox);
    ensureTailscaleDaemon(sandbox.machine);
    expect(brewCalls(sandbox)).toEqual(["brew services start tailscale"]);
    expect(sandbox.printed.at(-1)).toBe(`set: ${daemonMessage}`);
  });
});
