import { useEffect, useState } from 'react';

export type CountdownProps = {
  /** Server-provided ISO deadline. */
  deadlineIso: string;
  /** Server-computed "3d 14h" static text, used until hydration (client:only gaps). */
  fallback: string;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** "3d 14h"-style remaining text, computed from an ISO deadline. */
export function remainingText(deadlineIso: string, now: number = Date.now()): string {
  const deadline = Date.parse(deadlineIso);
  if (!Number.isFinite(deadline)) return fallbackText(deadlineIso);
  const remaining = deadline - now;
  if (remaining <= 0) return 'week over';
  const days = Math.floor(remaining / DAY_MS);
  const hours = Math.floor((remaining % DAY_MS) / HOUR_MS);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

const fallbackText = (deadlineIso: string): string => (deadlineIso ? '—' : '');

/** Ticks to the deadline once a minute, falling back to server text. */
export function Countdown({ deadlineIso, fallback }: CountdownProps) {
  const [text, setText] = useState(fallback);

  useEffect(() => {
    const deadline = Date.parse(deadlineIso);
    if (!Number.isFinite(deadline)) return;
    const tick = (): void => setText(remainingText(deadlineIso));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [deadlineIso]);

  return <span className="countdown">{text}</span>;
}

export default Countdown;
