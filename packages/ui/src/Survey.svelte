<script lang="ts">
  import type { SurveyAnswers, SurveyQuestion } from "@archivarious/core";

  interface Props {
    questions: SurveyQuestion[];
    /** Preselected answers by question id. */
    defaults?: Record<string, string>;
    submitLabel?: string;
    skipLabel?: string;
    onanswer: (answers: SurveyAnswers) => void | Promise<void>;
    onskip: () => void | Promise<void>;
  }

  let { questions, defaults = {}, submitLabel = "Разложить", skipLabel = "Позже", onanswer, onskip }: Props = $props();

  // Each question starts on its preselected (or first) option, so a confident user answers with one click.
  const initial = () =>
    Object.fromEntries(
      questions.map((q) => [q.id, q.options.find((o) => o.value === defaults[q.id])?.value ?? q.options[0]?.value ?? ""]),
    );
  let answers = $state<Record<string, string>>(initial());
  let custom = $state("");
  let busy = $state(false);

  const folder = $derived(custom.trim() || answers.folder || "");

  async function submit() {
    if (busy || !folder) return;
    busy = true;
    try {
      await onanswer({
        folder,
        kind: (answers.kind ?? "fact") as SurveyAnswers["kind"],
        importance: Number(answers.importance ?? 1) as SurveyAnswers["importance"],
      });
    } finally {
      busy = false;
    }
  }

  // A keystroke that opened this survey (e.g. Ctrl+Enter in the input) can still be bubbling to the window
  // when the survey mounts; it must not answer the survey it just opened.
  const mountedAt = performance.now();

  function onkeydown(event: KeyboardEvent) {
    if (event.timeStamp < mountedAt) return;
    if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape") {
      void onskip();
    }
  }
</script>

<!-- Mounted only while a survey is open, so listening on the window is safe and works wherever the focus is. -->
<svelte:window {onkeydown} />

<div class="archivarious-survey">
  {#each questions as question (question.id)}
    <div class="archivarious-survey__question">
      <div class="archivarious-survey__prompt">{question.prompt}</div>
      <div class="archivarious-survey__options">
        {#each question.options as option (option.value)}
          <button
            type="button"
            class:is-selected={answers[question.id] === option.value && !(question.allowCustom && custom.trim())}
            onclick={() => {
              answers[question.id] = option.value;
              if (question.allowCustom) custom = "";
            }}>{option.label}</button
          >
        {/each}
      </div>
      {#if question.allowCustom}
        <input
          class="archivarious-survey__custom"
          type="text"
          placeholder="или своя папка…"
          aria-label="Своя папка"
          bind:value={custom}
        />
      {/if}
    </div>
  {/each}
  <div class="archivarious-survey__actions">
    <button type="button" onclick={() => onskip()} disabled={busy}>{skipLabel}</button>
    <button type="button" class="is-primary" onclick={submit} disabled={busy || !folder}>{submitLabel}</button>
  </div>
</div>

<style>
  .archivarious-survey {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .archivarious-survey__prompt {
    font-size: 0.8em;
    opacity: 0.7;
    margin-bottom: 0.25rem;
  }
  .archivarious-survey__options {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .archivarious-survey__options button.is-selected,
  .archivarious-survey__actions button.is-primary {
    background: var(--archivarious-accent, #5b3fd1);
    border-color: var(--archivarious-accent, #5b3fd1);
    color: #fff;
  }
  .archivarious-survey__custom {
    margin-top: 0.35rem;
    width: 100%;
    box-sizing: border-box;
  }
  .archivarious-survey__actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
  }
</style>
