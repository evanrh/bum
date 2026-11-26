import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

type TooltipProps = {
  /** Tip copy. Decorative (`aria-hidden`) — the trigger keeps its own `title` + `aria-label`. */
  text: string;
  /** Side of the trigger the tip opens on; flips to the opposite side when that side would overflow the viewport. */
  placement?: TooltipPlacement;
  /** A single interactive trigger — hover/focus on it opens the tip. */
  children: ReactNode;
};

/** Half the 8px arrow: gap so the rotated-square arrow tip touches the trigger edge. */
const ARROW = 4;
/** Clamp margin when the tip would otherwise leave the viewport. */
const INSET = 6;

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

type Coords = { x: number; y: number; placement: TooltipPlacement };

const FLIP: Record<TooltipPlacement, TooltipPlacement> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

function position(trigger: Rect, tip: Rect, wants: TooltipPlacement): Coords {
  const cx = trigger.left + trigger.width / 2;
  const cy = trigger.top + trigger.height / 2;
  const sides: Record<TooltipPlacement, Coords> = {
    top: { x: cx - tip.width / 2, y: trigger.top - ARROW - tip.height, placement: 'top' },
    bottom: { x: cx - tip.width / 2, y: trigger.bottom + ARROW, placement: 'bottom' },
    left: { x: trigger.left - ARROW - tip.width, y: cy - tip.height / 2, placement: 'left' },
    right: { x: trigger.right + ARROW, y: cy - tip.height / 2, placement: 'right' },
  };
  const measure = (where: TooltipPlacement): Coords => sides[where];

  // Flip only on main-axis overflow (Popper-style); a cross-axis overflow is handled by clamping.
  const mainOverflow = (c: Coords): boolean => {
    if (c.placement === 'top') return c.y < 0;
    if (c.placement === 'bottom') return c.y + tip.height > window.innerHeight;
    if (c.placement === 'left') return c.x < 0;
    return c.x + tip.width > window.innerWidth;
  };

  const placed = measure(wants);
  const open = mainOverflow(placed) ? measure(FLIP[wants]) : placed;
  return {
    x: Math.min(Math.max(open.x, INSET), window.innerWidth - tip.width - INSET),
    y: Math.min(Math.max(open.y, INSET), window.innerHeight - tip.height - INSET),
    placement: open.placement,
  };
}

function Arrow({ placement }: { placement: TooltipPlacement }): ReactNode {
  const side: Record<TooltipPlacement, string> = {
    top: '-bottom-1 left-1/2 -translate-x-1/2',
    bottom: '-top-1 left-1/2 -translate-x-1/2',
    left: '-right-1 top-1/2 -translate-y-1/2',
    right: '-left-1 top-1/2 -translate-y-1/2',
  };
  return (
    <span aria-hidden="true" className={`absolute h-2 w-2 rotate-45 bg-black ${side[placement]}`} />
  );
}

/**
 * Bootstrap-style tooltip: black tip, white text, small arrow, ~150ms fade.
 * Portal + fixed positioning so `overflow-x-auto` parents (admin table) can't clip it.
 */
export function Tooltip({ text, placement = 'top', children }: TooltipProps): ReactNode {
  // Portal markup mounts post-hydration: createPortal is not SSR-safe and <Show>
  // evaluates children eagerly, so the gate must defer the call itself.
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const aim = (): void => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const tipBox = tipRef.current?.getBoundingClientRect();
      if (trigger && tipBox) setCoords(position(trigger, tipBox, placement));
    };
    aim();
    window.addEventListener('scroll', aim, true);
    window.addEventListener('resize', aim);
    return () => {
      window.removeEventListener('scroll', aim, true);
      window.removeEventListener('resize', aim);
    };
  }, [open, placement]);

  const shown = open && coords !== null;
  const where = coords?.placement ?? placement;
  const tip = (
    <div
      ref={tipRef}
      data-testid="tip"
      aria-hidden="true"
      data-placement={where}
      style={coords ? { left: coords.x, top: coords.y } : undefined}
      className={[
        'pointer-events-none fixed z-50 w-max max-w-[200px] rounded-md bg-black px-2 py-1 text-sm leading-snug text-white',
        shown ? 'opacity-100 motion-safe:transition-opacity motion-safe:duration-150' : 'invisible opacity-0',
      ].join(' ')}
    >
      {text}
      <Arrow placement={where} />
    </div>
  );

  return (
    <span
      ref={triggerRef}
      className="inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      {children}
      {mounted ? createPortal(tip, document.body) : null}
    </span>
  );
}
