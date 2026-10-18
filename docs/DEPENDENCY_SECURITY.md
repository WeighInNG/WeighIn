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

Validation: `npm ci`, lint, typecheck, full behavior/Vitest tests, native frozen
replay, build, regenerated bundles and real local control/regression/threshold
verification are required for this change. The stage's actual results are
recorded in [public documentation validation](experiments/public-docs/validation.json).

## Workflow Action pinning

Reviewed 2026-10-16 across the five active files in
[.github/workflows](../.github/workflows). Every third-party `uses:` reference is
now a full commit SHA resolved from the official repository, so a moving tag or
branch cannot change runner behavior independently of the reviewed revision. Local
(`./`) entries, the previously reviewed `dtolnay/rust-toolchain` pins and the
immutable WeighIn consumer pins were left byte-identical, as were all permissions,
fork event guards and the expected-negative threshold proof.

`npm audit` does not cover GitHub Action dependencies; this pin inventory is the
corresponding control for workflow dependencies, and
`tests/workflow-action-pins.test.cjs` enforces it on every PR.

| Action | Original ref | Resolved commit | Official upstream reference | Human-readable |
|---|---|---|---|---|
| `actions/checkout` | `actions/checkout@v4` | `11d5960a326750d5838078e36cf38b85af677262` | [actions/checkout](https://github.com/actions/checkout) tag `v4.4.0` | v4.4.0 |
| `actions/setup-node` | `actions/setup-node@v4` | `49933ea5288caeca8642d1e84afbd3f7d6820020` | [actions/setup-node](https://github.com/actions/setup-node) tag `v4.4.0` | v4.4.0 |
| `actions/upload-artifact` | `actions/upload-artifact@v4` | `ea165f8d65b6e75b540449e92b4886f43607fa02` | [actions/upload-artifact](https://github.com/actions/upload-artifact) tag `v4.6.2` | v4.6.2 |
| `actions/download-artifact` | `actions/download-artifact@v4` | `d3f86a106a0bac45b974a628896c90dbdf5c8093` | [actions/download-artifact](https://github.com/actions/download-artifact) tag `v4.3.0` | v4.3.0 |
| `dtolnay/rust-toolchain` | `dtolnay/rust-toolchain@master` | `683b588c487a69d01f6c6ddf40f036ff682cc2c8` | [dtolnay/rust-toolchain](https://github.com/dtolnay/rust-toolchain) branch `master` at 2026-10-16 | `master` |
| `dtolnay/rust-toolchain` | `dtolnay/rust-toolchain@d1031067263f94b142dd6c0ce24c5eb9d02d52a0` (unchanged) | `d1031067263f94b142dd6c0ce24c5eb9d02d52a0` | [dtolnay/rust-toolchain](https://github.com/dtolnay/rust-toolchain) commit, already reviewed | `d103106726` |
| `WeighInNG/WeighIn` | `WeighInNG/WeighIn@bbbe9001bbd375fd6a1ff75be5da2593c86fff20` (unchanged) | `bbbe9001bbd375fd6a1ff75be5da2593c86fff20` | [WeighInNG/WeighIn](https://github.com/WeighInNG/WeighIn) revision verified by PR #13 | `bbbe9001bb` |
| `WeighInNG/WeighIn/comment` | `WeighInNG/WeighIn/comment@bbbe9001bbd375fd6a1ff75be5da2593c86fff20` (unchanged) | `bbbe9001bbd375fd6a1ff75be5da2593c86fff20` | [WeighInNG/WeighIn](https://github.com/WeighInNG/WeighIn) `comment` subdirectory | `bbbe9001bb` |

Frozen experiment snapshots under `docs/experiments/**` are historical evidence and
are deliberately outside this inventory and outside the check; they keep the moving
refs they ran with.

### Updating a workflow Action pin

1. Resolve the intended ref from the official repository only:
   `git ls-remote https://github.com/<owner>/<repo> <ref>`. Never resolve through a
   mirror and never write a SHA from memory.
2. Review the resolved commit and its diff against the current pin. Stay on the same
   major version and toolchain unless a separate, explicitly scoped change covers
   that upgrade.
3. Replace every occurrence in `.github/workflows/`, keep the
   `# <version> (resolved from <ref>)` annotation on the same line, and refresh the
   table above.
4. Run `npm test`; the workflow pin check rejects moving, dynamic or unreviewed
   references and stale documentation. Then run the normal PR CI.
5. Leave local `./` entries, published consumer pins and everything under
   `docs/experiments/**` untouched.
