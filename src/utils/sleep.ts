/** Resolve after `ms` milliseconds. Shared so delay logic has one definition. */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
