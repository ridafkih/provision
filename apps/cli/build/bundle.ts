import { mkdir, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseProfile, renderInstaller } from "./installer.ts";

const cliDirectory = resolve(import.meta.dirname, "..");
const sourceDirectory = join(cliDirectory, "src");
const profilesDirectory = join(cliDirectory, "profiles");
const distDirectory = join(cliDirectory, "dist");

const archiveSource = async () => {
  const archive = Bun.spawn(["tar", "-czf", "-", "-C", sourceDirectory, "."], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
    stdout: "pipe",
  });
  const bytes = await new Response(archive.stdout).arrayBuffer();
  if ((await archive.exited) !== 0) throw new Error("tar failed to archive src");
  return Buffer.from(bytes).toString("base64");
};

const profileNames = async () =>
  (await readdir(profilesDirectory)).filter((name) => name.endsWith(".args")).map((name) => basename(name, ".args"));

const payloadBase64 = await archiveSource();
await mkdir(distDirectory, { recursive: true });
await Bun.write(join(distDirectory, "provision.sh"), renderInstaller({ payloadBase64, profileArguments: [] }));
const writeProfileInstaller = async (name: string) => {
  const profileArguments = parseProfile(await Bun.file(join(profilesDirectory, `${name}.args`)).text());
  await Bun.write(join(distDirectory, `${name}.sh`), renderInstaller({ payloadBase64, profileArguments }));
};
await Promise.all((await profileNames()).map(writeProfileInstaller));
console.log(`built ${distDirectory}`);
