# Agent Note: DSH release snapshot import and rebrand epochs

Status: implemented

English | [中文](2026-08-20-dsh-release-snapshot-import.zh.md)

## Problem

AiDesktop follows the DSH source repository while carrying Voyaseek branding, an Electron product shell, and Aistaff plugins. Merging an official release directly into the product branch makes each upgrade repeat source discovery, branding edits, provenance checks, and conflict classification. Keeping a second editable product fork would instead let product behavior diverge silently. Branding rules also evolve: applying a newer codemod to an older release must not mutate the identity of a previously recorded release baseline.

The rc.5 to rc.8 upgrade exposed two additional integration hazards. Generated JavaScript and declarations left under `src/` can survive a merge after upstream deletes them and can shadow current TypeScript during Vite resolution. A formerly product-specific image-context injection can also duplicate new upstream generic Code Mode forwarding. Rebranding `DSH_HOME` to `VOYASEEK_HOME` changes the environment key without changing the requirement that browser launcher subprocesses must not inherit a private product home. A semantic merge can also preserve an obsolete product default after upstream changes it: rc.8 uses English when a browser names no shipped language, while the rc.5 shared locale constant still selected Chinese. Client package manifests and a rebrand scan over Git-tracked files exposed two more mechanical hazards: static-only or peer-installed Client inputs can be misclassified as runtime dependencies, and a tracked file deleted in the worktree can make a read-only codemod fail before it reports brand residue.

## Decision

AiDesktop keeps one editable product source tree. The official DSH checkout under `/Users/baron/projects/开源代码` is a clean, read-only review input and never a runtime dependency. Each adopted release is represented by two local immutable snapshot chains created by [`scripts/import-dsh-release.ts`](../../../../scripts/import-dsh-release.ts): an exact raw upstream tree and the same tree after the repository's mechanical rebrand. The raw snapshot tree must equal the official commit tree. Snapshot commits record the upstream commit, tree, and tag; rebranded snapshots also record the exact rebrand script blob.

The importer accepts an official tag and can accept the recorded exact commit for a historical tag that upstream no longer exposes. It verifies checkout origin, cleanliness, release ancestry, tree identity, deterministic parentage, immutable refs, and rebrand idempotence. It does not merge a product branch, update [`.open-source/adoptions.yaml`](../../../../.open-source/adoptions.yaml), push, package, sign, notarize, or publish. Those remain explicit acceptance and release decisions after product validation.

A rebrand rule change creates a script-hash epoch instead of rewriting prior rebranded snapshots. The epoch is `r` plus the first twelve hexadecimal characters of the script blob. Its branch is `codex/dsh-upstream-rebranded-snapshots-r<hash>` and its tags carry the same suffix; a slash is not used because these refs share the existing non-epoch branch prefix. Both releases in one upgrade pair use one epoch and therefore one script blob. Callers explicitly select `--recorded-rebrand-epoch` to replay an existing chain or `--current-rebrand-epoch` to create the current script epoch; when the current and recorded blobs differ, an implicit choice fails. A historical script is applied twice and must leave the tree unchanged on replay, while a current script uses its stronger `--check` mode after the first application. The three metadata omissions in the first frozen refs are accepted only for their exact snapshot commits; every new snapshot records the complete upstream commit, tree, and tag.

The rebrand codemod ignores tracked paths that no longer exist in the worktree and protects `.open-source/**`, legal attribution, vendored provenance, the importer, and its recorded upstream facts. Public manifest fields that use `dsh` as a protocol or package identity remain `dsh`; they are not product-visible brand copy. User-visible names, assets, client wordmarks, and product copy are owned by the Client brand plugin and upstream brand slots. Aistaff behavior remains in `packages/aistaff/**` plugin packages and product compositions rather than changes to the agent loop or generic client framework. Client package manifests classify static build inputs as development dependencies and peer-installed DSH relationships as peer plus development dependencies; `verify-client-packages` rejects a runtime dependency that violates that ownership.

The shared locale fallback is English, matching rc.8 browser behavior and the Host model-language context when no explicit preference exists. The source plane must not contain generated `.js`, `.d.ts`, or source-map siblings that shadow owned `.ts` or `.tsx` files. Release merges delete upstream-removed generated residue before source-plane validation. Build output remains in declared artifact directories and a completed build must not recreate those `src/` files.

Generic Code Mode forwarding owns image-bearing sub-tool context. `tool-fs/read_image` returns the image result but does not separately call `deferContext()` for a parent execution. The subprocess environment scrubber removes credential-shaped variables, every case-insensitive `DSH_*` key, and the exact case-insensitive `VOYASEEK_HOME` key; a caller may still pass a deliberate replacement through its explicit child `env` option.

## Alternatives considered

- **Maintain an editable upstream fork beside the product tree.** Rejected because fixes and product changes can land in either tree, making the next release comparison depend on undocumented branch state.
- **Rebase the product branch directly onto every official release.** Rejected because it mixes upstream identity, mechanical branding, and product integration in one conflict surface and provides no immutable raw or rebranded comparison point.
- **Store a general patch pool and replay it wholesale.** Rejected because unrelated features become order-dependent. Product capabilities belong in plugins; unavoidable core deltas need an owner, focused coverage, an upstream retirement point, and a deletion condition.
- **Rewrite old rebranded snapshots whenever branding changes.** Rejected because a snapshot would stop identifying the tree previously reviewed and merged. A script-hash epoch makes changed rules explicit without losing history.
- **Rename every `dsh` occurrence.** Rejected because package names, manifests, protocol identifiers, provenance, and legal attribution are not user-visible DeepSeek branding and must retain their authoritative identity.
- **Keep the `read_image` special-case injection after rc.8.** Rejected because the generic Code Mode bridge now forwards image-bearing sub-results and the special case injects the same image twice.

## Consequences

- An upgrade starts from exact, reviewable raw and mechanically rebranded release trees while product work continues in one branch.
- Branding-rule changes produce a new epoch and may require importing both the previous and target releases under that epoch before comparison.
- Adoption metadata advances only after source, package, assembled-client, and keyless snapshot validation; snapshot creation alone is not acceptance.
- Upstream feature adoption is cheaper when Voyaseek and Aistaff behavior remains behind Cordis plugins, Client slots, and product composition entries.
- Upgrade review must still classify semantic product conflicts, SQLite changes, provider behavior, packaging, and release evidence. The importer intentionally cannot decide those questions.
- Locale, Client dependency classification, deleted-worktree rebrand, source-plane residue, Code Mode image, and launcher environment tests remain required regression evidence for the failure modes found during the rc.8 merge.
