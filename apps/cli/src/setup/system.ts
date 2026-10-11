import { changed, unchanged } from "../core/output";
import { output, run, succeeds, sudo, type Machine } from "../core/shell";

export const isListening = (machine: Machine, port: number) =>
  succeeds(machine, ["/usr/sbin/lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]) ||
  succeeds(machine, ["nc", "-z", "-G", "2", "127.0.0.1", String(port)]);

export function pmsetValue(machine: Machine, key: string) {
  if (key === "disablesleep") return output(machine, ["pmset", "-g"]).match(/^\s*SleepDisabled\s*(\d*)/m)?.[1] ?? "";
  return output(machine, ["pmset", "-g", "custom"]).match(new RegExp(`^\\s*${key}\\s+(\\d*)`, "m"))?.[1] ?? "";
}

export function systemDefaultValue(machine: Machine, domain: string, key: string) {
  const asUser = run(machine, ["defaults", "read", domain, key]);
  if (asUser.code === 0) return asUser.stdout.trim();
  const asRoot = sudo(machine, ["defaults", "read", domain, key]);
  return asRoot.code === 0 ? asRoot.stdout.trim() : "";
}

export function ensureSystemBool(machine: Machine, domain: string, key: string, wanted: "0" | "1") {
  if (systemDefaultValue(machine, domain, key) === wanted) return unchanged(machine, `${domain} ${key} = ${wanted}`);
  sudo(machine, ["defaults", "write", domain, key, "-bool", wanted === "1" ? "true" : "false"]);
  changed(machine, `${domain} ${key} = ${wanted}`);
}

export function ensureUserDefault(machine: Machine, domain: string, key: string, type: string, wanted: string) {
  if (output(machine, ["defaults", "read", domain, key]) === wanted) return unchanged(machine, `${domain} ${key} = ${wanted}`);
  run(machine, ["defaults", "write", domain, key, type, wanted]);
  changed(machine, `${domain} ${key} = ${wanted}`);
}

export const isDaemonLoaded = (machine: Machine, label: string) => sudo(machine, ["launchctl", "print", `system/${label}`]).code === 0;

export function startSystemDaemon(machine: Machine, label: string, plist: string) {
  sudo(machine, ["launchctl", "enable", `system/${label}`]);
  if (!isDaemonLoaded(machine, label)) sudo(machine, ["launchctl", "bootstrap", "system", plist]);
}

export const localHostName = (machine: Machine) => output(machine, ["scutil", "--get", "LocalHostName"]);
