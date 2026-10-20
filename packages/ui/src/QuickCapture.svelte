<script lang="ts">
  import { type EventWhen, lightFormat, suggestWhen } from "@archivarious/core";
  import EventFields from "./EventFields.svelte";
  import ModeSwitch, { type CaptureMode } from "./ModeSwitch.svelte";

  interface Props {
    /** Called with the raw text. The host decides how to persist it (vault API, file write, URI). */
    onsubmit: (raw: string) => void | Promise<void>;
    /** When given, a second action saves and sorts the note immediately instead of waiting for the survey. */
    onsubmitNow?: (raw: string) => void | Promise<void>;
    /** When given, a switch offers "task to calendar": the text becomes a calendar event at the picked time. */
    oncalendar?: (raw: string, when: EventWhen) => void | Promise<void>;
    oncancel?: () => void;
    placeholder?: string;
    autofocus?: boolean;
  }

  let { onsubmit, onsubmitNow, oncalendar, oncancel, placeholder = "Что запомнить?", autofocus = true }: Props =
    $props();

  let text = $state("");
  let busy = $state(false);
  let mode = $state<CaptureMode>("note");
  let when = $state<EventWhen>(suggestWhen(""));
  /** Until the user picks a date or time by hand, they follow the text ("завтра в 15:00"). */
  let touched = $state(false);
  const preview = $derived(text.trim() ? lightFormat(text) : null);

  $effect(() => {
    if (mode === "calendar" && !touched) when = suggestWhen(text);
  });

  async function submit(now = false) {
    if (!text.trim() || busy) return;
    busy = true;
    try {
      if (mode === "calendar" && oncalendar) await oncalendar(text, when);
      else await (now && onsubmitNow ? onsubmitNow : onsubmit)(text);
      text = "";
      touched = false;
    } catch (error) {
      // The host has told the user what went wrong; the text stays so nothing is lost.
      console.warn("ArchiVarious: capture failed", error);
    } finally {
      busy = false;
    }
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit(event.shiftKey);
    } else if (event.key === "Escape") {
      oncancel?.();
    }
  }
</script>

<div class="archivarious-capture">
  {#if oncalendar}
    <ModeSwitch bind:mode />
  {/if}
  <!-- svelte-ignore a11y_autofocus -->
  <textarea bind:value={text} {placeholder} {autofocus} {onkeydown} rows="4" disabled={busy}></textarea>
  {#if mode === "calendar" && oncalendar}
    <EventFields bind:when ontouch={() => (touched = true)} />
  {/if}
  {#if preview}
    <div class="archivarious-capture__preview">
      <strong>{preview.title}</strong>
      {#each preview.tags as tag (tag)}
        <span class="archivarious-capture__tag">#{tag}</span>
      {/each}
    </div>
  {/if}
  <div class="archivarious-capture__actions">
    <span class="archivarious-capture__hint">
      Ctrl/⌘ + Enter{#if onsubmitNow && mode === "note"}&nbsp;· разложить сейчас: + Shift{/if}
    </span>
    <div class="archivarious-capture__buttons">
      {#if mode === "calendar" && oncalendar}
        <button type="button" class="mod-cta" onclick={() => submit()} disabled={busy || !text.trim()}>В календарь</button>
      {:else}
        {#if onsubmitNow}
          <button type="button" onclick={() => submit(true)} disabled={busy || !text.trim()}>Разложить сейчас</button>
        {/if}
        <button type="button" class="mod-cta" onclick={() => submit()} disabled={busy || !text.trim()}>Сохранить</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .archivarious-capture {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  .archivarious-capture > :global(.archivarious-mode) {
    align-self: flex-start;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    font: inherit;
  }
  .archivarious-capture__preview {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    font-size: 0.85em;
    opacity: 0.8;
  }
  .archivarious-capture__tag {
    opacity: 0.7;
  }
  .archivarious-capture__actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .archivarious-capture__buttons {
    display: flex;
    gap: 0.4rem;
  }
  .archivarious-capture__hint {
    font-size: 0.8em;
    opacity: 0.6;
  }
</style>
