// Which accounts may have work written to the queue.
//
// The queue database resolves to ~/.tgmanager/queue.db for anything that
// imports it, so a throwaway script gets the production queue by default and
// never passes the CLI's account validation. That is how twelve fixture rows
// for a non-existent 'demo' account came to sit in the real queue for four
// days, one of them holding a claim that made the queue look busy.
//
// So the registry fails closed: a caller that has not declared which accounts
// exist cannot enqueue at all. The CLI declares them once it has loaded config;
// a stray script declares nothing and is refused.
let knownAccounts: string[] | null = null;

/**
 * Declare the accounts that exist, from loaded configuration.
 *
 * An empty list stays closed rather than opening the gate: a config that
 * resolved to no accounts is a broken config, not permission for any name.
 */
export function registerKnownAccounts(accounts: string[]): void {
  knownAccounts = accounts.length > 0 ? [...accounts] : null;
}

/** Forget any registration. Tests use this between cases. */
export function resetKnownAccounts(): void {
  knownAccounts = null;
}

/**
 * Throw unless `account` is known to exist.
 *
 * @throws when nothing has been registered, or the account is not among them
 */
export function assertKnownAccount(account: string): void {
  if (knownAccounts === null) {
    throw new Error(
      `Refusing to queue work for "${account}": no accounts registered. ` +
      'The queue is only writable through the CLI, which registers the accounts it loaded from config.'
    );
  }

  if (!knownAccounts.includes(account)) {
    throw new Error(
      `Refusing to queue work for unknown account "${account}". ` +
      `Configured accounts: ${knownAccounts.join(', ')}`
    );
  }
}
