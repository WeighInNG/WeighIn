# Soroban simulation fixtures

Run these commands from the repository root with the [contributor toolchain](../CONTRIBUTING.md#install)
and a running protocol-28 standalone network. Build the example contracts with
the reference crate's manifest and lockfile in an ignored build directory.

## Sample contract

The self-contained [sample contract](sample-contract/) provides persistent
storage reads and writes plus a recursive Fibonacci computation. Build it from
the repository root with:

```bash
stellar contract build --locked --manifest-path examples/sample-contract/Cargo.toml
```

Its [fixture](sample-contract/weighin-fixtures.json) covers all three
operations and points at the WASM artifact produced by that command.

```bash
set -e
for name in storage auth verifier; do
  project="examples/target/fixture-$name"
  mkdir -p "$project/src"
  cp contract/Cargo.toml contract/Cargo.lock "$project/"
  cp "examples/fixture-$name.rs" "$project/src/lib.rs"
  stellar contract build --locked --optimize=true --manifest-path "$project/Cargo.toml"
done
npm run build
node dist/cli.js examples/large-storage-fixture.json --output examples/target/storage-results.json
node dist/cli.js examples/auth-tree-fixture.json --output examples/target/auth-results.json
```

## Large storage reads

The constructor commits sixteen persistent entries, each containing a 2 KiB
value. The fixture compares a one-key control that returns 2,048 with a
sixteen-key read that returns 32,768. Compare `ledger_read_entries` to verify
the larger footprint. Protocol 28 charges live Soroban reads as in-memory
reads, so the 32 KiB payload does not imply 32 KiB of charged disk reads.
Use the input pattern for threshold scenarios and measure charged disk reads
separately with supported classic ledger entries. See
[metric provenance](../docs/metric-provenance.md) for both metric definitions.

## Nested authorization

The approval contract requires the buyer and seller to authorize the root
call. Each party also authorizes two verifier calls, one for review and one
for confirmation of the same order. The verifier address is bound from the
committed dependency deployment. For an integration that needs existing
accounts, replace the two public addresses with distinct funded accounts on
your standalone ledger. WeighIn's simulation records authorization and does
not establish that a production transaction has valid signatures.
