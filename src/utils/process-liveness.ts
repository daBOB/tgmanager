/**
 * Check whether a process is still running.
 *
 * Signal 0 performs the permission/existence check without delivering a
 * signal. Shared so liveness has one definition: the queue's stale-job
 * recovery and the lock files both depend on it agreeing.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
