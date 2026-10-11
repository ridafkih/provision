import prepareLinuxVm from "../../../assets/runner/bake/prepare-linux-vm.sh" with { type: "text" };
import bakeImage from "../../../assets/runner/bin/bake-image.sh" with { type: "text" };
import runSlot from "../../../assets/runner/bin/run-slot.sh" with { type: "text" };
import bakeAgent from "../../../assets/runner/launchd/dev.provision.runner-bake.plist" with { type: "text" };
import slotAgent from "../../../assets/runner/launchd/dev.provision.runner-slot.plist" with { type: "text" };
import config from "../../../assets/runner/lib/config.sh" with { type: "text" };
import github from "../../../assets/runner/lib/github.sh" with { type: "text" };
import vm from "../../../assets/runner/lib/vm.sh" with { type: "text" };

export const runnerKitFiles: Record<string, string> = {
  "bake/prepare-linux-vm.sh": prepareLinuxVm,
  "bin/bake-image.sh": bakeImage,
  "bin/run-slot.sh": runSlot,
  "lib/config.sh": config,
  "lib/github.sh": github,
  "lib/vm.sh": vm,
};

export const runnerAgentTemplates = { bake: bakeAgent, slot: slotAgent };
