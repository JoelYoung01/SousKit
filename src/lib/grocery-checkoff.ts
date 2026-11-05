/**
 * Checked-off grocery rows stay put until the list has been idle, then
 * collapse and fade together. Any edit on the page restarts that idle wait
 * so a row never drops out from under the next tap.
 */

export const GROCERY_CHECKOFF_DELAY_MS = 10_000;

/** Visual y-collapse + fade. */
export const GROCERY_CHECKOFF_COLLAPSE_MS = 320;

/**
 * How long a row stays in the leaving phase. A short buffer past the
 * animation keeps the row at zero height until it unmounts, so neighbors
 * don't jump when it is removed.
 */
export const GROCERY_CHECKOFF_REMOVE_MS = GROCERY_CHECKOFF_COLLAPSE_MS + 50;

/** Space under each row. Collapses with the row. */
export const GROCERY_ROW_GAP = 6;

/** Space under a category heading. */
export const GROCERY_HEADER_GAP = 8;

/**
 * Extra space under a category, on top of the last row's gap, so sections
 * stay 20px apart (the previous list gap).
 */
export const GROCERY_SECTION_GAP = 14;

/** setTimeout can fire slightly early; treat that as the deadline. */
const TIMER_SLACK_MS = 25;

export type CheckoffClock = {
  /** Crossed off, still full size, waiting out the shared idle delay. */
  waiting: ReadonlySet<string>;
  /** Playing the collapse. Removed when the phase ends. */
  leaving: ReadonlySet<string>;
  /** Epoch ms when waiting rows should start leaving. */
  hideAt: number | null;
  /** Epoch ms when leaving rows should be removed. */
  collapseDoneAt: number | null;
};

export function emptyCheckoff(): CheckoffClock {
  return {
    waiting: new Set(),
    leaving: new Set(),
    hideAt: null,
    collapseDoneAt: null
  };
}

export function sameCheckoffKeys(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  if (a.size !== b.size) return false;
  for (const key of a) {
    if (!b.has(key)) return false;
  }
  return true;
}

function isDue(due: number | null, now: number) {
  return due != null && now + TIMER_SLACK_MS >= due;
}

function isIdle(clock: CheckoffClock) {
  return clock.waiting.size === 0 && clock.leaving.size === 0;
}

/** Push the shared idle deadline out. Collapses in progress expand back. */
export function postponeCheckoff(
  clock: CheckoffClock,
  now: number,
  delay = GROCERY_CHECKOFF_DELAY_MS
): CheckoffClock {
  if (isIdle(clock)) {
    if (clock.hideAt == null && clock.collapseDoneAt == null) return clock;
    return emptyCheckoff();
  }
  const waiting = new Set(clock.waiting);
  for (const key of clock.leaving) waiting.add(key);
  return {
    waiting,
    leaving: new Set(),
    hideAt: now + delay,
    collapseDoneAt: null
  };
}

/** Cross an item off and restart the shared idle delay. */
export function queueCheckoff(
  clock: CheckoffClock,
  key: string,
  now: number,
  delay = GROCERY_CHECKOFF_DELAY_MS
): CheckoffClock {
  const waiting = new Set(clock.waiting);
  waiting.add(key);
  const leaving = new Set(clock.leaving);
  leaving.delete(key);
  return postponeCheckoff({ ...clock, waiting, leaving }, now, delay);
}

/**
 * Take one item back, or ignore a missing key. Either way the remaining
 * rows wait out a fresh delay — this was a user change.
 */
export function dropCheckoff(
  clock: CheckoffClock,
  key: string,
  now: number,
  delay = GROCERY_CHECKOFF_DELAY_MS
): CheckoffClock {
  if (!clock.waiting.has(key) && !clock.leaving.has(key)) {
    return postponeCheckoff(clock, now, delay);
  }
  const waiting = new Set(clock.waiting);
  const leaving = new Set(clock.leaving);
  waiting.delete(key);
  leaving.delete(key);
  return postponeCheckoff({ ...clock, waiting, leaving }, now, delay);
}

/** Drop keys that are no longer on the list. Does not restart the delay. */
export function pruneCheckoff(clock: CheckoffClock, liveKeys: ReadonlySet<string>): CheckoffClock {
  let changed = false;
  const waiting = new Set<string>();
  for (const key of clock.waiting) {
    if (liveKeys.has(key)) waiting.add(key);
    else changed = true;
  }
  const leaving = new Set<string>();
  for (const key of clock.leaving) {
    if (liveKeys.has(key)) leaving.add(key);
    else changed = true;
  }
  if (!changed) return clock;
  if (waiting.size === 0 && leaving.size === 0) return emptyCheckoff();
  return {
    waiting,
    leaving,
    hideAt: waiting.size > 0 ? clock.hideAt : null,
    collapseDoneAt: leaving.size > 0 ? clock.collapseDoneAt : null
  };
}

