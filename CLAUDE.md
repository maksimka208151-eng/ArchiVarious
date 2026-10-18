# ArchiVarious

pnpm monorepo. Read docs/ARCHITECTURE.md before changing module boundaries.

- `pnpm check` = Biome lint + typecheck (tsc / svelte-check) + Vitest. Run it before every push.
- Rust (widget app): `cd apps/widget/src-tauri && cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test`
  (needs `apps/widget/dist/` to exist: `pnpm --filter @archivarious/widget build`).
- Domain logic belongs in `packages/core` (no platform APIs, `lib: ES2022` only). Hosts (plugin, widget) stay thin.
- The inbox file format (`packages/core/src/inbox.ts`) is a cross-app contract: bump `INBOX_PROTOCOL_VERSION` and keep parsing old versions when changing it.
- Plugin version bumps go through `pnpm version` in apps/obsidian-plugin so the root manifest.json/versions.json stay in sync.
- User-facing docs and UI strings are in Russian.
