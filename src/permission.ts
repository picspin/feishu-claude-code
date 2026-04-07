type PendingPermission = {
  resolve: (allowed: boolean) => void;
  timer: NodeJS.Timeout;
};

export function createPermissionBroker(timeoutMs: number = 120000) {
  const pending = new Map<string, PendingPermission>();

  function waitForApproval(sessionKey: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(sessionKey);
        resolve(false);
      }, timeoutMs);
      pending.set(sessionKey, { resolve, timer });
    });
  }

  function resolveApproval(sessionKey: string, allowed: boolean): boolean {
    const entry = pending.get(sessionKey);
    if (!entry) {
      return false;
    }
    clearTimeout(entry.timer);
    pending.delete(sessionKey);
    entry.resolve(allowed);
    return true;
  }

  function hasPending(sessionKey: string): boolean {
    return pending.has(sessionKey);
  }

  return { waitForApproval, resolveApproval, hasPending };
}
