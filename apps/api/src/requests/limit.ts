export type RateCounter = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
};

export async function takeWindow(counter: RateCounter, key: string, limit: number): Promise<boolean> {
  const count = await counter.incr(key);
  if (count === 1) {
    await counter.expire(key, 2);
  }
  return count <= limit;
}
