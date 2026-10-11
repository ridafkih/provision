import genericInstaller from "../../cli/dist/provision.sh";
import ridaInstaller from "../../cli/dist/rida.sh";
import { respond } from "./routes.ts";

const installers = { provision: genericInstaller, rida: ridaInstaller };

export default {
  fetch: (request: Request) => respond(installers, request),
};
