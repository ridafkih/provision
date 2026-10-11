import { say } from "../../core/output";
import { countOf, type Checklist } from "../../core/checklist";
import { run } from "../../core/shell";
import type { Setup } from "../context";
import { localHostName } from "../system";
import { tailscaleIp, tailscaleStatus } from "./tailscale";

export const notifyPayload = ({ machine, options }: Setup, checklist: Checklist) => ({
  event: "provisioned",
  hostname: localHostName(machine),
  user: machine.user,
  tailnet_name: (tailscaleStatus(machine).Self?.DNSName ?? "").replace(/\.$/, ""),
  tailnet_ip: tailscaleIp(machine),
  roles: options.roles,
  failures: countOf(checklist, "fail"),
  waiting_on_owner: countOf(checklist, "owner"),
});

export function sendNotification(setup: Setup, checklist: Checklist) {
  const { machine, options } = setup;
  if (!options.notifyUrl) return;
  const body = JSON.stringify(notifyPayload(setup, checklist));
  const sent = run(machine, ["curl", "-fsS", "--max-time", "15", "-H", "content-type: application/json", "--data", "@-", options.notifyUrl], { input: body });
  say(machine, sent.code === 0 ? `notified ${options.notifyUrl}` : `could not notify ${options.notifyUrl}`);
}
