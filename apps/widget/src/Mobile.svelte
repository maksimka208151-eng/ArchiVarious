<script lang="ts">
  import { QuickCapture } from "@archivarious/ui";
  import { loadSettings, saveSettings, sendCapture } from "./vault";

  let settings = $state(loadSettings());
  let showSettings = $state(!settings.vaultName);
  let status = $state("");

  async function onsubmit(raw: string) {
    try {
      await sendCapture(raw, { ...settings, vaultPath: "" }, "widget-mobile");
      status = "Отправлено в Obsidian";
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
    <form
      onsubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label>
        Имя хранилища Obsidian
        <input bind:value={settings.vaultName} placeholder="Brain" />
      </label>
      <button type="submit">Готово</button>
    </form>
  {:else}
    <QuickCapture {onsubmit} />
    <footer>
      <span>{status}</span>
      <button type="button" class="link" onclick={() => (showSettings = true)}>Настройки</button>
    </footer>
  {/if}
</main>

<style>
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
