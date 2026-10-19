// Syncs the plugin version into manifest.json and versions.json, both in apps/obsidian-plugin and at the
// repo root (Obsidian's community plugin directory reads manifest.json/versions.json from the repo root).
// Usage (from apps/obsidian-plugin): pnpm version 0.2.0 --no-git-tag-version
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const targetVersion = process.env.npm_package_version;
if (!targetVersion) throw new Error("Run through `pnpm version`, which sets npm_package_version.");

const pluginDir = process.cwd();
const rootDir = path.resolve(pluginDir, "../..");
const write = (file, data) => writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

const manifest = JSON.parse(readFileSync(path.join(pluginDir, "manifest.json"), "utf8"));
manifest.version = targetVersion;
const versions = JSON.parse(readFileSync(path.join(pluginDir, "versions.json"), "utf8"));
versions[targetVersion] = manifest.minAppVersion;

for (const dir of [pluginDir, rootDir]) {
  write(path.join(dir, "manifest.json"), manifest);
  write(path.join(dir, "versions.json"), versions);
}
