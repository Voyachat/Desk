# Aistaff Desktop Supervisor source record

This directory is an internal source copy. It is not an open-source adoption and must not be published independently.

## Source baseline

- Source repository: `/Users/baron/projects/Aistaff-Client` (historical local checkout reference only; it is not a build or runtime dependency)
- Source path: `services/desktop-supervisor`
- Git commit: `e1bd6f56a582af97ff31b55fa11a480de809f391`
- Crate tree object: `c668981e0b9418a264d35297c09d3bb2271eca0e`
- `Cargo.toml` blob: `0e907b22641537922ff0db2e491ff513816ebce3`
- `Cargo.lock` blob: `96a4a499a3ae533c58ab1d059973df7e4f9e7105`
- `src` tree object: `4b5907c4c0ccf5caab1a4ec6db016f0cb40b1d63`
- `tests` tree object: `023ef46883211788256e3dfb55e949af730a119f`
- Package license metadata: `UNLICENSED`
- Package publication metadata: `publish = false`

## Internal rights gate

Copying, modifying, packaging, or distributing this source requires confirmation that the AiDesktop project has the necessary internal rights for the source baseline. `UNLICENSED` does not grant third-party reuse rights. Keep the crate private and do not register it as open source.

## Copied scope

The copy contains `Cargo.toml`, `Cargo.lock`, `src/**`, and `tests/**`. It excludes `target/**`, `native/**`, generated artifacts, credentials, and repository-local runtime state.

## Local differences

None in the copied crate files. `Cargo.toml`, `Cargo.lock`, `src/**`, and `tests/**` match the recorded source baseline byte for byte. `UPSTREAM.md` records provenance and `.gitignore` excludes the standalone Cargo build directory; neither changes the crate source.

## Upgrade procedure

1. Confirm internal reuse rights for the target source revision.
2. Record the target repository commit and the crate, manifest, lockfile, `src`, and `tests` Git object IDs.
3. Check that `services/desktop-supervisor` has no uncommitted changes.
4. Replace only `Cargo.toml`, `Cargo.lock`, `src/**`, and `tests/**`; continue to exclude generated artifacts and secrets.
5. Compare the copied scope byte for byte and document every intentional local difference in this file.
6. Run the locked tests, formatting check, and Clippy against this standalone manifest before integrating the binary with Electron.
