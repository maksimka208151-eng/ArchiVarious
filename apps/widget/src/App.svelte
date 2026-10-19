<script lang="ts">
  import { platform } from "@tauri-apps/plugin-os";
  import Mobile from "./Mobile.svelte";
  import Widget from "./Widget.svelte";

  const os = platform();
  const isMobile = os === "android" || os === "ios";
</script>

{#if isMobile}
  <Mobile />
{:else}
  <Widget />
{/if}

<style>
  :global(html),
  :global(body) {
    margin: 0;
    font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
    background: transparent;
    color: CanvasText;
    color-scheme: light dark;
  }
  :global(button),
  :global(input[type="text"]),
  :global(input:not([type])) {
    font: inherit;
    color: inherit;
    padding: 4px 10px;
    border: 1px solid rgba(128, 128, 128, 0.4);
    border-radius: 8px;
    background: rgba(128, 128, 128, 0.1);
  }
  :global(button) {
    cursor: pointer;
  }
  :global(button:hover:not(:disabled)) {
    background: rgba(128, 128, 128, 0.22);
  }
  :global(button:disabled) {
    opacity: 0.5;
    cursor: default;
  }
  :global(input:focus-visible),
  :global(button:focus-visible) {
    outline: 2px solid #5b3fd1;
    outline-offset: 1px;
  }
</style>
