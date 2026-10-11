import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hasForeignFilesInProvisionHome, installBinary, repairProvisionHome } from "../../src/setup/home";
import { loadSavedArguments, saveArguments } from "../../src/setup/options";
import { addFakeCommand, createSandbox, disposeSandbox, printedText, type Sandbox } from "../sandbox";

const lockLikeRoot = (sandbox: Sandbox) => {
  mkdirSync(join(sandbox.home, ".provision/kit"), { recursive: true });
  writeFileSync(join(sandbox.home, ".provision/arguments"), "");
  chmodSync(join(sandbox.home, ".provision/arguments"), 0o400);
  chmodSync(join(sandbox.home, ".provision"), 0o500);
};

const addFakeRootSudo = (sandbox: Sandbox) =>
  addFakeCommand(
    sandbox,
    "sudo",
    'printf "%s\\n" "$*" >> "$HOME/../sudo.log"; [ "$1" = -n ] && shift; if [ "$1" = chown ]; then chmod -R u+rwX "${@: -1}"; exit 0; fi; exec "$@"',
  );

describe("a ~/.provision left behind by root", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = createSandbox();
    addFakeRootSudo(sandbox);
  });
  afterEach(() => {
    if (existsSync(join(sandbox.home, ".provision"))) chmodSync(join(sandbox.home, ".provision"), 0o700);
    disposeSandbox(sandbox);
  });

  it("is noticed", () => {
    lockLikeRoot(sandbox);
    expect(hasForeignFilesInProvisionHome(sandbox.machine)).toBe(true);
  });

  it("is given back to the user with sudo before anything writes to it", () => {
    lockLikeRoot(sandbox);
    repairProvisionHome(sandbox.machine);
    saveArguments(sandbox.home, ["--github", "owner"]);
    expect(readFileSync(join(sandbox.root, "sudo.log"), "utf8")).toContain(`-n chown -R rack:staff ${join(sandbox.home, ".provision")}`);
    expect(printedText(sandbox)).toContain("gave");
    expect(loadSavedArguments(sandbox.home)).toEqual(["--github", "owner"]);
  });

  it("is left alone when it already belongs to the user", () => {
    mkdirSync(join(sandbox.home, ".provision"), { recursive: true });
    expect(hasForeignFilesInProvisionHome(sandbox.machine)).toBe(false);
    repairProvisionHome(sandbox.machine);
    expect(existsSync(join(sandbox.root, "sudo.log"))).toBe(false);
  });
});

describe("the installed binary", () => {
  it("is a fresh copy of the binary the run came from, and is left alone when it is that binary", () => {
    const sandbox = createSandbox();
    const downloaded = join(sandbox.root, "downloaded");
    writeFileSync(downloaded, "binary v2");
    mkdirSync(join(sandbox.home, ".provision/bin"), { recursive: true });
    writeFileSync(join(sandbox.home, ".provision/bin/provision"), "binary v1");
    installBinary(sandbox.machine, downloaded);
    installBinary(sandbox.machine, join(sandbox.home, ".provision/bin/provision"));
    const installed = readFileSync(join(sandbox.home, ".provision/bin/provision"), "utf8");
    disposeSandbox(sandbox);
    expect(installed).toBe("binary v2");
    expect(sandbox.printed).toEqual([`set: provision binary at ${join(sandbox.home, ".provision/bin/provision")}`, `unchanged: provision binary at ${join(sandbox.home, ".provision/bin/provision")}`]);
  });
});
