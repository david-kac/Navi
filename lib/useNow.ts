import { useEffect, useState } from 'react';

/** Re-renders every second while `active`, returning the current epoch ms.
 * Elapsed time is computed from timestamps; this only drives the display. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
