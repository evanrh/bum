import { useMemo, useState } from 'react';

/**
 * Shared drag-and-drop list reordering for the ordered queues (issue #25):
 * the member's album backlog and the admin rotation. Reordering stays LOCAL
 * until the user presses the island's save action — the save button shows
 * only when the list has actually drifted from its confirmed order (or a
 * save failed, since retrying is then expected). Every press persists by
 * POSTing the full ordered id list; the endpoints are unchanged.
 *
 * Drag is native HTML5 with a live-swap preview (hovering a target row
 * swaps immediately), so the keyboard path (move up/down) and the mouse
 * path produce identical results.
 */
export type DragOrderParams<T> = {
  /** The last server-confirmed order. */
  initial: T[];
  /** Stable item ids — dirtiness compares id sequences only. */
  idOf: (item: T) => string | number;
  /** Persist exactly these items; resolve true on success. */
  save: (items: T[]) => Promise<boolean>;
};

export function useDragOrder<T>(params: DragOrderParams<T>) {
  const [items, setItems] = useState<T[]>(params.initial);
  const [saved, setSaved] = useState<T[]>(params.initial);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const idKey = (list: T[]): string => JSON.stringify(list.map((item) => params.idOf(item)));
  // idOf is a pure projection, so dirtiness depends only on the two lists.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dirty = useMemo(() => idKey(items) !== idKey(saved), [items, saved]);

  /** Replace the confirmed order (after a committed add/remove/refresh). */
  const reset = (next: T[]): void => {
    setItems(next);
    setSaved(next);
    setFailed(false);
  };

  /** Keyboard/arrow fallback: one adjacent swap, still local until saved. */
  const move = (index: number, delta: -1 | 1): void => {
    if (saving) return;
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    setFailed(false); // a fresh edit supersedes a stale failure indicator
  };

  const onDragStart = (index: number, event: React.DragEvent): void => {
    if (saving) {
      event.preventDefault();
      return;
    }
    // text/plain + effectAllowed: Firefox refuses a drag without data.
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
    setDragIndex(index);
  };

  const onDragOver = (index: number, event: React.DragEvent): void => {
    event.preventDefault(); // required for the browser to allow the drop
    if (dragIndex === null || index === dragIndex) return;
    setItems((current) => {
      const next = [...current];
      [next[dragIndex], next[index]] = [next[index], next[dragIndex]];
      return next;
    });
    setDragIndex(index);
  };

  const onDragEnd = (event: React.DragEvent): void => {
    event.preventDefault();
    setDragIndex(null); // drop (or cancelled drag): keep whatever order is on screen
  };

  /** The explicit save: one POST, then the confirmed order catches up. */
  const save = async (): Promise<void> => {
    if (saving || (!dirty && !failed)) return;
    setSaving(true);
    const ok = await params.save(items);
    if (ok) {
      setSaved(items);
      setFailed(false);
    } else {
      // Keep the attempted order on screen so one click (or one drag) retries.
      setFailed(true);
    }
    setSaving(false);
  };

  return {
    items,
    saved,
    /** True when the visible order differs from the confirmed one. */
    dirty,
    /** Save button visibility: real changes, or a failed save awaiting retry. */
    canSave: dirty || failed,
    saving,
    failHintVisible: failed,
    dragged: dragIndex,
    save,
    move,
    reset,
    onDragStart,
    onDragOver,
    onDragEnd,
  };
}
