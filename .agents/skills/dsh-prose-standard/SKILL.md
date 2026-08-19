---
name: dsh-prose-standard
description: Write and review precise DSH repository prose with complete behavioral coverage and one authoritative home per fact. Use for package READMEs, public JSDoc, Agent Notes, architecture or subsystem documentation, user guides, and code comments when a change needs durable explanation, a decision record, bilingual maintenance, or an editorial pass that removes duplication and reasoning transcripts.
---

# DSH Prose Standard

## Establish scope

1. Read the root `AGENTS.md`, the nearest subtree `AGENTS.md`, and the source that owns the behavior. For files under `docs/`, also read `docs/AGENTS.md` and use its tier taxonomy to choose the document that owns each fact.
2. Identify the reader, the durable fact being documented, and its authoritative owner before editing prose. Keep the full fact at that owner and replace repetitions elsewhere with a relative Markdown link.
3. Read only the owner documents needed for the change. Do not load or rewrite adjacent histories, catalogs, notes, or translations unless the changed behavior reaches them.

## Write complete prose

Cover only applicable obligations, but do not omit a material one:

- Name the actor, operation, conditions, inputs, defaults, outputs, and durable state.
- State failure behavior, timing, cancellation, retry or idempotency behavior when callers rely on it.
- State ownership, lifetime, permission, isolation, and safe-use constraints when they affect use.
- State supported extension points and real limitations; do not speculate about future work.
- For model-visible behavior, describe what reaches the model, when it appears, its size or lifetime constraints, and its cache effect at the package-owned Model Experience section. Follow `docs/cookbook/adding-a-package.md` for that section's required structure.
- For public JSDoc, document the obligations of callers and implementers at the declaration that owns them. Keep local comments for non-obvious safe-use facts; do not restate types or control flow.

Use `contract` only for caller or implementer obligations such as preconditions, postconditions, invariants, and compatibility promises. Use `boundary` only for a literal process, wire, security, transaction, or lifecycle boundary. Name the exact type, field, API, command, check, or behavior instead of using `shape`, `surface`, `gate`, or another metaphor.

## Record decisions

For a non-trivial decision, update the active Agent Note that owns the rationale or create the required note in the repository's established location. Record the problem constraints, chosen mechanism, rejected material alternatives, consequences, and verification that protects the decision.

Write implemented notes in present tense. Describe shipped behavior, not a migration plan, acceptance checklist, implementation diary, test walkthrough, PR narrative, or review transcript. Link from the runtime or package documentation to the rationale only where that rationale helps future maintainers.

## Maintain bilingual pairs

When an in-scope document has an English/Chinese pair, read `docs/i18n/terminology.md` and the applicable rules in `docs/i18n/README.md`. Update both languages in the same pass, preserve matching Markdown structure and link targets, compare the result clause by clause, then record the confirmed pair with:

```sh
pnpm run verify-translation-pairing --write <pair>
```

Do not invoke an extended translation workflow unless the user explicitly requests it. Do not hand-edit generated English references; run their owner generator, update the reviewed Chinese counterpart, and record the pair.

## Edit and verify

1. Write current-state prose with direct subjects and verbs. Keep one physical line per paragraph and use emphasis only when it changes behavior.
2. Remove implementation chronology, obvious code narration, duplicated inventories, hand-restated generated catalogs, unsupported claims, and adjectives that do not add a testable fact.
3. Compare every behavioral statement against source, configuration, and tests. Preserve exact identifiers and distinguish requirements from possibilities.
4. Check links and the smallest repository verifier that owns the edited files. Run corpus-wide documentation checks only when the task or repository release gate requires them.
5. Re-read the finished text without implementation context. It must identify the behavior, its conditions, its consequences, and its authoritative owner without relying on a reasoning transcript.
