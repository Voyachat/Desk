# Package and install a plugin

English | [中文](publish.zh.md)

The previous tutorials loaded a local plugin through a `--patch` overlay. This tutorial packages it as an installable **bundle**, installs it into a **profile** with `dsh plugin add`, and explains the layer order that determines the composed configuration. It assumes the `dsh` CLI is installed. Complete [plugin configuration](./config.md) first.

To use a fresh source checkout instead, complete the [run-from-source section](../../../../README.md#run-from-source), keep this tutorial's `hello-plugin` directory at the repository root, and run the remaining `dsh ...` commands from there as `pnpm dsh ...`. See [source execution](../../../../apps/cli/reference/README.md#source-execution) for build and launcher behavior.

## Two concepts, two manifests

Installation is built on two concepts. Both are described by a `package.json`, but they carry different kinds of manifest under the `dsh` key, and they answer different questions:

- A **bundle** is an npm package that ships a configuration layer. Its manifest declares `dsh.bundle`, answering "what does this package contribute?": a patch file that inserts or overrides plugin rows.
- A **profile** is a directory under `$VOYASEEK_HOME/profiles/<name>` describing one runnable composition. Its manifest declares `dsh.profile`, answering "which bundles compose this setup, in what order?".

A bundle is what you author and distribute; a profile is what a user boots with `dsh --profile <name>`. Nothing is both.

### The bundle manifest

Create the package directory:

```sh
mkdir -p hello-plugin
```

```
hello-plugin/
├── package.json       # declares dsh.bundle
├── cordis.patch.yml   # the layer applied when a profile lists this bundle
└── index.js           # plugin modules the patch rows reference
```

Create `hello-plugin/package.json`:

```json
{
  "name": "dsh-hello-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

Create `hello-plugin/index.js` with the plugin entry point:

```js
export const name = 'hello-plugin'

export function apply() {
  console.log('[hello-plugin] plugin loaded!')
}
```

Create `hello-plugin/cordis.patch.yml`. The patch is a YAML array like the `--patch` overlays you have been writing, except plugin rows reference the package by name instead of a relative source path so Node resolution finds the installed code:

```yaml
- insert:
    - id: hello
      name: dsh-hello-plugin
```

A package without the `dsh.bundle` declaration still installs, but only as a plain dependency: `dsh plugin` prints a warning and activates no layer. Use that package format for a library that plugin packages import rather than a plugin users enable.

### The profile manifest

A profile directory holds two files:

- `package.json` — the profile's out-of-tree plugin dependencies (managed by pnpm) plus the `dsh.profile` manifest with its ordered `bundles` list.
- `cordis.patch.yml` — the user's own patch layer, applied after every bundle layer.

You never write a profile manifest by hand: `dsh plugin` creates and maintains it. The next section shows the result.

## Install into a profile

`dsh plugin --profile <name> audit <artifact>` reviews a local directory or tarball without installing it. From the directory that contains `hello-plugin`, review the development checkout first:

```sh
dsh plugin --profile demo audit ./hello-plugin
```

The report marks a directory as mutable and prints its SHA-256. After reviewing every warning, install those exact bytes with the printed digest:

```sh
dsh plugin --profile demo add ./hello-plugin --approve-audit sha256:<digest-from-report>
```

The first successful add initializes the profile (with `@voyaseek-ai/dsh-base` as its first bundle), pnpm links the checkout with lifecycle scripts disabled, and `dsh` appends the bundle to `dsh.profile.bundles` because the package declares `dsh.bundle`:

```json
{
  "name": "dsh-profile-demo",
  "private": true,
  "dependencies": {
    "dsh-hello-plugin": "link:/path/to/hello-plugin"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@voyaseek-ai/dsh-base",
        "dsh-hello-plugin"
      ]
    }
  }
}
```

Verify the layer without booting, then boot:

```sh
dsh --profile demo --dump-config   # shows a "# == dsh-hello-plugin" layer
dsh --profile demo
```

`dsh plugin --profile demo remove dsh-hello-plugin` removes both the dependency and the layer.

## The loading order

The effective configuration composes over an empty root by applying, in order:

1. Each bundle patch named in the profile's `dsh.profile.bundles` list, in list order — `@voyaseek-ai/dsh-base` first, then each installed bundle in the order it was added.
2. The profile's own `cordis.patch.yml`.
3. The home-level `$VOYASEEK_HOME/cordis.patch.yml` — machine-local preferences shared by every profile.
4. Each `--patch <path>` overlay, in argv order.

App arguments are not another patch layer. A surface bundle can resolve them through an ordinary app-owned service, described below.

Later layers win per row, and a patch replaces a row's entire `config` value rather than deep-merging keys. Two consequences for bundle authors:

- Your patch can override rows from earlier layers by `id` — the same way [the `dsh-web-app` bundle](../../../../packages/bundle/web-app/cordis.patch.yml) overrides `dsh-base` rows — but must restate every key the row needs, not just the changed one.
- Users can override your rows in their profile's `cordis.patch.yml` without touching your package, so prefer configuration defaults users are likely to keep and let the schema carry the rest.

In-box bundle names always resolve from the dsh installation itself; pnpm manages only out-of-tree packages, so your bundle can rely on `@voyaseek-ai/dsh-base` being present and current.

## Give a surface bundle its own command line

A bundle that defines a runnable app mounts an ordinary provider plugin:

```yaml
- id: hello-startup
  name: 'dsh-hello-plugin/startup'
```

The plugin exports `inject = ['cmdlineArgs']`, calls `parseCmdline` from [`@voyaseek-ai/dsh-cmdline`](../../../../packages/boot/cmdline/README.md) with its own commander program, and provides its app-owned service from the program's action. The launcher hands every plugin the same immutable arguments after launcher flags, so app-specific flags need no launcher change and multiple plugins may parse the snapshot. The Loader row needs no launcher marker or special kind.

Rows configured by those arguments inject the provider's service and read it from their own `!!js` options, with the deployment value beside it as the fallback:

```yaml
- id: my-app
  name: '@example/my-app'
  inject: [myAppStartup]
  config:
    port: !!js ctx.myAppStartup.port ?? 8080
```

On `--help`, the provider publishes no service, so those rows never activate. Loader mounts the composition once, waits for each row's ordinary injections, and only then evaluates that row's `!!js` config against its injected context.

## Distribute a built, reviewable artifact

Direct npm and GitHub specs are rejected because the CLI cannot yet bind their resolution and complete dependency graph to the pre-install report. Ship a built tarball instead:

```sh
pnpm pack
dsh plugin --profile demo audit ./hello-plugin-1.0.0.tgz
dsh plugin --profile demo add ./hello-plugin-1.0.0.tgz
```

The package must already contain its declared `main` file and `dsh.bundle.patch`. Installation always disables dependency lifecycle scripts, so `prepare`, `install`, or `postinstall` cannot create missing output. The audit also requires a license field, rejects package-manager configuration and archive links, and reports runtime capability indicators plus dependencies that were not recursively inspected.

If the tarball report contains warnings, re-run `add` with its exact digest:

```sh
dsh plugin --profile demo add ./hello-plugin-1.0.0.tgz --approve-audit sha256:<digest-from-report>
```

Digest approval acknowledges the listed static-review gaps; it does not authorize install-time scripts, and it is not proof that the package or its dependencies are benign.

## Next steps

- [Plugins and lifecycle](../framework/) — the full plugin lifecycle
- [CLI behavior reference](../../../../apps/cli/reference/README.md) — exact layer precedence, flags, and profile mechanics
