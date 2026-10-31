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

  const segments = (path: string) => sectionPath(path).split("/").filter(Boolean);

  // Read once on mount: a survey is built for one note and never re-targeted.
  const setup = () => {
    // The folder question is shown as one row per level: the top-level folders, then the folders inside the
    // chosen one, and so on, so sections can be nested as deep as the user wants.
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
    return { folderQuestion, otherQuestions, answers, paths, chain: segments(preset || paths[0] || "") };
  };
  const init = setup();
  const { folderQuestion, otherQuestions } = init;

  let answers = $state<Record<string, string>>(init.answers);
  let busy = $state(false);
  let paths = $state<string[]>(init.paths);
  let created = $state<string[]>([]);
  /** The chosen folder, one name per level: `["Учеба", "Математика"]`. */
  let chain = $state<string[]>(init.chain);

  /** Folder names directly inside `parent` (the top level for `[]`), from every known path and its parents. */
  const childrenOf = (parent: string[]) => {
    const names: string[] = [];
    for (const p of paths) {
      const parts = segments(p);
      const name = parts[parent.length];
      if (name && parent.every((n, i) => parts[i] === n) && !names.includes(name)) names.push(name);
    }
    return names;
  };
  /** Rows to show: the top level, then one row inside each chosen folder. */
  const levels = $derived(Array.from({ length: chain.length + 1 }, (_, i) => chain.slice(0, i)));
  const folder = $derived(chain.join("/"));

  /** Options of a question for the chosen folder (the notes to append to depend on it). */
  const optionsOf = (question: SurveyQuestion) => question.optionsByFolder?.[folder] ?? question.options;

  /** Inline "new folder" field at one level; the folder is created when the note is filed. */
  let creating = $state<number | null>(null);
  let newName = $state("");
  let newInput = $state<HTMLInputElement>();

  async function startCreating(level: number) {
    creating = level;
    newName = "";
    await tick();
    newInput?.focus();
  }

  function confirmCreating() {
    // Enter confirms and removes the field, which then blurs; that blur must not create the folder again.
    if (creating === null) return;
    const name = sectionPath(newName);
    newName = "";
    if (name) {
      const next = [...chain.slice(0, creating), ...segments(name)];
      const path = next.join("/");
      if (!paths.includes(path)) paths.push(path);
      if (!created.includes(path)) created.push(path);
      chain = next;
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

  /** The note the capture is added to; empty (a new note) unless it is one of the folder's notes. */
  const appendQuestion = otherQuestions.find((q) => q.id === "append");
  const appendTo = $derived(
    appendQuestion && optionsOf(appendQuestion).some((o) => o.value === answers.append && o.value !== "")
      ? answers.append
      : "",
  );

  async function submit() {
    if (busy || !folder) return;
    if (creating !== null) confirmCreating();
    busy = true;
    try {
      await onanswer({
        folder,
        kind: (answers.kind ?? "fact") as SurveyAnswers["kind"],
        importance: Number(answers.importance ?? 1) as SurveyAnswers["importance"],
        ...(created.length > 0 ? { createdSections: [...created] } : {}),
        ...(appendTo ? { appendTo } : {}),
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
      {#each levels as parent, level (parent.join("/"))}
        <div class="archivarious-survey__prompt" class:archivarious-survey__prompt--sub={level > 0}>
          {level === 0 ? folderQuestion.prompt : `Внутри «${parent[parent.length - 1]}»`}
        </div>
        <div class="archivarious-survey__options">
          {#if level > 0}
            <button type="button" class:is-selected={chain.length === level} onclick={() => (chain = parent)}
              >прямо в «{parent[parent.length - 1]}»</button
            >
          {/if}
          {#each childrenOf(parent) as name (name)}
            <button
              type="button"
              class:is-selected={chain[level] === name}
              onclick={() => (chain = [...parent, name])}>{name}</button
            >
          {/each}
          {#if folderQuestion.allowCustom && creating !== level}
            <button type="button" class="archivarious-survey__add" onclick={() => startCreating(level)}
              ><Icon name="plus" size={14} />{level === 0 ? "раздел" : "подраздел"}</button
            >
          {/if}
        </div>
        {#if creating === level}
          <input
            bind:this={newInput}
            class="archivarious-survey__custom"
            type="text"
            placeholder={level === 0 ? "Новый раздел, Enter — добавить" : `Новый подраздел в «${parent[parent.length - 1]}», Enter — добавить`}
            aria-label={level === 0 ? "Новый раздел" : "Новый подраздел"}
            bind:value={newName}
            onkeydown={onNewKeydown}
            onblur={() => (newName.trim() ? confirmCreating() : (creating = null))}
          />
        {/if}
      {/each}
    </div>
  {/if}
  {#each otherQuestions as question (question.id)}
    <!-- The "В заметку" row is only shown when the chosen folder has notes to add to. -->
    {#if optionsOf(question).length > 1 || !question.optionsByFolder}
      <div class="archivarious-survey__question">
        <div class="archivarious-survey__prompt">{question.prompt}</div>
        <div class="archivarious-survey__options">
          {#each optionsOf(question) as option (option.value)}
            <button
              type="button"
              class:is-selected={answers[question.id] === option.value}
              onclick={() => (answers[question.id] = option.value)}>{option.label}</button
            >
          {/each}
        </div>
      </div>
    {/if}
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
