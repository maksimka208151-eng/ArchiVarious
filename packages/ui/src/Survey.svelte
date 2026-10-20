<script lang="ts">
  import { type SurveyAnswers, type SurveyQuestion, sectionPath } from "@archivarious/core";
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";

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

  const split = (path: string) => {
    const [top = "", ...rest] = sectionPath(path).split("/");
    return { top, rest: rest.join("/") };
  };

  // Read once on mount: a survey is built for one note and never re-targeted.
  const setup = () => {
    // The folder question is shown as two rows: section (top-level folder) and subsection (the rest of the path).
    const folderQuestion = questions.find((q) => q.id === "folder");
    const otherQuestions = questions.filter((q) => q.id !== "folder");
    // Each question starts on its preselected (or first) option, so a confident user answers with one click.
    const answers = Object.fromEntries(
      otherQuestions.map((q) => [
        q.id,
        q.options.find((o) => o.value === defaults[q.id])?.value ?? q.options[0]?.value ?? "",
      ]),
    );
    const paths = (folderQuestion?.options ?? []).map((o) => sectionPath(o.value)).filter(Boolean);
    const preset = sectionPath(defaults.folder ?? "");
    if (preset && !paths.includes(preset)) paths.unshift(preset);
    const { top, rest } = split(preset || paths[0] || "");
    return { folderQuestion, otherQuestions, answers, paths, section: top, sub: rest };
  };
  const init = setup();
  const { folderQuestion, otherQuestions } = init;

  let answers = $state<Record<string, string>>(init.answers);
  let busy = $state(false);
  let paths = $state<string[]>(init.paths);
  let created = $state<string[]>([]);
  let section = $state(init.section);
  let sub = $state(init.sub);

  const sections = $derived([...new Set(paths.map((p) => split(p).top))]);
  const subsections = $derived([
    ...new Set(paths.filter((p) => split(p).top === section && split(p).rest).map((p) => split(p).rest)),
  ]);
  const folder = $derived(section ? (sub ? `${section}/${sub}` : section) : "");

  /** Inline "new section" / "new subsection" field; the new folder is created when the note is filed. */
  let creating = $state<"section" | "sub" | null>(null);
  let newName = $state("");
  let newInput = $state<HTMLInputElement>();

  async function startCreating(kind: "section" | "sub") {
    creating = kind;
    newName = "";
    await tick();
    newInput?.focus();
  }

  function confirmCreating() {
    // Enter confirms and removes the field, which then blurs; that blur must not create the section again.
    if (!creating) return;
    const name = sectionPath(newName);
    newName = "";
    if (name) {
      const path = creating === "sub" && section ? `${section}/${name}` : name;
      if (!paths.includes(path)) paths.push(path);
      if (!created.includes(path)) created.push(path);
      ({ top: section, rest: sub } = split(path));
    }
    creating = null;
  }

  function onNewKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === "Escape") {
      // The window handler below would otherwise submit or skip the whole survey.
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Enter") confirmCreating();
      else creating = null;
    }
  }

  async function submit() {
    if (busy || !folder) return;
    if (creating) confirmCreating();
    busy = true;
    try {
      await onanswer({
        folder,
        kind: (answers.kind ?? "fact") as SurveyAnswers["kind"],
        importance: Number(answers.importance ?? 1) as SurveyAnswers["importance"],
        ...(created.length > 0 ? { createdSections: [...created] } : {}),
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
  {#if folderQuestion}
    <div class="archivarious-survey__question">
      <div class="archivarious-survey__prompt">{folderQuestion.prompt}</div>
      <div class="archivarious-survey__options">
        {#each sections as name (name)}
          <button
            type="button"
            class:is-selected={section === name}
            onclick={() => {
              if (section !== name) sub = "";
              section = name;
            }}>{name}</button
          >
        {/each}
        {#if folderQuestion.allowCustom && creating !== "section"}
          <button type="button" class="archivarious-survey__add" onclick={() => startCreating("section")}
            ><Icon name="plus" size={14} />раздел</button
          >
        {/if}
      </div>
      {#if section}
        <div class="archivarious-survey__prompt archivarious-survey__prompt--sub">Подраздел</div>
        <div class="archivarious-survey__options">
          <button type="button" class:is-selected={!sub} onclick={() => (sub = "")}>весь «{section}»</button>
          {#each subsections as name (name)}
            <button type="button" class:is-selected={sub === name} onclick={() => (sub = name)}>{name}</button>
          {/each}
          {#if folderQuestion.allowCustom && creating !== "sub"}
            <button type="button" class="archivarious-survey__add" onclick={() => startCreating("sub")}
              ><Icon name="plus" size={14} />подраздел</button
            >
          {/if}
        </div>
      {/if}
      {#if creating}
        <input
          bind:this={newInput}
          class="archivarious-survey__custom"
          type="text"
          placeholder={creating === "sub" ? `Новый подраздел в «${section}», Enter — добавить` : "Новый раздел, Enter — добавить"}
          aria-label={creating === "sub" ? "Новый подраздел" : "Новый раздел"}
          bind:value={newName}
          onkeydown={onNewKeydown}
          onblur={() => (newName.trim() ? confirmCreating() : (creating = null))}
        />
      {/if}
    </div>
  {/if}
  {#each otherQuestions as question (question.id)}
    <div class="archivarious-survey__question">
      <div class="archivarious-survey__prompt">{question.prompt}</div>
      <div class="archivarious-survey__options">
        {#each question.options as option (option.value)}
          <button
            type="button"
            class:is-selected={answers[question.id] === option.value}
            onclick={() => (answers[question.id] = option.value)}>{option.label}</button
          >
        {/each}
      </div>
    </div>
  {/each}
  <div class="archivarious-survey__actions">
    <button type="button" onclick={() => onskip()} disabled={busy}>{skipLabel}</button>
    <button type="button" class="is-primary" onclick={submit} disabled={busy || !folder}>{submitLabel}</button>
  </div>
</div>

<style>
  /* Colours come from the host through --archivarious-* variables; the defaults are the brand navy. */
  .archivarious-survey {
    --av-accent: var(--archivarious-accent, #113171);
    --av-on-accent: var(--archivarious-on-accent, #fff);
    --av-chip: var(--archivarious-chip, rgba(17, 49, 113, 0.06));
    --av-line: var(--archivarious-line, rgba(17, 49, 113, 0.18));
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .archivarious-survey__prompt {
    font-size: 0.72em;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    opacity: 0.6;
    margin-bottom: 0.35rem;
  }
  .archivarious-survey__options {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .archivarious-survey__options button {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    border: 1px solid var(--av-line);
    border-radius: 999px;
    background: var(--av-chip);
    color: inherit;
    box-shadow: none;
    padding: 0.3rem 0.8rem;
    font-size: 0.9em;
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s,
      color 0.15s;
  }
  .archivarious-survey__options button:hover {
    border-color: var(--av-accent);
  }
  .archivarious-survey__options button.is-selected,
  .archivarious-survey__actions button.is-primary {
    background: var(--av-accent);
    border-color: var(--av-accent);
    color: var(--av-on-accent);
  }
  .archivarious-survey__prompt--sub {
    margin-top: 0.5rem;
  }
  .archivarious-survey__options button.archivarious-survey__add {
    background: transparent;
    border-style: dashed;
    opacity: 0.8;
  }
  .archivarious-survey__custom {
    margin-top: 0.45rem;
    width: 100%;
    box-sizing: border-box;
  }
  .archivarious-survey__actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
  }
  .archivarious-survey__actions button {
    border-radius: 999px;
    padding: 0.35rem 1rem;
    cursor: pointer;
  }
</style>
