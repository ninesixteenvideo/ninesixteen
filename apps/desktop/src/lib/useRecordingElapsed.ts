import { useEffect, useRef, useState } from "react";

/**
 * Wall-clock elapsed time while recording. The backend tick can stall when the
 * system is under load (IPC backlog); this stays smooth because it uses
 * performance.now() locally.
 */
export function useRecordingElapsed(recording: boolean, tickElapsed: number): number {
  const startRef = useRef<number | null>(null);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!recording) {
      startRef.current = null;
      setDisplay(0);
      return;
    }
    startRef.current = performance.now();
    const sync = () => {
      if (startRef.current !== null) {
        setDisplay((performance.now() - startRef.current) / 1000);
      }
    };
    sync();
    const id = window.setInterval(sync, 250);
    return () => clearInterval(id);
  }, [recording]);

  return recording ? display : tickElapsed;
}
