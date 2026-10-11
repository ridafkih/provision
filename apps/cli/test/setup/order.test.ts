import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setupSteps } from "../../src/setup/run";

const ids = setupSteps.map((step) => step.id);
const runSource = readFileSync(resolve(import.meta.dirname, "../../src/setup/run.ts"), "utf8");
const applySource = runSource.slice(runSource.indexOf("export async function applySetup"));

describe("step order", () => {
  it("collects the password first and repairs DNS before the first download", () => {
    const calls = [...applySource.matchAll(/\b(collectCredentials|requireNameResolution|fetchPublicKeys)\(/g)].map((match) => match[1]);
    expect(calls).toEqual(["collectCredentials", "requireNameResolution", "fetchPublicKeys"]);
  });

  it("does every download and the roles before Tailscale", () => {
    for (const before of ["ssh", "homebrew", "roles"]) expect(ids.indexOf(before)).toBeLessThan(ids.indexOf("tailscale"));
  });

  it("forgets the password once automatic login is set", () => {
    expect(runSource).toMatch(/await unattendedBoot\.apply\(setup\);\s+forgetPassword\(\);/);
  });

  it("slims last, once SSH, automatic login and Tailscale are in place", () => {
    expect(ids.at(-1)).toBe("slim");
    expect(ids[0]).toBe("passwordless-sudo");
    for (const before of ["ssh", "unattended-boot", "tailscale", "privacy-grants"]) expect(ids.indexOf(before)).toBeLessThan(ids.indexOf("slim"));
  });
});
