# Agent Note: Audited plugin discovery and local installation

Status: implemented

English | [中文](2026-08-18-audited-plugin-discovery-and-install.zh.md)

## Problem

The profile plugin command forwarded arbitrary arguments directly to pnpm, so discovery and installation had no shared trust state: a catalog entry could become an executable dependency before the product had inspected its package metadata, bundle patch, runtime entry, source capabilities, or lifecycle scripts. Git and registry specifications also resolved mutable remote names inside the package manager, after any separate source review had finished.

## Decision

The base composition mounts a read-only `find_dsh_plugin` tool adapted from the MIT-licensed `awesome-dsh-plugin/dsh-find-plugin` baseline recorded in [the open-source adoption ledger](../../../../.open-source/adoptions.yaml). It searches only the curated machine-readable catalog, validates every external field, retains one bounded validated catalog per plugin instance, and marks every result `unreviewed`. The tool exposes source and package metadata but no executable install command; catalog inclusion never becomes installation authority.

`dsh plugin audit` and `dsh plugin add` accept one local directory, `.tgz`, or `.tar.gz`. The audit reads regular files without executing package code, rejects filesystem and archive links, traversal paths, special files, package-manager configuration, missing identity, license, `dsh.bundle.patch`, valid patch YAML, or built `main`, and reports lifecycle scripts, dependencies, opaque runtimes, oversized unscanned text, and source indicators for privileged runtime capabilities. The report digest covers every accepted source path and byte in deterministic order.

Blocking findings stop `add` before profile initialization. Warnings require the exact report digest through `--approve-audit`; installation still forces pnpm `--ignore-scripts`. Remote npm and GitHub specifications, `link:`, install aliases, and update aliases fail closed until the CLI can resolve their exact artifacts and dependency graph before pnpm mutation. A local directory remains a development-only warning because the installed link can change after review; a built tarball is the immutable delivery path.

## Alternatives considered

Installing directly from the community catalog was rejected because the catalog explicitly provides discovery rather than security review, and its GitHub specifications do not pin a commit. Copying the upstream auto-evolution installer was rejected because its SATA license and old package namespace are unsuitable for source adoption, while its subprocess and filesystem mutation authority exceeds discovery. Relying only on pnpm's lifecycle-script policy was rejected because runtime plugin code and dependencies execute when the profile boots even if install scripts never run. Writing a tar parser was rejected in favor of the maintained `node-tar` dependency; this use only lists entries and applies stricter path, link, file-count, and byte limits without extraction.

## Consequences

Users can search the current curated DSH ecosystem from the agent and install a locally reviewed artifact without any install-time package code execution. Digest approval is an acknowledgment of listed static-analysis gaps, not a claim that the plugin or dependencies are benign. Remote one-command installation, recursive dependency source review, signature verification, binary inspection, and sandboxed runtime activation remain unavailable; those operations fail or appear as explicit warnings instead of silently weakening the review. The CLI exposes only audit, add, remove, and direct-dependency list operations; arbitrary pnpm execution verbs are not part of plugin management.
