import { rmSync } from "node:fs";
import { resolve } from "node:path";

const packageDirectory = resolve(import.meta.dirname, "..");
const outfile = resolve(packageDirectory, "dist/provision");

rmSync(outfile, { force: true });

const result = await Bun.build({
  entrypoints: [resolve(packageDirectory, "src/cli.ts")],
  minify: true,
  compile: { target: "bun-darwin-arm64", outfile },
  plugins: [
    {
      // Ink imports react-devtools-core when DEV=true. The bundler hoists that
      // import, so stub it out rather than ship (or fail to find) devtools.
      name: "stub-react-devtools",
      setup(build) {
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: "react-devtools-core", namespace: "stub" }));
        build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: "export default { initialize() {}, connectToDevTools() {} };",
          loader: "js",
        }));
      },
    },
  ],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const signing = Bun.spawnSync(["codesign", "--force", "--sign", "-", outfile], { stdout: "inherit", stderr: "inherit" });
const verifying = Bun.spawnSync(["codesign", "--verify", "--strict", outfile], { stdout: "inherit", stderr: "inherit" });
if (signing.exitCode !== 0 || verifying.exitCode !== 0) {
  console.error(`could not sign ${outfile}`);
  process.exit(1);
}
console.log(`built ${outfile}`);
