/** Both pages measure performance.now() from their own start; this clock is the same instant on both. */
export function toSharedTime(localMs: number, timeOrigin: number): number {
  return timeOrigin + localMs;
}

/** The page's own `performance.now()` reading for an instant on the shared clock. */
export function fromSharedTime(sharedMs: number, timeOrigin: number): number {
  return sharedMs - timeOrigin;
}
