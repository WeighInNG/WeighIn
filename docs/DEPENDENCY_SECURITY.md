# Dependency inventory

`docs/dependency-inventory.json` is generated as a CycloneDX 1.6 JSON bill of
materials from the committed `package-lock.json`,
`native/simulation/Cargo.lock`, both Action bundles, and the package file list.
The output contains no build timestamp or machine-specific paths.

Regenerate or verify it with:

```bash
npm run inventory:generate
npm run inventory:check
```

## Identity and inclusion

Each external component is identified by ecosystem, package name, and exact
locked version in its Package URL (`pkg:npm/...` or `pkg:cargo/...`). Different
versions and ecosystems remain separate. Repeated npm installations with the
same identity become one component with all sorted install locations and the
union of their dependency edges. Conflicting package records are not resolved
by guessing a version.

The `weighin:classification` property distinguishes:

- `shipped-runtime`: the production npm lock graph, including packages
  conservatively retained when they are not statically visible in a bundle;
- `native-helper`: the Cargo lock graph for the Linux x64 simulation helper;
  `weighin:target-inclusion` records whether Cargo selects each locked package
  for that target, so platform-conditional lock entries remain visible without
  implying that they are built for Linux x64;
- `build-tooling`: npm development dependencies used by build, bundle, lint,
  and test tooling, plus their locked transitive dependencies;
- `dev-only`: remaining npm development dependencies.

`weighin:bundle-evidence` names the bundle containing a package installation
marker. A production package with no such marker carries
`weighin:bundle-inclusion=not-statically-emitted...`; it remains in the
inventory because the production lock graph is included conservatively. The
application component records `package.json`'s `files` entries and both
committed bundle paths. Cargo components retain their lock source and checksum,
the helper target (`x86_64-unknown-linux-gnu`), Cargo's target-filtered active
features, and target inclusion resolved by `cargo metadata --filter-platform`.
Generation requires the repository's pinned Cargo 1.95.0 toolchain and locally
available locked crates; Cargo metadata runs offline and does not update the
lockfile.

Missing source, integrity, or checksum data is represented by a
`weighin:metadata-gap` property. Exact versions are never inferred from a
manifest range. The packed consumer check confirms that the generated BOM and
the files it describes are present in the normal npm package.

This is a reproducible component and provenance inventory. It is not
vulnerability clearance, a license/legal certification, or a claim that every
locked component is statically reachable at runtime.

## GitHub Actions workflow pins

Active workflow Actions use full commit SHAs. The following pins resolve the
previous moving `@v4` references to the listed upstream releases:

| Original ref | Upstream release | Commit | Official upstream reference |
|---|---|---|---|
| `actions/checkout@v4` | `v4.2.2` | `11bd71901bbe5b1630ceea73d27597364c9af683` | [release](https://github.com/actions/checkout/releases/tag/v4.2.2), [commit](https://github.com/actions/checkout/commit/11bd71901bbe5b1630ceea73d27597364c9af683) |
| `actions/setup-node@v4` | `v4.4.0` | `49933ea5288caeca8642d1e84afbd3f7d6820020` | [release](https://github.com/actions/setup-node/releases/tag/v4.4.0), [commit](https://github.com/actions/setup-node/commit/49933ea5288caeca8642d1e84afbd3f7d6820020) |
| `actions/upload-artifact@v4` | `v4.6.2` | `ea165f8d65b6e75b540449e92b4886f43607fa02` | [release](https://github.com/actions/upload-artifact/releases/tag/v4.6.2), [commit](https://github.com/actions/upload-artifact/commit/ea165f8d65b6e75b540449e92b4886f43607fa02) |
| `actions/download-artifact@v4` | `v4.3.0` | `d3f86a106a0bac45b974a628896c90dbdf5c8093` | [release](https://github.com/actions/download-artifact/releases/tag/v4.3.0), [commit](https://github.com/actions/download-artifact/commit/d3f86a106a0bac45b974a628896c90dbdf5c8093) |
| `actions/cache@v4` | `v4.2.4` | `0400d5f644dc74513175e3cd8d07132dd4860809` | [release](https://github.com/actions/cache/releases/tag/v4.2.4), [commit](https://github.com/actions/cache/commit/0400d5f644dc74513175e3cd8d07132dd4860809) |

Existing SHA-pinned Rust-toolchain and WeighIn consumer references are retained.
To update a pin, resolve the chosen release tag through the Action's official
repository (for example, `gh api repos/actions/checkout/commits/v4.2.2 --jq .sha`),
review the upstream release and commit, then update the workflow SHA, adjacent
version comment, and this table together. Keep local `uses: ./...` references
local; the workflow test enforces full SHAs for third-party references without
scanning historical experiment snapshots.
