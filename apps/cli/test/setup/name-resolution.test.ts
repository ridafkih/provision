import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireNameResolution } from "../../src/setup/name-resolution";
import { addFakeCommand, addFakeSudo, createSandbox, disposeSandbox, printedText, type Sandbox } from "../sandbox";

const dnsFixedBy = (sandbox: Sandbox, fixingCall: string) => {
  addFakeCommand(sandbox, "dscacheutil", '[ "$1" = -flushcache ] && exit 0; [ -e "$HOME/dns-fixed" ] && echo "ip_address: 140.82.112.3"; exit 0');
  addFakeCommand(sandbox, "killall", "exit 0");
  const fake = join(sandbox.bin, "tailscale-daemon");
  writeFileSync(fake, `#!/bin/bash\nprintf '%s\\n' "$*" >> "$HOME/tailscale-calls"\n[ "$*" = "${fixingCall}" ] && touch "$HOME/dns-fixed"\nexit 0\n`, { mode: 0o755 });
  sandbox.machine.paths.homebrewTailscale = fake;
};

describe("DNS broken by an unauthenticated tailscaled", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = createSandbox();
    addFakeSudo(sandbox);
  });
  afterEach(() => disposeSandbox(sandbox));

  it("takes Tailscale down before any download when that is what brings DNS back", async () => {
    dnsFixedBy(sandbox, "down");
    await requireNameResolution(sandbox.machine, "before setup starts");
    expect(printedText(sandbox)).toContain("took Tailscale down until sign-in, so DNS works again");
    expect(readFileSync(join(sandbox.home, "tailscale-calls"), "utf8")).toBe("set --accept-dns=false\ndown\n");
  }, 20_000);

  it("stops at accept-dns when that is enough", async () => {
    dnsFixedBy(sandbox, "set --accept-dns=false");
    await requireNameResolution(sandbox.machine, "before setup starts");
    expect(printedText(sandbox)).toContain("stopped Tailscale from taking over DNS");
  }, 20_000);

  it("stops with a clear message when nothing brings DNS back", async () => {
    addFakeCommand(sandbox, "dscacheutil", "exit 0");
    addFakeCommand(sandbox, "killall", "exit 0");
    await expect(requireNameResolution(sandbox.machine, "before setup starts")).rejects.toThrow(
      "can't look up github.com before setup starts. Check the network cable or Wi-Fi, then run the same command again.",
    );
  }, 20_000);
});
