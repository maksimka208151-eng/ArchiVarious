<script lang="ts">
  export type CaptureMode = "note" | "calendar";

  interface Props {
    mode: CaptureMode;
    /** Short labels (icons) for tight places such as the desktop widget bar. */
    compact?: boolean;
  }

  let { mode = $bindable(), compact = false }: Props = $props();
</script>

<!-- A two-position slider: "note" (saved to the vault) or "calendar" (becomes a Google Calendar event). -->
<div class="archivarious-mode" class:is-compact={compact} role="radiogroup" aria-label="Куда сохранить">
  <span class="archivarious-mode__thumb" class:is-right={mode === "calendar"} aria-hidden="true"></span>
  <button
    type="button"
    role="radio"
    aria-checked={mode === "note"}
    title="Заметка в хранилище"
    onclick={() => (mode = "note")}>{compact ? "📝" : "Заметка"}</button
  >
  <button
    type="button"
    role="radio"
    aria-checked={mode === "calendar"}
    title="Задача в Google Календарь"
    onclick={() => (mode = "calendar")}>{compact ? "📅" : "Задача в календарь"}</button
  >
</div>

<style>
  .archivarious-mode {
    position: relative;
    display: inline-grid;
    grid-template-columns: 1fr 1fr;
    padding: 2px;
    border-radius: 999px;
    background: rgba(128, 128, 128, 0.18);
    flex-shrink: 0;
  }
  .archivarious-mode button {
    position: relative;
    z-index: 1;
    border: none;
    background: transparent;
    box-shadow: none;
    color: inherit;
    padding: 3px 12px;
    border-radius: 999px;
    font-size: 0.85em;
    cursor: pointer;
    white-space: nowrap;
  }
  .archivarious-mode.is-compact button {
    padding: 2px 6px;
    font-size: 0.9em;
  }
  .archivarious-mode button[aria-checked="true"] {
    color: #fff;
  }
  .archivarious-mode__thumb {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 2px;
    width: calc(50% - 2px);
    border-radius: 999px;
    background: var(--archivarious-accent, #5b3fd1);
    transition: transform 0.18s ease;
  }
  .archivarious-mode__thumb.is-right {
    transform: translateX(100%);
  }
</style>
