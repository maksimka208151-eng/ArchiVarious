<script lang="ts">
  import { lightFormat } from "@archivarious/core";

  interface Props {
    /** Called with the raw text. The host decides how to persist it (vault API, file write, URI). */
    onsubmit: (raw: string) => void | Promise<void>;
    oncancel?: () => void;
    placeholder?: string;
    autofocus?: boolean;
  }

  let { onsubmit, oncancel, placeholder = "Что запомнить?", autofocus = true }: Props = $props();

  let text = $state("");
  let busy = $state(false);
  const preview = $derived(text.trim() ? lightFormat(text) : null);

  async function submit() {
    if (!text.trim() || busy) return;
    busy = true;
    try {
      await onsubmit(text);
      text = "";
    } finally {
      busy = false;
    }
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape") {
      oncancel?.();
    }
  }
</script>

<div class="archivarious-capture">
  <!-- svelte-ignore a11y_autofocus -->
  <textarea bind:value={text} {placeholder} {autofocus} {onkeydown} rows="4" disabled={busy}></textarea>
  {#if preview}
    <div class="archivarious-capture__preview">
      <strong>{preview.title}</strong>
      {#each preview.tags as tag (tag)}
        <span class="archivarious-capture__tag">#{tag}</span>
      {/each}
    </div>
  {/if}
  <div class="archivarious-capture__actions">
    <span class="archivarious-capture__hint">Ctrl/⌘ + Enter</span>
    <button type="button" onclick={submit} disabled={busy || !text.trim()}>Сохранить</button>
  </div>
</div>

<style>
  .archivarious-capture {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
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
  .archivarious-capture__hint {
    font-size: 0.8em;
    opacity: 0.6;
  }
</style>
