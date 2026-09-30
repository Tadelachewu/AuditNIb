/**
 * The ONE place notification behaviour is configured. Components can't
 * pass their own duration, position or style (notify's options don't
 * accept them) - change it here and it changes everywhere.
 *
 * Durations (ms) - read time plus margin, longer for what needs action:
 *   success  4s   confirms what the user just did; they're already moving on
 *   info     5s   neutral context, a little more text
 *   warning  8s   something needs attention; must be readable
 *   error   10s   what failed + what to do + a support reference;
 *                 also pauses on hover/focus and has a close button
 *   loading  until resolved (replaced in place by the success/error)
 */
export const NOTIFY_DURATION = {
  success: 4_000,
  info: 5_000,
  warning: 8_000,
  error: 10_000,
  loading: Infinity,
} as const;

export type NotifyType = keyof typeof NOTIFY_DURATION;

/**
 * Top-centre, just below the sticky top bar (h-16 = 64px):
 *  - never covers the sidebar, the top bar's bell / profile menu, the
 *    sticky Save/Submit bars and page bars at the bottom, or the Add
 *    dialogs anchored under each page's top-right button;
 *  - sits where the eye already is after clicking an action.
 */
export const NOTIFY_POSITION = "top-center" as const;
export const NOTIFY_OFFSET = 76;
/** At most this many on screen; older ones collapse into a stack. */
export const NOTIFY_MAX_VISIBLE = 3;
