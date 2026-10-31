<script lang="ts" module>
  export type CaptureMode = "note" | "calendar" | "reminder";
</script>

<script lang="ts">
  import Icon from "./Icon.svelte";

  interface Props {
    mode: CaptureMode;
    /** Which positions the switch has; the widget app adds "reminder". */
    modes?: CaptureMode[];
    /** Short labels (icons) for tight places such as the desktop widget bar. */
    compact?: boolean;
  }

  let { mode = $bindable(), modes = ["note", "calendar"], compact = false }: Props = $props();

  const LABELS = {
    note: { icon: "note", label: "Заметка", title: "Заметка в хранилище" },
    calendar: { icon: "calendar", label: "Задача в календарь", title: "Задача в Google Календарь" },
    reminder: { icon: "bell", label: "Напоминание", title: "Напоминание уведомлением" },
  } as const;
  const index = $derived(Math.max(0, modes.indexOf(mode)));
</script>

<!-- A slider between "note" (saved to the vault), "calendar" (a Google Calendar event) and, in the widget, "reminder". -->
<div
  class="archivarious-mode"
  class:is-compact={compact}
  role="radiogroup"
  aria-label="Куда сохранить"
  style:grid-template-columns={`repeat(${modes.length}, 1fr)`}
>
  <span
    class="archivarious-mode__thumb"
    aria-hidden="true"
    style:width={`calc(${100 / modes.length}% - ${4 / modes.length}px)`}
    style:transform={`translateX(${index * 100}%)`}
  ></span>
  {#each modes as m (m)}
    <button
      type="button"
      role="radio"
      aria-checked={mode === m}
      title={LABELS[m].title}
      aria-label={LABELS[m].label}
      onclick={() => (mode = m)}
      ><Icon name={LABELS[m].icon} size={compact ? 15 : 16} />{#if !compact}<span>{LABELS[m].label}</span>{/if}</button
    >
  {/each}
</div>

<style>
  .archivarious-mode {
    position: relative;
    display: inline-grid;
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
    border-radius: 999px;
    background: var(--archivarious-accent, #113171);
    box-shadow: 0 1px 3px rgba(10, 33, 82, 0.35);
    transition: transform 0.22s cubic-bezier(0.3, 1.3, 0.5, 1);
  }
</style>
