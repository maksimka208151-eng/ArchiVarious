<script lang="ts">
  import { QuickCapture } from "@archivarious/ui";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { platform } from "@tauri-apps/plugin-os";
  import { loadSettings, saveSettings, sendCapture } from "./vault";

  let settings = $state(loadSettings());
  let showSettings = $state(!settings.vaultPath && !settings.vaultName);
  let status = $state("");

  const os = platform();
  const isMobile = os === "android" || os === "ios";

  async function onsubmit(raw: string) {
    try {
      const via = await sendCapture(raw, settings, isMobile ? "widget-mobile" : "widget-desktop");
      status = via === "file" ? "Сохранено во входящие" : "Отправлено в Obsidian";
      if (!isMobile) await getCurrentWindow().hide();
    } catch (error) {
      status = `Ошибка: ${String(error)}`;
      throw error;
    }
  }

  function save() {
    saveSettings(settings);
    showSettings = false;
  }
</script>

<main>
  {#if showSettings}
    <form onsubmit={(e) => { e.preventDefault(); save(); }}>
      <label>
        Папка хранилища (путь)
        <input bind:value={settings.vaultPath} placeholder="/Users/me/Obsidian/Brain" />
      </label>
      <label>
        Имя хранилища (для мобильных)
        <input bind:value={settings.vaultName} placeholder="Brain" />
      </label>
      <label>
        Папка входящих
        <input bind:value={settings.inboxFolder} />
      </label>
      <button type="submit">Готово</button>
    </form>
  {:else}
    <QuickCapture {onsubmit} oncancel={() => !isMobile && getCurrentWindow().hide()} />
    <footer>
      <span>{status}</span>
      <button type="button" class="link" onclick={() => (showSettings = true)}>Настройки</button>
    </footer>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: system-ui, sans-serif;
    background: Canvas;
    color: CanvasText;
    color-scheme: light dark;
  }
  main {
    padding: 0.75rem;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  label {
    display: flex;
    flex-direction: column;
    font-size: 0.85em;
  }
  footer {
    display: flex;
    justify-content: space-between;
    margin-top: 0.5rem;
    font-size: 0.8em;
    opacity: 0.7;
  }
  .link {
    background: none;
    border: none;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
</style>
