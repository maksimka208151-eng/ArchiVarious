<script lang="ts">
  import {
    appsScriptSource,
    type Capture,
    computeStats,
    type EventWhen,
    isAppsScriptUrl,
    parseReminders,
    type Reminder,
    reminderInstant,
    type SurveyAnswers,
    type SurveyQuestion,
    splitDue,
    suggestWhen,
    type VaultStats,
  } from "@archivarious/core";
  import { type CaptureMode, EventFields, Icon, ModeSwitch, Stats, Survey } from "@archivarious/ui";
  import { emit, listen } from "@tauri-apps/api/event";
  import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
  import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
  import { open } from "@tauri-apps/plugin-dialog";
  import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
  import { onMount, tick } from "svelte";
  import {
    answerItem,
    collectActivity,
    countDueInbox,
    folderOf,
    isDue,
    loadQueue,
    type Queue,
    type QueueItem,
    saveImage,
    snoozeItem,
  } from "./queue";
  import {
    calendarConfig,
    fileCapture,
    loadSettings,
    loadVaultContext,
    openInObsidian,
    prepareSurvey,
    readSharedSettings,
    saveSettings,
    sendCapture,
    sendToCalendar,
    surveyForCapture,
    type VaultContext,
  } from "./vault";

  const WIDTH = 460;

  let settings = $state(loadSettings());
  let view = $state<"bar" | "survey" | "settings" | "queue">(settings.vaultPath ? "bar" : "settings");
  let text = $state("");
  /** The note's own text under the title line; the field appears as soon as the title is typed. */
  let body = $state("");
  let expanded = $state(false);
  /** The note just filed, offered as "Открыть в Obsidian" so the user can keep writing in it. */
  let lastFiled = $state<string | null>(null);
  let bodyInput = $state<HTMLTextAreaElement>();
  let busy = $state(false);
  let status = $state({ text: "", error: false });
  /** The open survey: for the text just typed, or for an item of the inbox / review queue. */
  let survey = $state<{
    capture: Capture;
    questions: SurveyQuestion[];
    suggested?: string;
    item?: QueueItem;
    defaults?: Record<string, string>;
  } | null>(null);

  /** The inbox and review queue ("Разбор"), the items left in the current pass, and the statistics. */
  let queue = $state<Queue | null>(null);
  let pass = $state<QueueItem[]>([]);
  let tab = $state<"queue" | "stats">("queue");
  let stats = $state<VaultStats | null>(null);
  /** Inbox captures whose survey time has come; shown on the inbox button. */
  let dueCount = $state(0);

  /** Reminders the widget shows itself as a system notification. */
  const REMINDERS_KEY = "archivarious.reminders";
  let reminders = $state<Reminder[]>(parseReminders(localStorage.getItem(REMINDERS_KEY)));
  const upcoming = $derived(splitDue(reminders).upcoming);
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
    if ((mode === "calendar" || mode === "reminder") && !touched) when = suggestWhen(text);
  });

  let root: HTMLElement;
  let input = $state<HTMLTextAreaElement>();
  let contextPromise: Promise<VaultContext> | null = null;
  const showBody = $derived(view === "bar" && mode === "note" && (expanded || text.trim() !== "" || body.trim() !== ""));
  const hasText = $derived(Boolean(text.trim() || (showBody && body.trim())));
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
    lastFiled = null;
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

  /** The capture as one text: the bar is the first line (the note's title), the text field follows it. */
  function noteText(): string {
    const title = text.trim();
    const rest = showBody ? body.trim() : "";
    return title && rest ? `${title}\n\n${rest}` : title || rest;
  }

  function clearNote() {
    text = "";
    body = "";
    expanded = false;
  }

  async function openBody() {
    expanded = true;
    await tick();
    bodyInput?.focus();
  }

  async function save() {
    if (mode === "calendar") return toCalendar();
    if (mode === "reminder") return addReminder();
    const raw = noteText();
    if (!raw || busy) return;
    busy = true;
    try {
      await sendCapture(raw, settings, "widget-desktop");
      clearNote();
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
    const raw = noteText();
    if (!raw || busy || !settings.vaultPath) return;
    busy = true;
    flash("Читаю хранилище…");
    try {
      const { capture, questions, suggested } = prepareSurvey(raw, await vaultContext(), settings);
      survey = { capture, questions, suggested };
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
    if (survey.item) return answerQueued(survey.item, answers, survey.suggested);
    try {
      const result = await fileCapture(survey.capture, answers, await vaultContext(), settings, survey.suggested);
      settings.feedback = result.feedback;
      saveSettings($state.snapshot(settings));
      contextPromise = null;
      clearNote();
      survey = null;
      view = "bar";
      flash(`Разложено → ${result.path}`);
      lastFiled = result.path;
      // Long enough to reach "Открыть в Obsidian".
      window.clearTimeout(statusTimer);
      statusTimer = window.setTimeout(() => (status = { text: "", error: false }), 12000);
      queueMicrotask(resize);
    } catch (error) {
      flash(`Ошибка: ${String(error)}`, true);
    }
  }

  /** "Позже": nothing is lost, the note goes to the inbox and the plugin asks again after the usual delay. */
  async function later() {
    if (survey?.item) return laterQueued(survey.item);
    survey = null;
    view = "bar";
    await save();
  }

  // ── Разбор: the inbox and the reviews, one survey after another ──

  async function openQueue(which: "queue" | "stats" = "queue") {
    if (!settings.vaultPath || busy) return;
    busy = true;
    flash("Читаю хранилище…");
    try {
      contextPromise = null;
      const context = await vaultContext();
      queue = await loadQueue(settings, context);
      stats = computeStats(collectActivity(context, queue));
      dueCount = queue.inbox.filter((i) => isDue(i)).length;
      tab = which;
      view = "queue";
      status = { text: "", error: false };
    } catch (error) {
      flash(`Ошибка: ${String(error)}`, true);
    } finally {
      busy = false;
    }
  }

  function startPass(items: QueueItem[]) {
    pass = [...items];
    void nextInPass();
  }

  async function nextInPass() {
    const item = pass.shift();
    if (!item) {
      survey = null;
      await openQueue();
      flash("Готово: всё разобрано");
      return;
    }
    const context = await vaultContext();
    const review = item.kind === "review";
    const prepared = surveyForCapture(item.capture, context, settings, review ? folderOf(item.path) : undefined);
    survey = {
      capture: review ? { ...item.capture, title: `Пересмотр: ${item.capture.title}` } : item.capture,
      questions: prepared.questions,
      suggested: review ? undefined : prepared.suggested,
      item,
      defaults: review ? { ...item.defaults, folder: folderOf(item.path) } : {},
    };
    view = "survey";
  }

  async function answerQueued(item: QueueItem, answers: SurveyAnswers, suggested?: string) {
    try {
      const result = await answerItem(item, answers, await vaultContext(), settings, suggested);
      if (result.feedback) {
        settings.feedback = result.feedback;
        saveSettings($state.snapshot(settings));
      }
      contextPromise = null;
      flash(`Разложено → ${result.path}`);
      await nextInPass();
    } catch (error) {
      flash(`Ошибка: ${String(error)}`, true);
    }
  }

  async function laterQueued(item: QueueItem) {
    try {
      await snoozeItem(item, await vaultContext(), settings);
      await nextInPass();
    } catch (error) {
      flash(`Ошибка: ${String(error)}`, true);
    }
  }

  function back() {
    pass = [];
    survey = null;
    view = "bar";
    void refreshDue();
  }

  /** How many inbox captures are due; cheap (reads only the inbox folder). */
  async function refreshDue() {
    if (!settings.vaultPath) return;
    try {
      const due = await countDueInbox(settings);
      if (due > dueCount && due > 0) notify("Пора разобрать записи", `Ждут опроса: ${due}. Открой виджет и нажми «Разбор».`);
      dueCount = due;
    } catch {
      // The vault may be unavailable for a moment (sync, unplugged drive); the next check tries again.
    }
  }

  // ── Напоминания ──

  function storeReminders() {
    localStorage.setItem(REMINDERS_KEY, JSON.stringify($state.snapshot(reminders)));
  }

  function addReminder() {
    const raw = text.trim();
    if (!raw || !when.time) return;
    reminders.push({ id: crypto.randomUUID(), text: raw, at: reminderInstant(when.date, when.time) });
    storeReminders();
    text = "";
    touched = false;
    flash(`Напомню ${new Date(reminderInstant(when.date, when.time)).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`);
  }

  function removeReminder(id: string) {
    reminders = reminders.filter((r) => r.id !== id);
    storeReminders();
  }

  let notificationsAllowed: boolean | null = null;
  async function notify(title: string, message: string) {
    try {
      if (notificationsAllowed === null) {
        notificationsAllowed = (await isPermissionGranted()) || (await requestPermission()) === "granted";
      }
      if (notificationsAllowed) sendNotification({ title, body: message });
    } catch (error) {
      console.warn("notification failed", error);
    }
  }

  function checkReminders() {
    const { due } = splitDue(reminders);
    if (due.length === 0) return;
    for (const reminder of due) void notify("Напоминание", reminder.text);
    reminders = reminders.filter((r) => !due.includes(r));
    storeReminders();
  }

  // ── Картинки из буфера ──

  async function onpaste(event: ClipboardEvent) {
    const images = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (images.length === 0 || !settings.vaultPath || mode !== "note") return;
    event.preventDefault();
    busy = true;
    try {
      const embeds: string[] = [];
      for (const image of images) embeds.push(await saveImage(await image.arrayBuffer(), image.type, settings));
      const at = event.target === bodyInput ? (bodyInput?.selectionStart ?? body.length) : body.length;
      const insert = `${at > 0 && !body.slice(0, at).endsWith("\n") ? "\n" : ""}${embeds.join("\n")}\n`;
      body = body.slice(0, at) + insert + body.slice(at);
      expanded = true;
      flash(images.length > 1 ? "Картинки добавлены" : "Картинка добавлена");
    } catch (error) {
      flash(`Картинка: ${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      busy = false;
    }
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && event.shiftKey && mode === "note") {
      // Shift+Enter goes on to the note's text instead of a second line in the bar.
      event.preventDefault();
      void openBody();
    } else if (event.key === "Enter" && !event.shiftKey) {
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

    // Reminders are checked every 20 s (and right away, for ones missed while the computer was off);
    // due surveys every 5 minutes.
    checkReminders();
    void refreshDue();
    const reminderTimer = window.setInterval(checkReminders, 20_000);
    const dueTimer = window.setInterval(() => void refreshDue(), 5 * 60_000);
    cleanups.push(() => {
      window.clearInterval(reminderTimer);
      window.clearInterval(dueTimer);
    });

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
        {onpaste}
        rows="1"
        placeholder={mode === "calendar" ? "Что сделать и когда?" : mode === "reminder" ? "О чём напомнить?" : "Название заметки"}
        spellcheck="false"
        disabled={busy}
      ></textarea>
      <ModeSwitch bind:mode modes={["note", "calendar", "reminder"]} compact />
      {#if settings.vaultPath && mode === "note"}
        <button
          type="button"
          class="icon"
          title="Разложить сейчас (Ctrl+Enter)"
          aria-label="Разложить сейчас"
          disabled={busy || !hasText}
          onclick={sortNow}><Icon name="bolt" /></button
        >
      {/if}
      {#if settings.vaultPath}
        <button
          type="button"
          class="icon badge-host"
          title="Разбор и статистика"
          aria-label={dueCount > 0 ? `Разбор: ждут ${dueCount}` : "Разбор и статистика"}
          disabled={busy}
          onclick={() => openQueue()}
          ><Icon name="inbox" />{#if dueCount > 0}<span class="badge">{dueCount}</span>{/if}</button
        >
      {/if}
      <button type="button" class="icon" title="Настройки" aria-label="Настройки" onclick={openSettings}
        ><Icon name="settings" /></button
      >
    {:else}
      <strong class="title" data-tauri-drag-region>
        {view === "survey" ? (survey?.capture.title ?? "") : view === "queue" ? "Разбор" : "Настройки"}
      </strong>
      {#if view === "survey" || view === "queue"}
        <button type="button" class="icon" title="Назад" aria-label="Назад" onclick={back}><Icon name="back" /></button>
      {/if}
    {/if}
  </div>

  {#if showBody}
    <section class="panel">
      <textarea
        bind:this={bodyInput}
        bind:value={body}
        class="body"
        rows="6"
        placeholder="Текст заметки (необязательно). Картинку или скриншот можно вставить через Ctrl+V"
        spellcheck="false"
        {onpaste}
        disabled={busy}
        onkeydown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void save();
          } else if (event.key === "Escape") {
            dismiss();
          }
        }}
      ></textarea>
      <div class="actions">
        <span class="hint">Ctrl+Enter — сохранить</span>
        {#if settings.vaultPath}
          <button type="button" disabled={busy || !hasText} onclick={sortNow}
            ><Icon name="bolt" size={16} />Разложить</button
          >
        {/if}
        <button type="button" class="primary" disabled={busy || !hasText} onclick={save}
          ><Icon name="check" size={16} />Сохранить</button
        >
      </div>
    </section>
  {:else if view === "bar" && mode === "calendar"}
    <section class="panel calendar">
      <EventFields bind:when ontouch={() => (touched = true)} />
      <div class="actions">
        <button type="button" class="primary" disabled={busy || !text.trim()} onclick={toCalendar}
          ><Icon name="calendar" size={16} />В календарь</button
        >
      </div>
    </section>
  {:else if view === "bar" && mode === "reminder"}
    <section class="panel">
      <div class="panel calendar flat">
        <EventFields bind:when reminder ontouch={() => (touched = true)} />
        <button type="button" class="primary" disabled={busy || !text.trim()} onclick={addReminder}
          ><Icon name="bell" size={16} />Напомнить</button
        >
      </div>
      {#if upcoming.length > 0}
        <ul class="reminders">
          {#each upcoming as reminder (reminder.id)}
            <li>
              <span class="when"
                >{new Date(reminder.at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span
              >
              <span class="what">{reminder.text}</span>
              <button type="button" class="icon small" title="Удалить" aria-label="Удалить напоминание" onclick={() => removeReminder(reminder.id)}
                ><Icon name="close" size={14} /></button
              >
            </li>
          {/each}
        </ul>
      {:else}
        <span class="hint">Виджет покажет уведомление Windows в назначенное время. Он должен быть запущен (включи автозапуск в настройках).</span>
      {/if}
    </section>
  {:else if view === "survey" && survey}
    <section class="panel">
      {#if survey.item && pass.length > 0}
        <span class="hint">Ещё в очереди: {pass.length}</span>
      {/if}
      <blockquote>{survey.capture.body}</blockquote>
      {#key survey}
        <Survey questions={survey.questions} defaults={survey.defaults} onanswer={answer} onskip={later} />
      {/key}
    </section>
  {:else if view === "queue" && queue}
    {@const dueInbox = queue.inbox.filter((i) => isDue(i))}
    {@const dueReviews = queue.reviews.filter((i) => isDue(i))}
    <section class="panel">
      <div class="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "queue"} onclick={() => (tab = "queue")}
          ><Icon name="inbox" size={15} />Разбор</button
        >
        <button type="button" role="tab" aria-selected={tab === "stats"} onclick={() => (tab = "stats")}
          ><Icon name="chart" size={15} />Статистика</button
        >
      </div>
      {#if tab === "queue"}
        <div class="queue-row">
          <div>
            <strong>Входящие: {queue.inbox.length}</strong>
            <span class="hint">{dueInbox.length > 0 ? `пора разобрать: ${dueInbox.length}` : "опрос ещё не наступил"}</span>
          </div>
          <span class="row">
            {#if dueInbox.length > 0 && dueInbox.length < queue.inbox.length}
              <button type="button" onclick={() => startPass(dueInbox)}>Только пора</button>
            {/if}
            <button type="button" class="primary" disabled={queue.inbox.length === 0} onclick={() => startPass(queue?.inbox ?? [])}
              >Разобрать</button
            >
          </span>
        </div>
        <div class="queue-row">
          <div>
            <strong>Пересмотр: {dueReviews.length}</strong>
            <span class="hint">{queue.reviews.length > 0 ? `всего заметок с пересмотром: ${queue.reviews.length}` : "разложенные заметки вернутся через неделю"}</span>
          </div>
          <span class="row">
            {#if dueReviews.length < queue.reviews.length}
              <button type="button" onclick={() => startPass(queue?.reviews ?? [])}>Все сразу</button>
            {/if}
            <button type="button" class="primary" disabled={dueReviews.length === 0} onclick={() => startPass(dueReviews)}
              >Пересмотреть</button
            >
          </span>
        </div>
      {:else if stats}
        <Stats {stats} />
      {/if}
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
      <p class="hint">Время опроса и тихие часы задаются в настройках плагина в Obsidian, виджет берёт их оттуда.</p>
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
    <div class="status" class:error={status.error} role="status">
      {status.text}
      {#if lastFiled && !status.error}
        <button type="button" class="link" onclick={() => lastFiled && void openInObsidian(lastFiled, settings)}
          >Открыть в Obsidian</button
        >
      {/if}
    </div>
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
    align-items: center;
    gap: 6px;
  }
  .actions button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .hint {
    margin-right: auto;
    font-size: 0.8em;
    color: var(--text-soft);
  }
  textarea.body {
    flex: none;
    max-height: 240px;
    padding: 8px 10px;
    border-radius: 12px;
    background: var(--chip);
    font-size: 14px;
    overflow-y: auto;
  }
  .badge-host {
    position: relative;
  }
  .badge {
    position: absolute;
    top: -2px;
    right: -3px;
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    box-sizing: border-box;
    border-radius: 999px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 10px;
    line-height: 15px;
    text-align: center;
  }
  .flat {
    padding: 0;
    margin: 0;
    border: none;
  }
  .reminders {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 180px;
    overflow-y: auto;
  }
  .reminders li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 2px;
    border-top: 1px solid var(--line);
    font-size: 0.9em;
  }
  .reminders .when {
    flex: none;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  .reminders .what {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .icon.small {
    width: 24px;
    height: 24px;
  }
  .tabs {
    display: flex;
    gap: 4px;
  }
  .tabs button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: none;
    background: transparent;
    color: var(--text-soft);
  }
  .tabs button[aria-selected="true"] {
    background: var(--chip);
    color: var(--accent);
  }
  .queue-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 2px;
    border-top: 1px solid var(--line);
  }
  .queue-row > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .link {
    margin-left: 6px;
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
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
