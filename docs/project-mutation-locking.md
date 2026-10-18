# Project mutation locking

Screenshot Studio serializes local changes to `app-store-screenshots.json` so the CLI and editor
cannot silently overwrite each other's work. This guide explains the contract, its implementation,
and its failure modes. It is written for contributors who are comfortable with iOS concurrency and
file coordination but may be new to Node.js processes and lockfiles.

## Short version

- `writeProjectAtomic()` makes one file replacement atomic.
- `withProjectMutation()` makes the complete **read → modify → write** transaction exclusive.
- Screenshot Studio owns that API; [`proper-lockfile`](https://github.com/moxystudio/node-proper-lockfile)
  is a replaceable implementation detail inside `@screenshot-studio/core/storage`.
- The lock is a hidden sibling directory beside the canonical project path.
- Normal release removes the directory. A crash leaves it behind; another process recovers it only
  after its heartbeat is stale.
- The contract is for a local filesystem. It is not a distributed lock for a shared project mount.

## Why atomic writing is not enough

Atomic replacement prevents partial JSON. A reader sees either the old complete document or the new
complete document. It does not prevent two processes from deriving different replacements from the
same revision:

```text
CLI                                  Editor server
───────────────────────────────────  ───────────────────────────────────
read revision A
                                     read revision A
change the project name
                                     change one screen background
atomically write A + name
                                     atomically write A + background

Final document: A + background. The valid CLI change was silently lost.
```

The final writes were individually atomic, but the business transaction was not. The protected
critical section must therefore include the initial read and all work that determines the new
persisted document:

```text
acquire → read current revision → calculate mutation → atomic write → release
```

This is the same distinction as protecting only the final assignment on iOS instead of protecting
the complete read-modify-write sequence that produces the assigned value.

## iOS mental model

The closest useful analogy is a narrow `NSFileCoordinator`-style write accessor around a critical
section, combined with a lease that survives process boundaries.

| Screenshot Studio / Node.js | Approximate iOS concept |
|---|---|
| `withProjectMutation()` | A coordinated write accessor or isolated actor method |
| Operation callback | The critical section |
| Atomic `mkdir` | One indivisible attempt to become the owner |
| Hidden lock directory | A lease token; it is not project data |
| Directory mtime heartbeat | Periodic lease renewal |
| Stale timeout | The point after which an abandoned lease may be recovered |
| `finally` cleanup | `defer { release() }` |
| Compromised lock | Loss of a persistence invariant while a write is active |

The actor analogy has an important limit. A Swift actor or serial `DispatchQueue` coordinates tasks
inside one process. Screenshot Studio may have a CLI process and a Next.js editor/server process at
the same time. Neither process can see the other's JavaScript memory, actor, promise queue, or mutex.
They need one coordination primitive visible through the filesystem.

`proper-lockfile` does not use a long-lived file descriptor like `flock`. It attempts to create one
directory atomically. Exactly one contender can create that path; the others wait and retry.

## Architecture boundary

Application code imports only Screenshot Studio APIs:

```ts
import {
  acquireProjectMutationLock,
  withProjectMutation,
  type ProjectLockOptions,
} from "@screenshot-studio/core/storage";
```

CLI commands, editor services, and future storage operations must not import `proper-lockfile`
directly. Keeping the dependency behind core gives us three properties:

1. Every writer uses the same defaults and error semantics.
2. Tests protect Screenshot Studio behavior rather than the package's raw API.
3. The package can be upgraded or replaced without changing callers.

The dependency is intentionally pinned to the `4.1.x` line. Version 4.1.2 is mature but old, written
in JavaScript, and uses separate community TypeScript declarations. That is a real maintenance risk,
but it is contained behind a small adapter and real process-level regression tests. It avoids owning
a much larger custom protocol with permanent queues, owner records, PID probing, and hard-link races.

## Lock path and path identity

For the canonical project document:

```text
/Projects/MyScreenshots/app-store-screenshots.json
```

the active lease is represented by:

```text
/Projects/MyScreenshots/.app-store-screenshots.json.screenshot-studio.lock/
```

The adapter resolves the project through the filesystem before choosing that directory. This is
similar to standardizing/resolving a file URL before using it as a coordination identity. Two paths
that resolve to the same physical project file, including a symlink alias, therefore contend for the
same lock instead of creating two independent critical sections.

The project document must already exist before mutation locking. Project creation has its own
creation flow and must not manufacture a second lock identity for a not-yet-existing path.

## Normal lifecycle

```text
Writer A                 Lock directory              Writer B
───────────────────────  ──────────────────────────  ─────────────────────
atomic mkdir ──────────▶ created; A owns lease
start heartbeat          mtime refreshed
enter operation                                      mkdir fails: exists
read + modify + write                                bounded retry
release                  directory removed
                                                     mkdir succeeds
                                                     enter operation
```

`withProjectMutation()` always releases after the operation. When the operation throws, its original
error is preserved after successful cleanup, including unusual falsy thrown values. If both the
operation and release fail, an `AggregateError` reports both failures instead of hiding either one.

`acquireProjectMutationLock()` returns a lower-level handle for services that need explicit lifetime
control. Its `release()` method is idempotent at the Screenshot Studio boundary: concurrent cleanup
calls share one underlying release promise.

## Crash and stale recovery

On normal process exit or explicit release, the lock directory is removed. `SIGKILL`, an out-of-memory
termination, machine power loss, or another fatal runtime failure may prevent cleanup. The directory
then remains, but its heartbeat stops.

Another writer follows this sequence:

1. Its atomic `mkdir` sees that the directory already exists.
2. It checks the directory mtime.
3. Before the stale deadline, it treats the owner as active and keeps waiting.
4. After the stale deadline, it removes the abandoned directory and attempts atomic acquisition again.

The default stale threshold is 30 seconds. Recovery is deliberately not immediate: a busy or paused
process must not be mistaken for a dead writer merely because one heartbeat was delayed.

## Heartbeat compromise is fail-fast

While a mutation is active, `proper-lockfile` updates the directory mtime. If the directory disappears,
its mtime no longer matches, or updates remain delayed beyond the stale threshold, another process
could soon believe it is safe to acquire the same project.

Screenshot Studio treats this as a lost persistence invariant. The configured `onCompromised`
handler throws instead of allowing the current process to continue toward another write. For an iOS
mental model, this is closer to `preconditionFailure` after losing a required coordinator guarantee
than to a form-validation error the operation can safely ignore and retry in place.

The next process may recover the stale directory according to the normal lease rules. The failed
operation itself must be restarted from a fresh project snapshot; it must not reuse its old in-memory
mutation result.

## Defaults and customization

| Option | Default | Meaning |
|---|---:|---|
| `timeoutMs` | 30,000 ms | Maximum configured retry window before acquisition fails |
| `staleAfterMs` | 30,000 ms | Age at which an unrefreshed lease may be recovered |
| `retryDelayMs` | 50 ms | Constant delay between attempts |
| `heartbeatMs` | 10,000 ms | Interval between lease renewals |

Constraints enforced before touching the filesystem:

- `timeoutMs` is finite and at least `0`; zero means one immediate attempt.
- `staleAfterMs` is at least `5,000` ms.
- `retryDelayMs` is finite and at least `1` ms.
- `heartbeatMs` is at least `1,000` ms and no more than half of `staleAfterMs`.
- When a caller lowers `staleAfterMs` without specifying `heartbeatMs`, the derived heartbeat is the
  smaller of 10 seconds and half the stale threshold.

Production callers should normally use the defaults. Shorter values are primarily useful in focused
tests. Aggressive stale thresholds increase the risk that event-loop delay, filesystem latency, or
system sleep makes a live owner appear abandoned.

## Correct usage

Protect the complete transaction:

```ts
await withProjectMutation(projectPath, async () => {
  const snapshot = await readProjectSnapshot(projectPath);
  const updatedProject = renameFirstScreen(snapshot.project, "Welcome");
  await writeProjectAtomic(projectPath, updatedProject);
});
```

For a value returned by the mutation:

```ts
const createdScreen = await withProjectMutation(projectPath, async () => {
  const snapshot = await readProjectSnapshot(projectPath);
  const result = addScreen(snapshot.project, requestedScreen);
  await writeProjectAtomic(projectPath, result.project);
  return result.screen;
});
```

Use the lower-level handle only when a callback cannot express the real lifetime clearly:

```ts
const lock = await acquireProjectMutationLock(projectPath);

try {
  const snapshot = await readProjectSnapshot(projectPath);
  await writeProjectAtomic(projectPath, applyMigration(snapshot.project));
} finally {
  await lock.release();
}
```

The callback form is preferred because it makes forgotten cleanup harder.

## Incorrect usage

Locking only the final write is too late:

```ts
// Incorrect: another writer can change the project after this read.
const snapshot = await readProjectSnapshot(projectPath);
const updatedProject = renameFirstScreen(snapshot.project, "Welcome");

await withProjectMutation(projectPath, async () => {
  await writeProjectAtomic(projectPath, updatedProject);
});
```

An in-memory mutex is also insufficient:

```ts
// Incorrect for CLI + editor coordination: this queue exists in only one process.
await localPromiseQueue.run(() => updateProjectFile(projectPath));
```

Do not hold the writer lock around unrelated work such as a network request, user confirmation, image
rendering, or an export that only consumes a previously loaded snapshot. Long critical sections make
timeouts more likely and increase the impact of process suspension.

## What should take the lock

Take the mutation lock when an operation:

- reads the current project and writes a new project document;
- changes project-owned durable resources whose consistency depends on that same document;
- performs a migration that derives output from the current revision.

Do not take it for:

- schema validation of already loaded data;
- rendering an immutable snapshot;
- computing a revision hash;
- reading public metadata without writing;
- exporting from a fixed snapshot when publication has its own safe staging contract.

Atomic resource publication and project mutation locking solve related but distinct problems. A lock
does not make a partially written asset safe, and atomic file replacement does not serialize two
transactions.

An editor-started agent run is a third writer: its `screenshots` CLI child takes this lock for each
write like any CLI process. The editor's own HTTP writers do not contend with it: each one is admitted
by an in-process gate for its whole operation and answers `423 agent-running` while a run holds the
project (`apps/web/lib/agents/agent-run-guard.server.ts`). A run waits for admitted writes to finish
before it snapshots under this lock, and the server restores that snapshot under this lock when the
run leaves an invalid document or the user undoes the run (`docs/architecture.md`, § 6).

## Local filesystem boundary

Screenshot Studio supports this coordinator for processes on one machine accessing one local project
filesystem. Even though `proper-lockfile` describes broader filesystem compatibility, Screenshot
Studio does not claim distributed-lock semantics for NFS, SMB, cloud-synced folders, containers with
different clocks, or multiple machines mutating one shared project.

A community storage adapter for shared storage must provide a coordinator appropriate to that
topology, such as a database transaction, compare-and-swap revision, or a dedicated distributed lease.
It must not reuse this adapter and imply guarantees Screenshot Studio has not tested.

## Errors and recovery

### Acquisition timeout

The caller receives an error containing the operation path and an underlying library error in
`cause`. Treat it as a conflict with another local writer:

1. Let the active CLI/editor operation finish.
2. Retry the complete operation from a fresh project snapshot.
3. If no writer appears active, wait through the stale threshold before considering manual action.

Do not delete the directory merely because an operation is taking longer than expected. Removing a
live owner's lease can create the exact overlap the lock is designed to prevent.

### Project path cannot be resolved

The document was removed, renamed, or never existed. Fix the project path or use the project creation
flow. Creating an empty lock for a missing document would introduce an ambiguous identity.

### Compromised lock

Assume the current mutation did not complete safely. Restart the process if necessary, reload the
project, and rerun the operation. Never persist the previous in-memory result without a new lock and a
new read.

### Release failure

The atomic project write may already have completed even though removing the lease directory failed.
Treat the result as indeterminate rather than blindly repeating the same command: reload the project,
confirm its current revision, and only then decide whether the business mutation still needs to run.
The abandoned directory stops receiving heartbeats and becomes recoverable through the normal stale
path. When both the operation and release fail, `AggregateError` retains both diagnostics.

### Lock directory remains after a crash

Normal stale recovery is automatic on the next acquisition. Manual deletion is a last resort only
after confirming that no Screenshot Studio CLI or editor process is still writing the project.

## Testing ownership

Core tests own the coordination contract:

```bash
rtk pnpm exec vitest run packages/core/src/storage/project-lock.test.ts
```

They cover bounded metadata, timeouts, stale recovery, idempotent cleanup, symlink aliases, real
child-process exclusion, `SIGKILL` recovery, and multiple concurrent writer processes.

CLI tests own the caller-level lost-update regression:

```bash
rtk pnpm exec vitest run packages/cli/src/project-io.test.ts
```

Browser E2E is not the right layer for this contract. A browser cannot add evidence about atomic
directory creation, child-process death, or filesystem lease recovery. Run a browser scenario only
when a separate editor persistence workflow changes and genuinely requires the real Next.js host and
user interaction.

Completion checks for lock changes are:

```bash
rtk pnpm test:core
rtk pnpm test:cli
rtk proxy pnpm typecheck
```

## Review checklist for future mutations

- Does the lock cover the initial read as well as the final write?
- Is every awaited operation inside the critical section necessary to calculate or persist the change?
- Does failure release through `withProjectMutation()` or `finally`?
- Does the operation restart from a fresh snapshot after timeout or compromise?
- Are all callers using the core adapter instead of importing `proper-lockfile`?
- Does any new storage topology exceed the documented local-filesystem boundary?
- Is the behavior covered by core/CLI process tests rather than generic browser E2E?
