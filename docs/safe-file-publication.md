# Safe file publication

Screenshot Studio publishes generated files into project-controlled directories. Those directories
may already contain stale files, symbolic links, hard links, or entries created by another local
process. A normal `writeFile(destination)` is therefore not an acceptable commit boundary: it may
follow a link, expose partial bytes, or overwrite a file the current operation does not own.

This document describes the local-filesystem contract implemented by
`packages/cli/src/safe-file-publisher.ts`. It is deliberately narrower than a general storage API.

## iOS mental model

For an iOS developer, the closest mental model is a combination of:

- writing a complete sibling temporary file instead of mutating the visible file in place;
- calling `synchronize()` before making the temporary file visible;
- using an atomic `FileManager`-style move/replace as the commit point;
- retaining `fileResourceIdentifier`-like evidence so cleanup never removes a different file that
  appeared at the same pathname.

The pathname is only a name. Device, inode, content revision, and link count establish which file
the operation actually created or inspected. That distinction is the reason this code is more
careful than a conventional “write temp then rename” helper.

## Owned responsibilities

The publication primitive owns one complete file below one canonical root:

1. Validate a portable project-relative destination before any mutation.
2. Reject symbolic-link or non-directory ancestors and symbolic-link/non-regular leaves.
3. Create a random sibling stage with exclusive, no-follow flags.
4. Write and sync all bytes before publication.
5. Commit with create-only or replace semantics.
6. Reconcile ambiguous filesystem failures that may have happened after the kernel committed the
   link or rename.
7. Remove or quarantine only a stage whose identity and bytes still match the operation’s evidence.

It does **not** own project JSON transactions, complete export directories, or ZIP batches:

- project JSON uses the revision-aware project-file transaction under the project mutation lease;
- bundle publication uses `bundle-publisher.ts`, which validates and commits a complete output set;
- render/export parity remains owned by the shared browser renderer.

## API and examples

Create-only publication is used when the same logical resource may be produced more than once. The
same bytes converge on the existing file; different bytes are a conflict.

```ts
const result = await publishFileSafely({
  root: projectRoot,
  relativePath: "assets/processed/icon-cropped.png",
  bytes: png,
});

// result.created === false means an identical regular file already existed.
```

Replace publication is used for a generated output whose stable pathname intentionally points to
the newest complete result.

```ts
await publishFileSafely({
  root: exportDirectory,
  relativePath: "app-store-screenshots-bundle.zip",
  bytes: archive,
  replace: true,
});
```

Callers pass a root plus a portable relative path rather than an arbitrary absolute destination.
This keeps validation and containment at the mutation boundary.

## Why this is not replaced by an atomic-write package

The required contract is larger than atomic replacement. It includes create-only convergence,
no-follow leaf checks, exact ownership evidence, hard-link count validation, fail-closed cleanup,
and reconciliation when a filesystem operation commits and then reports an error. A library may be
adopted later only if it proves those same observable semantics on the supported Node.js platforms.

This is not a preference for custom code. It is an explicit compatibility test: replacing the
implementation is safe when the existing contract tests continue to pass without weakening their
assertions.

## Security boundary and limitations

The implementation protects normal local project workflows from unsafe pre-existing entries and
narrows race windows with repeated identity and ancestor checks. It never claims a fully race-free
filesystem namespace:

- Node.js does not expose the complete `openat`/`renameat` directory-handle API needed to eliminate
  continuously malicious ancestor swaps.
- The contract is for a local filesystem. Network/shared mounts require a storage adapter with its
  own coordination and commit semantics.
- A process that can continuously mutate every ancestor under the same OS account remains outside
  the guaranteed threat model.

When the application cannot prove that a file or stage is still the one it owns, it fails closed and
may retain a private recovery entry rather than deleting a possible competitor file. The surfaced
error includes that recovery path so cleanup can be deliberate.