/** Idle delay elapsed. Start the collapse for every waiting row. */
export function startCheckoffCollapse(
  clock: CheckoffClock,
  now: number,
  removeMs = GROCERY_CHECKOFF_REMOVE_MS
): CheckoffClock {
  if (!isDue(clock.hideAt, now) || clock.waiting.size === 0) return clock;
  return {
    waiting: new Set(),
    leaving: new Set([...clock.leaving, ...clock.waiting]),
    hideAt: null,
    collapseDoneAt: now + removeMs
  };
}

/** Collapse finished. Caller persists the dismiss. */
export function completeCheckoffCollapse(
  clock: CheckoffClock,
  now: number
): { clock: CheckoffClock; finishedKeys: string[] } {
  if (!isDue(clock.collapseDoneAt, now) || clock.leaving.size === 0) {
    return { clock, finishedKeys: [] };
  }
  return {
    clock: {
      waiting: new Set(clock.waiting),
      leaving: new Set(),
      hideAt: clock.hideAt,
      collapseDoneAt: null
    },
    finishedKeys: [...clock.leaving]
  };
}

/** Idle delay elapsed while collapses are disabled (dismissed rows stay listed). */
export function takeWaitingCheckoff(
  clock: CheckoffClock,
  now: number
): { clock: CheckoffClock; finishedKeys: string[] } {
  if (!isDue(clock.hideAt, now) || clock.waiting.size === 0) {
    return { clock, finishedKeys: [] };
  }
  return {
    clock: emptyCheckoff(),
    finishedKeys: [...clock.waiting]
  };
}

export type GroceryCheckoffCommit = (keys: string[]) => void;

/**
 * Owns the single idle timer. `onChange` fires only when the sets of waiting
 * or leaving keys change, so pointer moves can restart the delay without
 * re-rendering the list.
 */
export class GroceryCheckoffController {
  clock: CheckoffClock = emptyCheckoff();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private onCommit: GroceryCheckoffCommit,
    private readonly onChange: (clock: CheckoffClock) => void,
    private animate: () => boolean = () => true,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** Swap the commit and animate callbacks without touching the idle timer. */
  setHandlers(onCommit: GroceryCheckoffCommit, animate: () => boolean) {
    this.onCommit = onCommit;
    this.animate = animate;
  }

  queue(key: string) {
    if (this.clock.waiting.has(key) || this.clock.leaving.has(key)) return;
    this.publish(queueCheckoff(this.clock, key, this.now()));
  }

  drop(key: string) {
    this.publish(dropCheckoff(this.clock, key, this.now()));
  }

  noteActivity() {
    this.publish(postponeCheckoff(this.clock, this.now()));
  }

  prune(liveKeys: ReadonlySet<string>) {
    this.publish(pruneCheckoff(this.clock, liveKeys));
  }

  dispose() {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
  }

  private publish(next: CheckoffClock) {
    if (next === this.clock) return;
    const prev = this.clock;
    this.clock = next;
    if (
      !sameCheckoffKeys(prev.waiting, next.waiting) ||
      !sameCheckoffKeys(prev.leaving, next.leaving)
    ) {
      this.onChange(next);
    }
    this.arm();
  }

  private arm() {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
    const due = this.clock.collapseDoneAt ?? this.clock.hideAt;
    if (due == null) return;
    const delay = Math.max(0, due - this.now());
    this.timer = setTimeout(() => this.tick(), delay);
  }

  private tick() {
    this.timer = null;
    const now = this.now();
    const current = this.clock;

    if (current.collapseDoneAt != null) {
      const finished = completeCheckoffCollapse(current, now);
      if (finished.finishedKeys.length === 0) {
        this.arm();
        return;
      }
      this.publish(finished.clock);
      this.onCommit(finished.finishedKeys);
      return;
    }

    if (current.hideAt == null || !isDue(current.hideAt, now)) {
      this.arm();
      return;
    }

    if (!this.animate()) {
      const taken = takeWaitingCheckoff(current, now);
      if (taken.finishedKeys.length === 0) {
        this.arm();
        return;
      }
      this.publish(taken.clock);
      this.onCommit(taken.finishedKeys);
      return;
    }

    const started = startCheckoffCollapse(current, now);
    if (started === current) {
      this.arm();
      return;
    }
    this.publish(started);
  }
}
