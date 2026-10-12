import { sudo, type Machine } from "../core/shell";

export const tailscaleDaemonLabels = ["sh.brew.tailscale", "homebrew.mxcl.tailscale"] as const;

export const loadedTailscaleDaemon = (machine: Machine) =>
  tailscaleDaemonLabels.find((label) => sudo(machine, ["launchctl", "print", `system/${label}`]).code === 0);
