import { describe, expect, test } from "bun:test";
import { TASKS, validate } from "../../src/slim/catalog";
import { services } from "../../src/slim/catalog/kinds";
import { protection } from "../../src/slim/catalog/protect";
import { select } from "../../src/slim/select";

describe("catalog", () => {
  test("validates", () => {
    expect(() => validate(TASKS)).not.toThrow();
  });

  test("never names a protected label", () => {
    const protectedLabels = TASKS.flatMap((task) => (task.labels ?? []).filter((label) => protection(label)));
    expect(protectedLabels).toEqual([]);
  });

  test("a label is disabled by at most one task per domain", () => {
    const owners = new Map<string, Set<string>>();
    for (const task of TASKS) {
      for (const label of task.labels ?? []) owners.set(label, (owners.get(label) ?? new Set()).add(task.id));
    }
    const shared = [...owners].filter(([, tasks]) => tasks.size > 1).map(([label]) => label);
    expect(shared).toEqual([]);
  });

  test("validate rejects a protected label", () => {
    const bad = services({ id: "bad", group: "host", title: "", summary: "", tier: "max", daemons: ["com.apple.mDNSResponder.reloaded"] });
    expect(() => validate([bad])).toThrow(/protected/);
  });
});

describe("protection", () => {
  test.each([
    ["com.apple.Virtualization.AppleVirtualPlatformHIDBridge", "Virtualization.framework"],
    ["com.apple.NetworkSharing", "vmnet NAT for VMs"],
    ["com.openssh.sshd", "SSH"],
    ["com.apple.screensharing.agent", "Screen Sharing"],
    ["com.apple.softwareupdated", "macOS updates"],
    ["com.apple.mDNSResponder.reloaded", "DNS and Bonjour"],
    ["sh.brew.tailscale", "third-party service"],
    ["homebrew.mxcl.tailscale", "third-party service"],
    ["com.apple.WindowManager.agent", "GUI login session (auto-login needs it)"],
    ["com.apple.controlcenter", "GUI login session (part of the menu bar that auto-login waits for)"],
    ["com.apple.MenuBarAgent", "GUI login session (disabling it with Control Center bounced login on 2026-10-11)"],
    ["com.apple.bootpd", "DHCP for VMs on vmnet NAT"],
    ["com.apple.screensharing", "Screen Sharing"],
    ["com.tailscale.ipn.macsys", "third-party service"],
  ])("%s is protected", (label, why) => {
    expect(protection(label)).toBe(why);
  });

  test("ordinary Apple jobs are not", () => {
    expect(protection("com.apple.mediaanalysisd")).toBeNull();
    expect(protection("com.apple.loginwindow.LWWeeklyMessageTracer")).toBeNull();
  });
});

const ids = (sel: Parameters<typeof select>[1]) => select(TASKS, sel).map((t) => t.id);

describe("select", () => {
  test("profiles nest", () => {
    const lean = ids({ profile: "lean" });
    const host = ids({ profile: "host" });
    const max = ids({ profile: "max" });
    expect(host).toEqual(expect.arrayContaining(lean));
    expect(max).toEqual(expect.arrayContaining(host));
    expect(max.length).toBe(TASKS.length);
  });

  test("iCloud is in host but not lean", () => {
    expect(ids({ profile: "host" })).toContain("icloud");
    expect(ids({ profile: "lean" })).not.toContain("icloud");
  });

  test("--only takes ids and groups, --except removes", () => {
    expect(ids({ profile: "lean", only: ["spotlight"] })).toEqual(["spotlight-index", "spotlight-ui"]);
    expect(ids({ profile: "host", except: ["storage", "siri"] })).not.toContain("bundled-apps");
    expect(ids({ profile: "host", except: ["siri"] })).not.toContain("siri-prefs");
  });

  test("unknown names are rejected", () => {
    expect(() => ids({ profile: "host", only: ["nope"] })).toThrow(/unknown/);
  });
});
