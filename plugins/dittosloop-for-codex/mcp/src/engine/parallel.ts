export async function parallel<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  const results = await Promise.allSettled(tasks.map((task) => task()));
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (rejected) {
    throw rejected.reason;
  }

  return results.map((result) => (result as PromiseFulfilledResult<T>).value);
}
