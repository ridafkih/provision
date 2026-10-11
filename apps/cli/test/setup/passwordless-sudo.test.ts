import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createChecklist, renderChecklist } from "../../src/core/checklist";
import { grantsPasswordlessSudo, passwordlessSudo, sudoersFile } from "../../src/setup/steps/passwordless-sudo";
import { setupSteps } from "../../src/setup/run";
import { addFakeCommand, createSandbox, disposeSandbox, printedText, setupOf, type Sandbox } from "../sandbox";

const adminRules = "User rack may run the following commands on rack-mini:\n    (ALL) ALL\n";
const passwordlessRules = `${adminRules}    (ALL) NOPASSWD: ALL\n`;

const fakeSudoers = (sandbox: Sandbox, { isValid }: { isValid: boolean }) => {
  const directory = join(sandbox.root, "sudoers.d");
  mkdirSync(directory);
  sandbox.machine.paths.sudoersDirectory = directory;
  writeFileSync(join(sandbox.home, "rules"), adminRules);
  addFakeCommand(
    sandbox,
    "sudo",
    'printf "%s\\n" "$*" >> "$HOME/calls"; [ "$1" = -n ] && shift; if [ "$1" = -l ]; then cat "$HOME/rules"; exit 0; fi; exec "$@"',
  );
  addFakeCommand(sandbox, "install", 'printf "install %s\\n" "$*" >> "$HOME/calls"; cp "${@: -2:1}" "${@: -1}"; cat "${@: -1}" >> "$HOME/rules"');
  addFakeCommand(sandbox, "visudo", `printf "visudo %s\\n" "$*" >> "$HOME/calls"; exit ${isValid ? 0 : 1}`);
};

describe("passwordless sudo", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = createSandbox();
  });
  afterEach(() => disposeSandbox(sandbox));

  it("runs first, so later root steps never wait for a password", () => {
    expect(setupSteps[0]).toBe(passwordlessSudo);
  });

  it("reads NOPASSWD: ALL from sudo -l and nothing less", () => {
    expect(grantsPasswordlessSudo(passwordlessRules)).toBe(true);
    expect(grantsPasswordlessSudo("    (ALL : ALL) NOPASSWD: ALL\n")).toBe(true);
    expect(grantsPasswordlessSudo(adminRules)).toBe(false);
    expect(grantsPasswordlessSudo("    (ALL) NOPASSWD: /usr/bin/true\n")).toBe(false);
  });

  it("validates the rule with visudo before installing it as root:wheel 0440, then leaves it alone", async () => {
    fakeSudoers(sandbox, { isValid: true });
    await passwordlessSudo.apply(setupOf(sandbox));
    await passwordlessSudo.apply(setupOf(sandbox));
    expect(readFileSync(sudoersFile(sandbox.machine), "utf8")).toBe("rack ALL=(ALL) NOPASSWD: ALL\n");
    const calls = readFileSync(join(sandbox.home, "calls"), "utf8").split("\n");
    const validation = calls.findIndex((call) => call.startsWith("visudo -cf "));
    const installation = calls.findIndex((call) => call.startsWith("install -m 0440 -o root -g wheel "));
    expect(validation).toBeGreaterThanOrEqual(0);
    expect(installation).toBeGreaterThan(validation);
    expect(calls.filter((call) => call.startsWith("install ")).length).toBe(1);
    expect(sandbox.printed).toEqual([`set: Passwordless sudo for rack (${sudoersFile(sandbox.machine)})`, "unchanged: Passwordless sudo for rack"]);
  });

  it("installs nothing when visudo rejects the rule", async () => {
    fakeSudoers(sandbox, { isValid: false });
    expect(() => passwordlessSudo.apply(setupOf(sandbox))).toThrow("visudo rejected");
    expect(existsSync(sudoersFile(sandbox.machine))).toBe(false);
  });

  it("leaves sudo alone with --no-passwordless-sudo", async () => {
    fakeSudoers(sandbox, { isValid: true });
    await passwordlessSudo.apply(setupOf(sandbox, ["--no-passwordless-sudo"]));
    expect(printedText(sandbox)).toBe("skipped: --no-passwordless-sudo");
    expect(existsSync(sudoersFile(sandbox.machine))).toBe(false);
  });

  it("shows in the checklist", () => {
    fakeSudoers(sandbox, { isValid: true });
    const missing = createChecklist();
    passwordlessSudo.check?.(setupOf(sandbox), missing);
    expect(renderChecklist(missing)).toBe("  ✗ Passwordless sudo for rack\n      fix: rerun provision\n");
    writeFileSync(join(sandbox.home, "rules"), passwordlessRules);
    const present = createChecklist();
    passwordlessSudo.check?.(setupOf(sandbox), present);
    expect(renderChecklist(present)).toBe("  ✓ Passwordless sudo for rack\n");
  });

  it("names the file so sudo reads it, even for a user name with a dot", () => {
    expect(sudoersFile({ ...sandbox.machine, user: "first.last" }).endsWith("/provision-first_last")).toBe(true);
  });
});
