import { systemPaths } from "../../src/core/shell";
import { collectCredentials } from "../../src/setup/credentials";
import { ProvisionError } from "../../src/core/output";

const [bin, home] = process.argv.slice(2);

try {
  collectCredentials(
    { home: home!, user: "rack", environment: { PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: home!, USER: "rack" }, paths: systemPaths, print: console.log },
    true,
  );
  console.log("collected");
} catch (error) {
  console.log(`provision: ${(error as ProvisionError).message}`);
}
process.exit(0);
