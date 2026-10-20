<script lang="ts">
  import { platform } from "@tauri-apps/plugin-os";
  import Mobile from "./Mobile.svelte";
  import Widget from "./Widget.svelte";

  const os = platform();
  const isMobile = os === "android" || os === "ios";
  // Windows draws real acrylic glass behind the window (tauri.conf.json); other systems get a more opaque pane.
  document.documentElement.dataset.os = os;
</script>

{#if isMobile}
  <Mobile />
{:else}
  <Widget />
{/if}

<style>
  /* Palette from the logo: navy ink on light glass, a light navy on dark glass. */
  :global(:root) {
    --accent: #113171;
    --accent-hover: #0a2152;
    --on-accent: #ffffff;
    --text: #0e1a33;
    --text-soft: rgba(14, 26, 51, 0.62);
    --chip: rgba(17, 49, 113, 0.07);
    --line: rgba(17, 49, 113, 0.16);
    --danger: #b3261e;
    --radius: 18px;
    --glass-hi: rgba(255, 255, 255, 0.72);
    --glass: rgba(236, 240, 248, 0.6);
    --glass-lo: rgba(217, 222, 234, 0.66);
    --rim: rgba(255, 255, 255, 0.45);
    --rim-top: rgba(255, 255, 255, 0.95);
    --rim-bottom: rgba(17, 49, 113, 0.12);
    --sheen: rgba(255, 255, 255, 0.7);
    --sheen-lo: rgba(138, 166, 230, 0.18);
    --archivarious-accent: var(--accent);
    --archivarious-on-accent: var(--on-accent);
    --archivarious-chip: var(--chip);
    --archivarious-line: var(--line);
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --accent: #8aa6e6;
      --accent-hover: #a9bff0;
      --on-accent: #0a2152;
      --text: #e9eef9;
      --text-soft: rgba(233, 238, 249, 0.62);
      --chip: rgba(138, 166, 230, 0.1);
      --line: rgba(138, 166, 230, 0.2);
      --danger: #ff8a80;
      --glass-hi: rgba(52, 70, 112, 0.62);
      --glass: rgba(22, 34, 66, 0.55);
      --glass-lo: rgba(10, 20, 44, 0.62);
      --rim: rgba(255, 255, 255, 0.1);
      --rim-top: rgba(255, 255, 255, 0.28);
      --rim-bottom: rgba(0, 0, 0, 0.35);
      --sheen: rgba(170, 195, 255, 0.22);
      --sheen-lo: rgba(138, 166, 230, 0.12);
    }
  }
  /* Windows 11 rounds the window to 8 px around the acrylic; the pane follows that corner. */
  :global(:root[data-os="windows"]) {
    --radius: 8px;
  }
  /* Without acrylic behind it the pane must carry its own background to stay readable. */
  :global(:root:not([data-os="windows"])) {
    --glass: rgba(236, 240, 248, 0.94);
    --glass-lo: rgba(222, 227, 238, 0.95);
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-os="windows"])) {
      --glass: rgba(22, 34, 66, 0.94);
      --glass-lo: rgba(12, 22, 46, 0.95);
    }
  }
  :global(html),
  :global(body) {
    margin: 0;
    font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
    background: transparent;
    color: var(--text);
    color-scheme: light dark;
  }
  :global(button),
  :global(select),
  :global(input[type="text"]),
  :global(input[type="date"]),
  :global(input[type="time"]),
  :global(input:not([type])) {
    font: inherit;
    color: inherit;
    padding: 5px 12px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--chip);
  }
  :global(button) {
    cursor: pointer;
  }
  :global(button:hover:not(:disabled)) {
    border-color: var(--accent);
  }
  :global(button:disabled) {
    opacity: 0.45;
    cursor: default;
  }
  :global(input:focus-visible),
  :global(select:focus-visible),
  :global(button:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  :global(input[type="radio"]),
  :global(input[type="checkbox"]) {
    accent-color: var(--accent);
  }
</style>
