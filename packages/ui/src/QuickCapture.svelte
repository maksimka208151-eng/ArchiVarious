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
    /**
     * When given, pictures pasted into the capture (a screenshot, an image from the clipboard) are saved by the
     * host, which returns the text to insert (an embed such as `![[ArchiVarious/Вложения/…png]]`).
     */
    onimage?: (data: ArrayBuffer, mime: string) => Promise<string>;
    oncancel?: () => void;
    placeholder?: string;
    autofocus?: boolean;
  }

  let {
    onsubmit,
    onsubmitNow,
    oncalendar,
    onimage,
    oncancel,
    placeholder = "Текст заметки",
    autofocus = true,
  }: Props = $props();

  /** The note is a title line and its text; `text` joins them the way a one-field capture would be written. */
  let title = $state("");
  let body = $state("");
  const text = $derived(
    title.trim() && body.trim() ? `${title.trim()}\n\n${body.trim()}` : title.trim() || body.trim(),
  );
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
      title = "";
      body = "";
      touched = false;
    } catch (error) {
      // The host has told the user what went wrong; the text stays so nothing is lost.
      console.warn("ArchiVarious: capture failed", error);
    } finally {
      busy = false;
    }
  }

  let bodyInput = $state<HTMLTextAreaElement>();

  /** Saves pasted pictures through the host and puts their embeds into the text at the cursor. */
  async function onpaste(event: ClipboardEvent) {
    const images = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (!onimage || images.length === 0) return;
    event.preventDefault();
    busy = true;
    try {
      const embeds: string[] = [];
      for (const image of images) embeds.push(await onimage(await image.arrayBuffer(), image.type));
      const at = bodyInput?.selectionStart ?? body.length;
      const insert = `${at > 0 && !body.slice(0, at).endsWith("\n") ? "\n" : ""}${embeds.join("\n")}\n`;
      body = body.slice(0, at) + insert + body.slice(at);
    } catch (error) {
      // The host has said what went wrong.
      console.warn("ArchiVarious: image paste failed", error);
    } finally {
      busy = false;
    }
  }

  function ontitlekeydown(event: KeyboardEvent) {
    // Enter in the title goes on to the note's text.
    if (event.key === "Enter" && !(event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      bodyInput?.focus();
    } else onkeydown(event);
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
  <input
    class="archivarious-capture__title"
    type="text"
    bind:value={title}
    placeholder={mode === "calendar" ? "Что сделать и когда?" : "Название"}
    aria-label="Название"
    {autofocus}
    onkeydown={ontitlekeydown}
    {onpaste}
    disabled={busy}
  />
  <textarea
    bind:this={bodyInput}
    bind:value={body}
    placeholder={mode === "calendar" ? "Подробности (необязательно)" : placeholder}
    aria-label="Текст заметки"
    {onkeydown}
    {onpaste}
    rows="6"
    disabled={busy}
  ></textarea>
  {#if mode === "calendar" && oncalendar}
    <EventFields bind:when ontouch={() => (touched = true)} />
  {/if}
  {#if preview && preview.tags.length > 0}
    <div class="archivarious-capture__preview">
      {#each preview.tags as tag (tag)}
        <span class="archivarious-capture__tag">#{tag}</span>
      {/each}
    </div>
  {/if}
  <div class="archivarious-capture__actions">
    <span class="archivarious-capture__hint">
      Ctrl/⌘ + Enter — сохранить{#if onsubmitNow && mode === "note"}, + Shift — разложить сейчас{/if}{#if onimage && mode === "note"}. Картинку можно вставить через Ctrl+V{/if}
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
  .archivarious-capture__title {
    width: 100%;
    box-sizing: border-box;
    font: inherit;
    font-size: 1.1em;
    font-weight: 600;
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
  .archivarious-capture__buttons :global(button.mod-cta) {
    background: var(--archivarious-accent, #113171);
    border-color: var(--archivarious-accent, #113171);
    color: var(--archivarious-on-accent, #fff);
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
