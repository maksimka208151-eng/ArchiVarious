<script lang="ts">
  import {
    appsScriptSource,
    type Capture,
    type EventWhen,
    isAppsScriptUrl,
    type SurveyAnswers,
    type SurveyQuestion,
    suggestWhen,
  } from "@archivarious/core";
  import { type CaptureMode, EventFields, Icon, ModeSwitch, Survey } from "@archivarious/ui";
  import { emit, listen } from "@tauri-apps/api/event";
  import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
  import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
  import { open } from "@tauri-apps/plugin-dialog";
  import { onMount } from "svelte";
  import {
    calendarConfig,
    fileCapture,
    loadSettings,
    loadVaultContext,
    prepareSurvey,
    readSharedSettings,
    saveSettings,
    sendCapture,
    sendToCalendar,
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
  const settingsDraft = () => ({
    vaultPath: settings.vaultPath,
    placement: settings.placement,
    calendarUrl: settings.calendarUrl,
    calendarKey: settings.calendarKey,
  });
  let draft = $state(settingsDraft());
  /** The plugin's calendar URL, shown as a hint when the widget has none of its own. */
  let pluginCalendarUrl = $state("");

  /** "Note" saves to the vault; "calendar" turns the text into a Google Calendar event at the picked time. */
  let mode = $state<CaptureMode>("note");
  let when = $state<EventWhen>(suggestWhen(""));
  /** Until the user picks a date or time by hand, they follow the text ("завтра в 15:00"). */
  let touched = false;
  $effect(() => {
    if (mode === "calendar" && !touched) when = suggestWhen(text);
  });

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

  async function toCalendar() {
    const raw = text.trim();
    if (!raw || busy) return;
    busy = true;
    flash("Отправляю в календарь…");
    try {
      const title = await sendToCalendar(raw, when, settings);
      text = "";
      touched = false;
      flash(`В календаре: ${title}`);
    } catch (error) {
      flash(`Календарь: ${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      busy = false;
      queueMicrotask(resize);
    }
  }

  async function save() {
    if (mode === "calendar") return toCalendar();
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
      if ((event.ctrlKey || event.metaKey) && mode === "note") void sortNow();
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
    const calendarUrl = draft.calendarUrl.trim();
    if (calendarUrl && !isAppsScriptUrl(calendarUrl)) {
      flash("Адрес календаря должен быть вида https://script.google.com/macros/s/…/exec", true);
      return;
    }
    settings.vaultPath = vaultPath;
    settings.placement = draft.placement;
    settings.calendarUrl = calendarUrl;
    settings.calendarKey = draft.calendarKey;
    saveSettings($state.snapshot(settings));
    contextPromise = null;
    status = { text: "", error: false };
    view = "bar";
    await place(true);
    input?.focus();
  }

  function openSettings() {
    draft = settingsDraft();
    view = "settings";
    void calendarConfig({ ...settings, calendarUrl: "", calendarKey: "" })
      .then((plugin) => (pluginCalendarUrl = plugin.url))
      .catch(() => {});
  }

  /** Copies the Apps Script with the key in use (the widget's, else the plugin's, else a new one). */
  async function copyScript() {
    let key = draft.calendarKey;
    if (!key) {
      const plugin = await calendarConfig({ ...settings, calendarUrl: "", calendarKey: "" }).catch(() => null);
      key = plugin?.key || crypto.randomUUID();
      draft.calendarKey = key;
    }
    try {
      await navigator.clipboard.writeText(appsScriptSource(key));
      flash("Скрипт скопирован: вставь его на script.google.com");
    } catch (error) {
      flash(`Не удалось скопировать: ${String(error)}`, true);
    }
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
        openSettings();
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
    <!-- The logo is the drag handle; the SVG ignores pointer events so the drag region gets the press. -->
    <span class="mark" data-tauri-drag-region title="Перетащить"><Icon name="logo" size={18} /></span>
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
        placeholder={mode === "calendar" ? "Что сделать и когда?" : "Что запомнить?"}
        spellcheck="false"
        disabled={busy}
      ></textarea>
      <ModeSwitch bind:mode compact />
      {#if settings.vaultPath && mode === "note"}
        <button
          type="button"
          class="icon"
          title="Разложить сейчас (Ctrl+Enter)"
          aria-label="Разложить сейчас"
          disabled={busy || !text.trim()}
          onclick={sortNow}><Icon name="bolt" /></button
        >
      {/if}
      <button type="button" class="icon" title="Настройки" aria-label="Настройки" onclick={openSettings}
        ><Icon name="settings" /></button
      >
    {:else}
      <strong class="title" data-tauri-drag-region>
        {view === "survey" ? (survey?.capture.title ?? "") : "Настройки"}
      </strong>
    {/if}
  </div>

  {#if view === "bar" && mode === "calendar"}
    <section class="panel calendar">
      <EventFields bind:when ontouch={() => (touched = true)} />
      <div class="actions">
        <button type="button" class="primary" disabled={busy || !text.trim()} onclick={toCalendar}
          ><Icon name="calendar" size={16} />В календарь</button
        >
      </div>
    </section>
  {:else if view === "survey" && survey}
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
      <fieldset>
        <legend>Google Календарь</legend>
        <span class="row">
          <input
            bind:value={draft.calendarUrl}
            placeholder={pluginCalendarUrl ? "берётся из настроек плагина" : "https://script.google.com/macros/s/…/exec"}
            aria-label="Адрес веб-приложения Google"
          />
          <button type="button" onclick={copyScript}>Скопировать скрипт</button>
        </span>
        <span class="hint">Скопируй скрипт, вставь его на script.google.com и опубликуй как веб-приложение (инструкция в начале скрипта), затем вставь сюда его адрес.</span>
      </fieldset>
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
  /*
   * Liquid glass: a translucent tinted pane with a bright top edge, a soft inner rim and a specular sheen.
   * On Windows the window itself has the acrylic effect (tauri.conf.json), which blurs the desktop behind
   * the pane; elsewhere the pane is simply more opaque (see App.svelte).
   */
  main {
    position: relative;
    box-sizing: border-box;
    padding: 6px 8px;
    border-radius: var(--radius);
    background: linear-gradient(160deg, var(--glass-hi) 0%, var(--glass) 55%, var(--glass-lo) 100%);
    box-shadow:
      inset 0 1px 0 var(--rim-top),
      inset 0 -1px 0 var(--rim-bottom),
      inset 0 0 0 1px var(--rim);
    overflow: hidden;
    user-select: none;
    color: var(--text);
  }
  main::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background:
      radial-gradient(120% 60% at 15% -20%, var(--sheen) 0%, transparent 60%),
      radial-gradient(80% 50% at 110% 120%, var(--sheen-lo) 0%, transparent 70%);
    pointer-events: none;
  }
  main > :global(*) {
    position: relative;
  }
  .header {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    min-height: 40px;
  }
  .mark {
    align-self: center;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    color: var(--accent);
    cursor: grab;
  }
  .title {
    align-self: center;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
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
  textarea::placeholder {
    color: var(--text-soft);
  }
  .header :global(.archivarious-mode) {
    align-self: center;
  }
  .icon {
    align-self: center;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--text-soft);
    cursor: pointer;
  }
  .icon:hover:not(:disabled) {
    background: var(--chip);
    color: var(--accent);
  }
  .icon:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 6px 4px 8px;
    border-top: 1px solid var(--line);
    margin-top: 4px;
  }
  .panel.calendar {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
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
    gap: 6px;
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
    font-size: 0.85em;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-soft);
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
    color: var(--text-soft);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
  .primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .status {
    padding: 0 8px 6px;
    font-size: 0.8em;
    color: var(--text-soft);
  }
  .status.error {
    color: var(--danger);
  }
</style>
