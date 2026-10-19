<script lang="ts">
  
  import type { Capture, SurveyAnswers, SurveyQuestion } from "@archivarious/core";
import { Survey } from "@archivarious/ui";
  import { emit, listen } from "@tauri-apps/api/event";
  import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
  import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
  import { open } from "@tauri-apps/plugin-dialog";
  import { onMount } from "svelte";
  import {
    fileCapture,
    loadSettings,
    loadVaultContext,
    prepareSurvey,
    readSharedSettings,
    saveSettings,
    sendCapture,
    type VaultContext,
  } from "./vault";

  const WIDTH = 460;

  let settings = $state(loadSettings());
  let view = $state<"bar" | "survey" | "settings">(settings.vaultPath ? "bar" : "settings");
  let text = $state("");
  let busy = $state(false);
  let status = $state({ text: "", error: false });
  let survey = $state<{ capture: Capture; questions: SurveyQuestion[] } | null>(null);
  let autostart = $state(false);
  let draft = $state({ vaultPath: settings.vaultPath, placement: settings.placement });

  let root: HTMLElement;
  let input = $state<HTMLTextAreaElement>();
  let contextPromise: Promise<VaultContext> | null = null;
  let statusTimer: number | undefined;

  const win = getCurrentWindow();

  /**
   * Brings the widget to the front (summoned) or puts it back where the user wants it to live.
   * Calls are queued and only the latest wish is applied, so a focus change racing with a summon
   * can never leave the window in the wrong layer.
   */
  let wantFront = false;
  let placing: Promise<void> = Promise.resolve();
  function place(front: boolean): Promise<void> {
    wantFront = front;
    placing = placing.then(async () => {
      try {
        if (wantFront || settings.placement === "top") {
          await win.setAlwaysOnBottom(false);
          await win.setAlwaysOnTop(true);
        } else {
          await win.setAlwaysOnTop(false);
          await win.setAlwaysOnBottom(true);
        }
      } catch (error) {
        console.warn("window placement failed", error);
      }
    });
    return placing;
  }

  function flash(message: string, error = false) {
    status = { text: message, error };
    window.clearTimeout(statusTimer);
    if (!error) statusTimer = window.setTimeout(() => (status = { text: "", error: false }), 3500);
  }

  /** Reads the vault in the background as soon as the user starts typing, so "sort now" has no wait. */
  function vaultContext(): Promise<VaultContext> {
    if (!contextPromise) {
      contextPromise = loadVaultContext(settings.vaultPath);
      contextPromise.catch(() => {
        contextPromise = null;
      });
    }
    return contextPromise;
  }

  function resize() {
    if (input) {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 96)}px`;
    }
  }

  async function save() {
    const raw = text.trim();
    if (!raw || busy) return;
    busy = true;
    try {
      await sendCapture(raw, settings, "widget-desktop");
      text = "";
      contextPromise = null;
      flash("Сохранено во входящие");
    } catch (error) {
      flash(`Ошибка: ${String(error)}`, true);
    } finally {
      busy = false;
      queueMicrotask(resize);
    }
  }

  async function sortNow() {
    const raw = text.trim();
    if (!raw || busy || !settings.vaultPath) return;
    busy = true;
    flash("Читаю хранилище…");
    try {
      const { capture, questions } = prepareSurvey(raw, await vaultContext(), settings);
      survey = { capture, questions };
      view = "survey";
      status = { text: "", error: false };
    } catch (error) {
      flash(`Ошибка: ${String(error)}`, true);
    } finally {
      busy = false;
    }
  }

  async function answer(answers: SurveyAnswers) {
    if (!survey) return;
    try {
      const result = await fileCapture(survey.capture, answers, await vaultContext(), settings);
      settings.feedback = result.feedback;
      saveSettings($state.snapshot(settings));
      contextPromise = null;
      text = "";
      survey = null;
      view = "bar";
      flash(`Разложено → ${result.path}`);
      queueMicrotask(resize);
    } catch (error) {
      flash(`Ошибка: ${String(error)}`, true);
    }
  }

  /** "Позже": nothing is lost, the note goes to the inbox and the plugin asks again after the usual delay. */
  async function later() {
    survey = null;
    view = "bar";
    await save();
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey) void sortNow();
      else void save();
    } else if (event.key === "Escape") {
      dismiss();
    }
  }

  /** Esc (here) or the hotkey (in Rust) are the only ways to put the summoned widget back. */
  function dismiss() {
    void place(false);
    void emit("dismissed");
  }

  async function chooseFolder() {
    const picked = await open({ directory: true, multiple: false, title: "Папка хранилища Obsidian" });
    if (typeof picked === "string") draft.vaultPath = picked;
  }

  async function saveSettingsForm() {
    const vaultPath = draft.vaultPath.trim();
    try {
      if (vaultPath) await readSharedSettings(vaultPath);
    } catch {
      flash("Папка хранилища не найдена", true);
      return;
    }
    settings.vaultPath = vaultPath;
    settings.placement = draft.placement;
    saveSettings($state.snapshot(settings));
    contextPromise = null;
    status = { text: "", error: false };
    view = "bar";
    await place(true);
    input?.focus();
  }

  async function toggleAutostart(enabled: boolean) {
    try {
      if (enabled) await enable();
      else await disable();
      autostart = enabled;
    } catch (error) {
      autostart = !enabled;
      flash(`Автозапуск: ${String(error)}`, true);
    }
  }

  onMount(() => {
    const cleanups: Array<() => void> = [];
    void isEnabled().then((value) => (autostart = value)).catch(() => {});
    void place(false);

    // The window height follows the content: a single bar, the survey, or the settings form.
    const observer = new ResizeObserver(() => {
      void win.setSize(new LogicalSize(WIDTH, Math.ceil(root.getBoundingClientRect().height))).catch(() => {});
    });
    observer.observe(root);
    cleanups.push(() => observer.disconnect());

    void listen<boolean>("summon", (event) => {
      contextPromise = null;
      void place(true);
      if (event.payload) {
        draft = { vaultPath: settings.vaultPath, placement: settings.placement };
        view = "settings";
      } else {
        input?.focus();
      }
    }).then((unlisten) => cleanups.push(unlisten));
    // Losing focus does not put the widget back: on Windows, dragging the bar briefly moves focus from the
    // webview to the window, which used to send the widget under other windows mid-drag.
    void listen("dismiss", () => void place(false)).then((unlisten) => cleanups.push(unlisten));
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  });
</script>

<main bind:this={root}>
  <div class="header" data-tauri-drag-region>
    <span class="grip" data-tauri-drag-region aria-hidden="true">⋮⋮</span>
    {#if view === "bar"}
      <textarea
        bind:this={input}
        bind:value={text}
        {onkeydown}
        oninput={() => {
          resize();
          if (settings.vaultPath) void vaultContext();
        }}
        rows="1"
        placeholder="Что запомнить?"
        spellcheck="false"
        disabled={busy}
      ></textarea>
      {#if settings.vaultPath}
        <button type="button" class="icon" title="Разложить сейчас (Ctrl+Enter)" disabled={busy || !text.trim()} onclick={sortNow}>
          ⚡
        </button>
      {/if}
      <button type="button" class="icon" title="Настройки" onclick={() => { draft = { vaultPath: settings.vaultPath, placement: settings.placement }; view = "settings"; }}>
        ⚙
      </button>
    {:else}
      <strong class="title" data-tauri-drag-region>
        {view === "survey" ? (survey?.capture.title ?? "") : "Настройки"}
      </strong>
    {/if}
  </div>

  {#if view === "survey" && survey}
    <section class="panel">
      <blockquote>{survey.capture.body}</blockquote>
      <Survey questions={survey.questions} onanswer={answer} onskip={later} />
    </section>
  {:else if view === "settings"}
    <form
      class="panel"
      onsubmit={(event) => {
        event.preventDefault();
        void saveSettingsForm();
      }}
    >
      <label>
        Папка хранилища Obsidian
        <span class="row">
          <input bind:value={draft.vaultPath} placeholder="C:\Users\Max\Documents\Brain" />
          <button type="button" onclick={chooseFolder}>Выбрать…</button>
        </span>
      </label>
      <fieldset>
        <legend>Где живёт виджет</legend>
        <label class="inline"><input type="radio" bind:group={draft.placement} value="desktop" /> На рабочем столе, под окнами</label>
        <label class="inline"><input type="radio" bind:group={draft.placement} value="top" /> Поверх всех окон</label>
      </fieldset>
      <label class="inline">
        <input type="checkbox" checked={autostart} onchange={(event) => toggleAutostart(event.currentTarget.checked)} />
        Запускать вместе с Windows
      </label>
      <p class="hint">Вызвать виджет: Ctrl+Shift+Space или иконка в трее. Он остаётся поверх окон, пока не нажмёшь Esc или снова Ctrl+Shift+Space.</p>
      <div class="actions">
        {#if settings.vaultPath}
          <button type="button" onclick={() => (view = "bar")}>Отмена</button>
        {/if}
        <button type="submit" class="primary">Готово</button>
      </div>
    </form>
  {/if}

  {#if status.text && (view !== "settings" || status.error)}
    <div class="status" class:error={status.error} role="status">{status.text}</div>
  {/if}
</main>

<style>
  main {
    --card: rgba(255, 255, 255, 0.94);
    --line: rgba(128, 128, 128, 0.35);
    --accent: #5b3fd1;
    box-sizing: border-box;
    padding: 6px 8px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--card);
    overflow: hidden;
    user-select: none;
  }
  @media (prefers-color-scheme: dark) {
    main {
      --card: rgba(36, 36, 38, 0.94);
    }
  }
  .header {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    min-height: 40px;
  }
  .grip {
    align-self: center;
    padding: 0 2px;
    opacity: 0.4;
    cursor: grab;
    letter-spacing: -3px;
  }
  .title {
    align-self: center;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  textarea {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    resize: none;
    border: none;
    outline: none;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 15px;
    line-height: 1.4;
    padding: 9px 4px;
    user-select: text;
  }
  .icon {
    align-self: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font-size: 16px;
    cursor: pointer;
  }
  .icon:hover:not(:disabled) {
    background: rgba(128, 128, 128, 0.18);
  }
  .icon:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 4px 4px 8px;
  }
  blockquote {
    margin: 0;
    padding: 2px 10px;
    border-left: 3px solid var(--accent);
    font-size: 0.9em;
    max-height: 4.5em;
    overflow: hidden;
    white-space: pre-wrap;
    user-select: text;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.85em;
  }
  label.inline {
    flex-direction: row;
    align-items: center;
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.85em;
  }
  legend {
    padding: 0;
    margin-bottom: 4px;
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .row input {
    flex: 1;
    min-width: 0;
  }
  .hint {
    margin: 0;
    font-size: 0.78em;
    opacity: 0.65;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .status {
    padding: 0 8px 6px;
    font-size: 0.8em;
    opacity: 0.75;
  }
  .status.error {
    color: #d13438;
    opacity: 1;
  }
</style>
