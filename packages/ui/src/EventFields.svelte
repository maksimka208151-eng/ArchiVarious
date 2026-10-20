<script lang="ts">
  import { EVENT_DURATIONS, type EventWhen } from "@archivarious/core";

  interface Props {
    when: EventWhen;
    /** Called when the user changes a field by hand, so the host stops re-suggesting from the text. */
    ontouch?: () => void;
  }

  let { when = $bindable(), ontouch }: Props = $props();

  const allDay = $derived(!when.time);
  const durationLabel = (m: number) => (m < 60 ? `${m} мин` : `${m / 60} ч`);

  function set(patch: Partial<EventWhen>) {
    when = { ...when, ...patch };
    ontouch?.();
  }
</script>

<div class="archivarious-event">
  <input
    type="date"
    aria-label="Дата"
    value={when.date}
    onchange={(event) => event.currentTarget.value && set({ date: event.currentTarget.value })}
  />
  {#if !allDay}
    <input
      type="time"
      aria-label="Время"
      value={when.time}
      onchange={(event) => event.currentTarget.value && set({ time: event.currentTarget.value })}
    />
    <select
      aria-label="Длительность"
      value={String(when.minutes)}
      onchange={(event) => set({ minutes: Number(event.currentTarget.value) })}
    >
      {#each EVENT_DURATIONS as minutes (minutes)}
        <option value={String(minutes)}>{durationLabel(minutes)}</option>
      {/each}
    </select>
  {/if}
  <label class="archivarious-event__allday">
    <input
      type="checkbox"
      checked={allDay}
      onchange={(event) => {
        const { time: _time, ...rest } = when;
        if (event.currentTarget.checked) {
          when = rest;
          ontouch?.();
        } else set({ time: "09:00" });
      }}
    />
    весь день
  </label>
</div>

<style>
  .archivarious-event {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }
  .archivarious-event input[type="date"],
  .archivarious-event input[type="time"],
  .archivarious-event select {
    font: inherit;
    color: inherit;
  }
  .archivarious-event__allday {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.85em;
    white-space: nowrap;
  }
</style>
