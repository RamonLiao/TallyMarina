export function makeEntityMutex(): { run<T>(key: string, fn: () => Promise<T>): Promise<T> } {
  const tails = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const prev = tails.get(key) ?? Promise.resolve();
      const next = prev.then(fn, fn); // run fn whether prev resolved or rejected
      // Store a never-rejecting tail so the next caller chains after this one
      // regardless of outcome; the returned `next` preserves the real result/rejection.
      tails.set(key, next.catch(() => undefined));
      return next;
    },
  };
}
