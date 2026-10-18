import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import builtins from "builtin-modules";
import esbuild from "esbuild";
import esbuildSvelte from "esbuild-svelte";

const production = process.argv[2] === "production";
// Point this at a test vault to get hot copies of the built plugin: OBSIDIAN_VAULT=~/Vaults/Dev pnpm dev:plugin
const vault = process.env.OBSIDIAN_VAULT;
const releaseFiles = ["main.js", "manifest.json", "styles.css"];

const copyToVault = {
  name: "copy-to-vault",
  setup(build) {
    build.onEnd(async (result) => {
      if (!vault || result.errors.length > 0) return;
      const target = path.join(vault, ".obsidian", "plugins", "archivarious");
      await mkdir(target, { recursive: true });
      await Promise.all(releaseFiles.map((f) => cp(f, path.join(target, f))));
      console.log(`[archivarious] copied to ${target}`);
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  // Provided by Obsidian at runtime; must never be bundled.
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  conditions: ["svelte", "browser"],
  plugins: [esbuildSvelte({ compilerOptions: { css: "injected" } }), copyToVault],
  format: "cjs",
  target: "es2020",
  platform: "browser",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  minify: production,
  treeShaking: true,
  outfile: "main.js",
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
