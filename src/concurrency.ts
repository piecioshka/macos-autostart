/** Like `Promise.all(items.map(fn))`, but with at most `limit` calls in flight. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const queue = items.map((item, index) => ({ item, index }));

  async function worker(): Promise<void> {
    for (let job = queue.shift(); job; job = queue.shift()) {
      results[job.index] = await fn(job.item);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}
