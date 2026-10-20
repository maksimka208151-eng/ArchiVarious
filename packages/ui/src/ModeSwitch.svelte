<script lang="ts">
  import Icon from "./Icon.svelte";

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
    aria-label="Заметка"
    onclick={() => (mode = "note")}
    ><Icon name="note" size={compact ? 15 : 16} />{#if !compact}<span>Заметка</span>{/if}</button
  >
  <button
    type="button"
    role="radio"
    aria-checked={mode === "calendar"}
    title="Задача в Google Календарь"
    aria-label="Задача в календарь"
    onclick={() => (mode = "calendar")}
    ><Icon name="calendar" size={compact ? 15 : 16} />{#if !compact}<span>Задача в календарь</span>{/if}</button
  >
</div>

<style>
  .archivarious-mode {
    position: relative;
    display: inline-grid;
    grid-template-columns: 1fr 1fr;
    padding: 2px;
    border-radius: 999px;
    background: var(--archivarious-chip, rgba(17, 49, 113, 0.08));
    box-shadow: inset 0 0 0 1px var(--archivarious-line, rgba(17, 49, 113, 0.14));
    flex-shrink: 0;
  }
  .archivarious-mode button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
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
    padding: 4px 8px;
  }
  .archivarious-mode button[aria-checked="true"] {
    color: var(--archivarious-on-accent, #fff);
  }
  .archivarious-mode__thumb {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 2px;
    width: calc(50% - 2px);
    border-radius: 999px;
    background: var(--archivarious-accent, #113171);
    box-shadow: 0 1px 3px rgba(10, 33, 82, 0.35);
    transition: transform 0.22s cubic-bezier(0.3, 1.3, 0.5, 1);
  }
  .archivarious-mode__thumb.is-right {
    transform: translateX(100%);
  }
</style>
