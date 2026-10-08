# Dependency security review

Reviewed 2026-10-08 against the checked-in npm lockfile. Initial `npm audit`
reported 11 affected packages: 5 moderate, 4 high, 2 critical. This counts affected
packages, not distinct advisories. No forced blanket fix was run.

## Decisions and exposure

| Dependency path | Use / Action reachability | Resolution and compatibility |
|---|---|---|
| Direct `toml@3.0.0` | Runtime policy parsing is reachable before validation. Prototype pollution and parser recursion are relevant to caller-controlled TOML; schema validation alone does not prevent parser side effects | Pin 4.2.0, the patched parser line; a deliberate major update with unchanged parse API. Real configuration tests and hostile-input subprocess tests validate compatibility and rejection |
| `@stellar/stellar-sdk@16.0.1 → axios@1.16.1` | Installed runtime dependency. The default SDK RPC module uses its fetch client; WeighIn does not import the Axios transport subpath. Prototype-pollution gadgets need prior pollution; HTTP2/form serialization/data URL paths are not selected here. Do not infer all SDK consumers are safe | Explicit scoped override to Axios 1.20.0 (same major). Keep SDK 16.0.1 to preserve audited XDR/resource behavior. SDK 16.3.1 still pins 1.18.0, which does not clear newer advisories. Revisit/remove the override once upstream pins a fully patched release; behavior/native/live comparison validation required |
| `@stellar/stellar-sdk → smol-toml@1.8.0` | Runtime SDK dependency, not WeighIn's policy parser. SDK TOML parsing is not used by current RPC measurement entry path | Compatible lock update to 1.9.0 |
| Direct `vitest@2.1.9 → @vitest/mocker, vite-node, tinypool` | Development/test process only, not bundled Action. CI uses run mode without an exposed UI/API server. Tinypool gadgets require prior prototype pollution; tests still execute runner code, so critical findings are not dismissed | Pin Vitest 4.1.11; existing tests pass under its current runner. This deliberate major update removes tinypool/vite-node and patches mocker/UI findings; no product feature change |
| Direct `vite@5.4.21 → esbuild@0.21.5` | Development test-tool chain only; no Vite/esbuild server is exposed by the Action or CI run command. Windows editor/path-server flaws do not describe the Linux Action | Pin compatible Vitest peer Vite 7.3.7; deliberate major tooling update. Vulnerable nested esbuild removed. Direct bundler esbuild 0.25.6 remains unchanged/patched |
| `vite → postcss → source-map-js@1.2.1` | Development source transforms only, not Action execution; indexed-map offsets require malicious input | Compatible lock update to 1.2.2 |

The TOML and test-runner major updates were targeted fixes, not an assertion of
semver compatibility. No SDK/native simulation/library/protocol upgrade was made.
Original hosted/five-run evidence retains original producer versions and hashes.

## Advisory inventory

All moderate/high/critical advisories returned at the baseline are listed below.
Exposure/upgrade decisions follow the dependency-path table above. Entries naming
another package in `via` are aggregate effects of the listed transitive advisories.

