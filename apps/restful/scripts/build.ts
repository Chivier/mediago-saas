import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function build() {
  const appRoot = path.resolve(__dirname, "..");
  const distDir = path.resolve(appRoot, "dist");
  const buildDir = path.resolve(appRoot, "build");

  // Copy build output to dist
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.cp(buildDir, distDir, { recursive: true });

  // Create package.json for distribution
  const pkg = JSON.parse(
    await fs.readFile(path.resolve(appRoot, "package.json"), "utf-8"),
  );

  const distPkg = {
    name: pkg.name,
    version: pkg.version,
    type: "commonjs",
    main: "index.cjs",
    scripts: {
      start: "node index.cjs",
    },
    dependencies: {
      "@mediago/core": pkg.dependencies["@mediago/core"],
      "@mediago/deps": pkg.dependencies["@mediago/deps"],
      "better-sqlite3": pkg.dependencies["better-sqlite3"],
    },
  };

  await fs.writeFile(
    path.resolve(distDir, "package.json"),
    JSON.stringify(distPkg, null, 2),
  );

  console.log("Build complete!");
}

build().catch(console.error);
