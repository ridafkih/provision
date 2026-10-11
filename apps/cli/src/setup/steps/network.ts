import { output, type Machine } from "../../core/shell";
import type { SetupStep } from "../context";

export const servicePosition = (serviceOrder: string, service: string) => {
  const services = serviceOrder
    .split("\n")
    .filter((line) => /^\(\d+\) /.test(line))
    .map((line) => line.replace(/^\(\d*\) /, ""));
  const index = services.indexOf(service);
  return index < 0 ? undefined : index + 1;
};

const serviceOrder = (machine: Machine) => output(machine, ["networksetup", "-listnetworkserviceorder"]);

export const network: SetupStep = {
  id: "network",
  title: "Network",
  apply() {},
  check({ machine }, checklist) {
    const order = serviceOrder(machine);
    const ethernet = servicePosition(order, "Ethernet");
    const wifi = servicePosition(order, "Wi-Fi");
    if (ethernet !== undefined && wifi !== undefined && ethernet > wifi) {
      checklist.miss("Ethernet comes before Wi-Fi", "System Settings > Network > ... > Set Service Order, Ethernet first");
      return;
    }
    checklist.pass("Takes Ethernet when plugged in and falls back to known Wi-Fi");
  },
};
