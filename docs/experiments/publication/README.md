# Published-revision hosted evidence

Downloaded from public PR #13 runs on reviewed head
`bbbe9001bbd375fd6a1ff75be5da2593c86fff20`; actual PR merge checkout is
`85cc2766b2323ffa26cf761b8c70581e1a96c22c`.

`control`, `regression` and `threshold` are unchanged downloaded artifact
contents, including their producer-created SHA256 manifests. Top-level run,
job and artifact JSON came directly from the GitHub API after completion.
Validation-line extracts select test totals, installation audit outcomes and
policy exit evidence from public job logs; ANSI formatting is stripped only.
They are extracts, not complete logs or evidence that npm audit is a blocking
hosted gate. Full logs remain available at the recorded run/job URLs.

`core-report` and `example-report` retain each benchmark producer's artifact.
The comment is updated in place: the example body was checked immediately after
its consumer, then the final body was checked against the core report after its
consumer. `comment.json` preserves the latter body and the equality outcomes.
Comment workflow source is trusted default-branch code, not PR code.

The threshold process exits 1 because strict CPU policy is violated; its step
is explicitly continued and a subsequent mandatory verifier passes. The enclosing
job is green. No ordinary CI failure is being hidden or labeled a passing proof.

GitHub artifacts have 30-day retention. `sha256.json` seals retained files other
than itself; nested scenario manifests remain those produced by the harness.
The published source revision remains available independently of artifact expiry.
