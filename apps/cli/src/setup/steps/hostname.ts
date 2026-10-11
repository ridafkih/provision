import { changed, unchanged } from "../../core/output";
import { output, sudo } from "../../core/shell";
import type { SetupStep } from "../context";

export const hostname: SetupStep = {
  id: "hostname",
  title: "Name",
  apply({ machine, options }) {
    if (!options.wantedHostname) return;
    for (const kind of ["ComputerName", "LocalHostName", "HostName"]) {
      if (output(machine, ["scutil", "--get", kind]) === options.wantedHostname) {
        unchanged(machine, `${kind} = ${options.wantedHostname}`);
        continue;
      }
      sudo(machine, ["scutil", "--set", kind, options.wantedHostname]);
      changed(machine, `${kind} = ${options.wantedHostname}`);
    }
  },
};
