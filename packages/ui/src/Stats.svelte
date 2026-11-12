<script lang="ts">
  import type { VaultStats } from "@archivarious/core";
  import Icon from "./Icon.svelte";

  interface Props {
    stats: VaultStats;
  }

  let { stats }: Props = $props();

  const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  const weekday = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00`).getDay()] ?? "";
  const max = $derived(Math.max(1, ...stats.days.map((d) => d.count)));
  const diff = $derived(stats.thisWeek - stats.lastWeek);

  /** 1 день, 2 дня, 5 дней. */
  function days(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return `${n} день`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} дня`;
    return `${n} дней`;
  }
</script>

<div class="archivarious-stats">
  <div class="archivarious-stats__tiles">
    <div class="archivarious-stats__tile">
      <span class="archivarious-stats__label">Записей за неделю</span>
      <strong>{stats.thisWeek}</strong>
      <span class="archivarious-stats__note"
        >{diff === 0 ? "как на прошлой" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)} к прошлой`}</span
      >
    </div>
    <div class="archivarious-stats__tile">
      <span class="archivarious-stats__label"><Icon name="flame" size={14} />Серия</span>
      <strong>{days(stats.streak)}</strong>
      <span class="archivarious-stats__note"
        >{stats.activeToday || stats.streak === 0 ? `рекорд: ${days(stats.bestStreak)}` : "запиши что-нибудь сегодня"}</span
      >
    </div>
    <div class="archivarious-stats__tile">
      <span class="archivarious-stats__label">Точность подсказок</span>
      <strong>{stats.accuracy === null ? "—" : `${Math.round(stats.accuracy * 100)}%`}</strong>
      <span class="archivarious-stats__note"
        >{stats.surveys > 0 ? `по ${stats.surveys} опросам` : "появится после опросов"}</span
      >
    </div>
  </div>

  <div class="archivarious-stats__bars" role="img" aria-label="Записи по дням за неделю">
    {#each stats.days as day (day.date)}
      <div class="archivarious-stats__bar">
        <span class="archivarious-stats__count">{day.count || ""}</span>
        <span class="archivarious-stats__fill" style:height={`${(day.count / max) * 100}%`}></span>
        <span class="archivarious-stats__day">{weekday(day.date)}</span>
      </div>
    {/each}
  </div>

  <div>
    <span class="archivarious-stats__label">Растут быстрее всего</span>
    {#if stats.growing.length === 0}
      <p class="archivarious-stats__note">За неделю ещё ничего не разложено.</p>
    {:else}
      <ol class="archivarious-stats__growing">
        {#each stats.growing as section (section.folder)}
          <li><span>{section.folder}</span><strong>+{section.added}</strong></li>
        {/each}
      </ol>
    {/if}
  </div>
</div>

<style>
  .archivarious-stats {
    --av-accent: var(--archivarious-accent, #113171);
    --av-chip: var(--archivarious-chip, rgba(17, 49, 113, 0.08));
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .archivarious-stats__tiles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .archivarious-stats__tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px;
    border-radius: 12px;
    background: var(--av-chip);
  }
  .archivarious-stats__tile strong {
    font-size: 1.4em;
    color: var(--av-accent);
  }
  .archivarious-stats__label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.72em;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    opacity: 0.7;
  }
  .archivarious-stats__note {
    margin: 0;
    font-size: 0.78em;
    opacity: 0.7;
  }
  .archivarious-stats__bars {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 6px;
    height: 96px;
  }
  .archivarious-stats__bar {
    display: grid;
    grid-template-rows: auto 1fr auto;
    align-items: end;
    justify-items: center;
    font-size: 0.75em;
  }
  .archivarious-stats__fill {
    width: 70%;
    min-height: 2px;
    border-radius: 4px 4px 2px 2px;
    background: var(--av-accent);
  }
  .archivarious-stats__day,
  .archivarious-stats__count {
    opacity: 0.7;
  }
  .archivarious-stats__growing {
    margin: 4px 0 0;
    padding: 0;
    list-style: none;
  }
  .archivarious-stats__growing li {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
    border-bottom: 1px solid var(--av-chip);
  }
  .archivarious-stats__growing strong {
    color: var(--av-accent);
  }
</style>
