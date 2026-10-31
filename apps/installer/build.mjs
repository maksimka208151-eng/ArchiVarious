// Builds dist/ArchiVarious-installer.exe: a single Windows exe with the Obsidian plugin embedded.
// Prerequisites: Go (see go.mod) and a plugin build (`pnpm build:plugin`). Run from the repo root:
//   pnpm build:installer
// The build is reproducible: -trimpath, no VCS stamping, pinned go-winres, fixed resource versions.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GO_WINRES = "github.com/tc-hib/go-winres@v0.3.3";
const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(here, "../obsidian-plugin");
const files = ["main.js", "manifest.json", "styles.css"];

for (const f of files) {
  if (!existsSync(path.join(pluginDir, f))) {
    throw new Error(`apps/obsidian-plugin/${f} is missing: run \`pnpm build:plugin\` first.`);
  }
  copyFileSync(path.join(pluginDir, f), path.join(here, "payload", f));
}
// The app icon is shared with the widget app.
copyFileSync(path.resolve(here, "../widget/src-tauri/icons/icon.ico"), path.join(here, "winres", "icon.ico"));
const { version } = JSON.parse(readFileSync(path.join(pluginDir, "manifest.json"), "utf8"));

const run = (cmd, args, env = {}) =>
  execFileSync(cmd, args, { cwd: here, stdio: "inherit", env: { ...process.env, ...env } });

// Windows resources: icon, manifest (no UAC prompt, DPI aware, modern controls) and version info.
run("go", [
  "run",
  GO_WINRES,
  "make",
  "--in",
  "winres/winres.json",
  "--arch",
  "amd64",
  "--file-version",
  version,
  "--product-version",
  version,
]);

mkdirSync(path.join(here, "dist"), { recursive: true });
const out = path.join("dist", "ArchiVarious-installer.exe");
run(
  "go",
  [
    "build",
    "-trimpath",
    "-buildvcs=false",
    "-ldflags",
    `-s -w -H windowsgui -buildid= -X main.version=${version}`,
    "-o",
    out,
    ".",
  ],
  { GOOS: "windows", GOARCH: "amd64", CGO_ENABLED: "0" },
);
console.log(`Built apps/installer/${out} (plugin ${version})`);
