import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordingInfo } from "./types";

const DRAG_THRESHOLD_PX = 5;
const HOLD_THRESHOLD_MS = 140;
const SCROLL_EDGE_PX = 52;
const SCROLL_MAX_SPEED = 16;

type DragState = {
  pointerId: number;
  startIndex: number;
  startY: number;
  startTime: number;
  active: boolean;
};

export function useLibraryMultiSelect(
  recordings: RecordingInfo[],
  librarySelectedId: string | null,
  setLibrarySelected: (id: string | null) => void,
) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() =>
    librarySelectedId ? new Set([librarySelectedId]) : new Set(),
  );
  const [isDragging, setIsDragging] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorIdRef = useRef<string | null>(librarySelectedId);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const lastClientYRef = useRef(0);
  const autoScrollRafRef = useRef<number | null>(null);

  const recordingIds = recordings.map((r) => r.id);

  useEffect(() => {
    anchorIdRef.current = librarySelectedId;
  }, [librarySelectedId]);

  useEffect(() => {
    if (!librarySelectedId) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds((prev) => {
      const pruned = new Set([...prev].filter((id) => recordingIds.includes(id)));
      if (pruned.size === 0) return new Set([librarySelectedId]);
      return pruned;
    });
  }, [librarySelectedId, recordingIds.join("|")]);

  const applyRange = useCallback(
    (fromIndex: number, toIndex: number) => {
      const lo = Math.min(fromIndex, toIndex);
      const hi = Math.max(fromIndex, toIndex);
      const ids = recordings.slice(lo, hi + 1).map((r) => r.id);
      setSelectedIds(new Set(ids));
      const focus = recordings[toIndex];
      if (focus) setLibrarySelected(focus.id);
    },
    [recordings, setLibrarySelected],
  );

  const indexAtClientY = useCallback(
    (clientY: number) => {
      const root = scrollRef.current;
      if (!root) return 0;
      const rows = root.querySelectorAll<HTMLElement>("[data-rec-index]");
      if (rows.length === 0) return 0;
      for (let i = 0; i < rows.length; i++) {
        const rect = rows[i].getBoundingClientRect();
        const mid = (rect.top + rect.bottom) / 2;
        if (clientY < mid) return Number(rows[i].dataset.recIndex ?? i);
      }
      const last = rows[rows.length - 1];
      return Number(last.dataset.recIndex ?? rows.length - 1);
    },
    [],
  );

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRafRef.current !== null) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
  }, []);

  const startAutoScroll = useCallback(() => {
    if (autoScrollRafRef.current !== null) return;
    const tick = () => {
      const el = scrollRef.current;
      const y = lastClientYRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        if (y < rect.top + SCROLL_EDGE_PX) {
          const t = Math.min(1, (rect.top + SCROLL_EDGE_PX - y) / SCROLL_EDGE_PX);
          el.scrollTop -= SCROLL_MAX_SPEED * t;
        } else if (y > rect.bottom - SCROLL_EDGE_PX) {
          const t = Math.min(1, (y - (rect.bottom - SCROLL_EDGE_PX)) / SCROLL_EDGE_PX);
          el.scrollTop += SCROLL_MAX_SPEED * t;
        }
      }
      autoScrollRafRef.current = requestAnimationFrame(tick);
    };
    autoScrollRafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => () => stopAutoScroll(), [stopAutoScroll]);

  const onRowPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, _id: string, index: number) => {
      if (e.button !== 0) return;
      dragRef.current = {
        pointerId: e.pointerId,
        startIndex: index,
        startY: e.clientY,
        startTime: Date.now(),
        active: false,
      };
      lastClientYRef.current = e.clientY;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [],
  );

  const onRowPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      lastClientYRef.current = e.clientY;

      const dy = Math.abs(e.clientY - drag.startY);
      const held = Date.now() - drag.startTime >= HOLD_THRESHOLD_MS;
      if (!drag.active && (dy >= DRAG_THRESHOLD_PX || held)) {
        drag.active = true;
        setIsDragging(true);
        startAutoScroll();
      }

      if (drag.active) {
        const idx = indexAtClientY(e.clientY);
        applyRange(drag.startIndex, idx);
      }
    },
    [applyRange, indexAtClientY, startAutoScroll],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (drag.active) suppressClickRef.current = true;
      dragRef.current = null;
      setIsDragging(false);
      stopAutoScroll();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    },
    [stopAutoScroll],
  );

  const onRowClick = useCallback(
    (e: React.MouseEvent, id: string, index: number) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }

      if (e.shiftKey && anchorIdRef.current) {
        const anchorIdx = recordings.findIndex((r) => r.id === anchorIdRef.current);
        if (anchorIdx >= 0) {
          applyRange(anchorIdx, index);
          anchorIdRef.current = id;
          return;
        }
      }

      if (e.metaKey || e.ctrlKey) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        setLibrarySelected(id);
        anchorIdRef.current = id;
        return;
      }

      setSelectedIds(new Set([id]));
      setLibrarySelected(id);
      anchorIdRef.current = id;
    },
    [applyRange, recordings, setLibrarySelected],
  );

  const clearMulti = useCallback(() => {
    if (librarySelectedId) setSelectedIds(new Set([librarySelectedId]));
    else setSelectedIds(new Set());
  }, [librarySelectedId]);

  const selectedCount = selectedIds.size;
  const isMulti = selectedCount > 1;

  return {
    scrollRef,
    selectedIds,
    selectedCount,
    isMulti,
    isDragging,
    onRowPointerDown,
    onRowPointerMove,
    onRowPointerUp: endDrag,
    onRowPointerCancel: endDrag,
    onRowClick,
    clearMulti,
  };
}