| Package | Severity | Advisory |
|---|---|---|
| `@stellar/stellar-sdk` | moderate | Aggregate affected path through `axios` |
| `@vitest/mocker` | moderate | [Vitest: Path Traversal / Arbitrary File Read via @vitest/mocker Redirect Mock](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) |
| `@vitest/mocker` | moderate | Aggregate affected path through `vite` |
| `axios` | moderate | [Axios: Prototype pollution auth subfields can inject Basic auth](https://github.com/advisories/GHSA-xj6q-8x83-jv6g) |
| `axios` | moderate | [Axios: Prototype pollution gadgets can alter axios request construction](https://github.com/advisories/GHSA-mmx7-hfxf-jppx) |
| `axios` | moderate | [Axios: Deep formToJSON Key Recursion Can Cause Denial of Service](https://github.com/advisories/GHSA-pmv8-rq9r-6j72) |
| `axios` | moderate | [Axios: HTTP/2 streamed uploads bypass `maxBodyLength`](https://github.com/advisories/GHSA-mwf2-3pr3-8698) |
| `axios` | high | [Axios Node HTTP adapter can use an inherited proxy after interceptor config cloning](https://github.com/advisories/GHSA-gcfj-64vw-6mp9) |
| `axios` | moderate | [Axios: Nested axios option objects can consume polluted prototype values](https://github.com/advisories/GHSA-7q8q-rj6j-mhjq) |
| `axios` | moderate | [Axios: Fetch adapter `ReadableStream` uploads bypass `maxBodyLength`](https://github.com/advisories/GHSA-jqh4-m9w3-8hp9) |
| `axios` | moderate | [Axios: NO_PROXY bypass for 0.0.0.0 local addresses in axios](https://github.com/advisories/GHSA-f4gw-2p7v-4548) |
| `axios` | moderate | [Axios: Excessive recursion in formDataToJSON can cause denial of service](https://github.com/advisories/GHSA-42h9-826w-cgv3) |
| `axios` | moderate | [Axios form serializer maxDepth bypass via {} metatoken](https://github.com/advisories/GHSA-hcpx-6fm6-wx23) |
| `axios` | moderate | [Axios: Prototype pollution gadget in fetch adapter can alter outbound requests](https://github.com/advisories/GHSA-vh66-26gq-q6x8) |
| `axios` | moderate | [Axios: Prototype-Pollution Gadget in the Default Instance Allows Inherited Object.prototype.method to Override HTTP Method](https://github.com/advisories/GHSA-9fr6-4gfg-395g) |
| `axios` | high | [Axios: ReDoS in fromDataURI data: URL parser freezes the Node event loop (DoS)](https://github.com/advisories/GHSA-c29m-xwm3-cm6r) |
| `axios` | high | [Axios: ReDoS (O(N²)) in shouldBypassProxy host normalization, reachable via untrusted redirect Location](https://github.com/advisories/GHSA-mghh-pgcx-3jjj) |
| `axios` | high | [Axios: Prototype Pollution Gadget in axios toFormData Options](https://github.com/advisories/GHSA-x97p-jq2g-jp4f) |
| `axios` | high | [Axios: HTTP/2 adapter bypasses configured DNS lookup and proxy controls](https://github.com/advisories/GHSA-3pq3-5fj3-cg6v) |
| `axios` | high | [Axios: Denial of Service via Unhandled 'error' Event in HTTP/2 ClientHttp2Session Initialization](https://github.com/advisories/GHSA-542g-h47m-68v8) |
| `axios` | moderate | [Axios: Header Injection via Inherited headers After Minimal Interceptor](https://github.com/advisories/GHSA-j8rh-479h-cp32) |
| `axios` | moderate | [Axios: Fetch Adapter Header Injection via Inherited FormData getHeaders](https://github.com/advisories/GHSA-4hqw-qxg8-jxx2) |
| `axios` | high | [Axios: Node HTTP adapter prototype-pollution gadget allows request socket hijack via inherited createConnection](https://github.com/advisories/GHSA-m8m8-qj5v-23w3) |
| `axios` | moderate | [Axios: CIDR-form NO_PROXY entries are ignored, causing proxy exclusion bypass for internal IP ranges](https://github.com/advisories/GHSA-44g4-m2mj-wpvx) |
| `esbuild` | moderate | [esbuild enables any website to send any requests to the development server and read the response](https://github.com/advisories/GHSA-67mh-4wv8-2f99) |
| `smol-toml` | moderate | [smol-toml: Quadratic-time parse() from parseKey rescanning to end of document on each key line](https://github.com/advisories/GHSA-r4xh-jqrq-34v2) |
| `source-map-js` | high | [source-map-js allows event-loop denial of service through indexed source-map section offsets](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) |
| `tinypool` | critical | [Tinypool: Prototype Pollution gadget in worker options leads to Remote Code Execution](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3) |
| `tinypool` | critical | [Tinypool: Prototype Pollution Gadget to RCE in run() options](https://github.com/advisories/GHSA-85c8-ppgw-ccpr) |
| `toml` | high | [toml-node: Uncontrolled Recursion](https://github.com/advisories/GHSA-82x6-q7mm-w9cf) |
| `toml` | high | [toml-node: Prototype Pollution Leads to `Object.prototype` Corruption via `__proto__` Key-Path Desynchronization](https://github.com/advisories/GHSA-v5mp-jgw5-2x6j) |
| `vite` | moderate | [Vite Vulnerable to Path Traversal in Optimized Deps `.map` Handling](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) |
| `vite` | moderate | [launch-editor: NTLMv2 hash disclosure via UNC path handling on Windows](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) |
| `vite` | high | [vite: `server.fs.deny` bypass on Windows alternate paths](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) |
| `vite` | high | Aggregate affected path through `esbuild` |
| `vite-node` | moderate | Aggregate affected path through `vite` |
| `vitest` | critical | Aggregate affected path through `@vitest/mocker` |
| `vitest` | critical | [When Vitest UI server is listening, arbitrary file can be read and executed](https://github.com/advisories/GHSA-5xrq-8626-4rwp) |
| `vitest` | moderate | [Vitest: Path Traversal / Arbitrary File Read via @vitest/mocker Redirect Mock](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) |
| `vitest` | critical | Aggregate affected path through `tinypool` |
| `vitest` | critical | Aggregate affected path through `vite` |
| `vitest` | critical | Aggregate affected path through `vite-node` |

## Current outcome

After the targeted changes, `npm audit` reports **0 vulnerabilities**, including
0 moderate/high/critical, on the dated lockfile. There are no known remaining npm
advisories in that result. The scoped Axios override remains a maintenance item,
not an unresolved advisory. Re-run audit when installing/upgrading; database
results can change independently of the repository. npm audit does not cover
Cargo crates, Docker images, GitHub Action dependencies or application logic.

Validation: `npm ci`, lint, typecheck, full behavior/Vitest tests, native frozen
replay, build, regenerated bundles and real local control/regression/threshold
verification are required for this change. The stage's actual results are
recorded in [public documentation validation](experiments/public-docs/validation.json).
