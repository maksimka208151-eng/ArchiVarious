<script lang="ts" module>
  /**
   * One minimal line-icon set for every surface (24 × 24 grid, 1.75 stroke, round caps), so nothing relies
   * on coloured emoji. The logo mark is the only filled shape.
   */
  const ICONS = {
    bolt: "M13 3 5 13.5h6L10 21l9-11.5h-6L13 3Z",
    settings:
      "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19.4 13.5l1.6 1.2-1.9 3.3-1.9-.8a7.6 7.6 0 0 1-2.1 1.2l-.3 2h-3.8l-.3-2a7.6 7.6 0 0 1-2.1-1.2l-1.9.8-1.9-3.3 1.6-1.2a7.7 7.7 0 0 1 0-3L2.8 9.3l1.9-3.3 1.9.8a7.6 7.6 0 0 1 2.1-1.2l.3-2h3.8l.3 2a7.6 7.6 0 0 1 2.1 1.2l1.9-.8 1.9 3.3-1.6 1.2a7.7 7.7 0 0 1 0 3Z",
    note: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5ZM14 3v5h5M9 13h6M9 17h4",
    calendar: "M7 3v3M17 3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
    plus: "M12 5v14M5 12h14",
    check: "M5 12.5 10 17l9-10",
    close: "M6 6l12 12M18 6 6 18",
    inbox: "M4 13h4l2 3h4l2-3h4M4 13l2.5-7h11L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5Z",
    chart: "M4 20h16M7 16v-5M12 16V6M17 16V9",
    bell: "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4l2-2ZM10 21h4",
    image: "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM4 16l5-5 4 4 2-2 5 5M15 9h.01",
    flame: "M12 21c3.5 0 6-2.5 6-6 0-4-3-6-4-10-1 2-2 3-3.2 3.2C10.5 6.5 10 5 9 4c0 3-3 5.5-3 11 0 3.5 2.5 6 6 6Z",
    back: "M15 5l-7 7 7 7",
  } as const;

  export type IconName = keyof typeof ICONS | "logo";
</script>

<script lang="ts">
  import { LOGO_PATH, LOGO_VIEWBOX } from "./brand";

  interface Props {
    name: IconName;
    size?: number;
    /** Accessible label; without it the icon is decorative. */
    label?: string;
  }

  let { name, size = 18, label }: Props = $props();
</script>

{#if name === "logo"}
  <svg
    class="archivarious-icon"
    viewBox={LOGO_VIEWBOX}
    width={size}
    height={size}
    role={label ? "img" : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : "true"}
  >
    <path fill="currentColor" d={LOGO_PATH} />
  </svg>
{:else}
  <svg
    class="archivarious-icon"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    role={label ? "img" : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : "true"}
  >
    <path d={ICONS[name]} />
  </svg>
{/if}

<style>
  .archivarious-icon {
    display: block;
    flex-shrink: 0;
    pointer-events: none;
  }
</style>
