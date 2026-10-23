# WeighIn Policy Validation Contract

This document describes the authoritative validation rules for WeighIn policy
configuration (`weighin.toml`). The exported schema (`WeighinConfigSchema`,
`RuleValueSchema`, `validateConfig` from `dist/config`) and the runtime
enforcement path (`enforceThresholds` in `dist/threshold`) apply the same rules
from one shared implementation.

## Overview

Before issue #28 the exported Zod schemas in `src/config.ts` were more permissive
than the runtime validation in `src/threshold.ts`. That gap allowed library
consumers to construct configurations that passed `WeighinConfigSchema.safeParse`
but were rejected when `enforceThresholds` ran. The fix moves the authoritative
schema to `src/config.ts` and has `src/threshold.ts` import and re-export it so
there is one definition checked by both surfaces.

## Accepted rule values (`RuleValueSchema`)

A per-metric rule value must be one of:

| Form | Example | Meaning |
|---|---|---|
| `"ignore"` | `"ignore"` | Never fail on this metric |
| `"strict_zero_tolerance"` | `"strict_zero_tolerance"` | Any increase fails |
| `"allow_N_percent_increase"` | `"allow_10_percent_increase"` | Up to N % increase allowed; N must be a nonnegative decimal |
| Nonnegative finite number | `10`, `2.5`, `1e-7`, `0` | Equivalent to `"allow_N_percent_increase"` |

### Deliberate rejections (previously accepted by exported schema)

The following values were accepted by the old exported `RuleValueSchema` but
rejected by the runtime validator. They are now uniformly rejected:

| Value | Reason |
|---|---|
| `"allow_1.2.3_percent_increase"` | More than one decimal point in the percentage |
| `"allow_-1_percent_increase"` | Negative digit sequence in the percentage string |
| `"allow__percent_increase"` | No digits at all |
| Any string not matching the pattern | Does not name a valid policy |
| `-1`, `-0.5`, any negative number | Negative numeric percentages are meaningless |
| `Infinity`, `-Infinity` | Nonfinite numbers cannot represent a percentage cap |
| `NaN` | Not a number; cannot represent a percentage cap |

## Function and aggregate selectors

Keys in `thresholds.functions`, `thresholds.aggregates`, `limits.functions`, and
`limits.aggregates` must be **non-blank strings** (at least one character). Empty
string selectors (`""`) are rejected. Whitespace-only keys are also rejected
because Zod's `z.string().min(1)` rejects any key whose character count is zero
after UTF-8 encoding.

## Global thresholds

`thresholds.global` accepts:

- `fail_on_any_regression: boolean` — must be a boolean; a string such as
  `"true"` or `"false"` is rejected.
- `max_allowed_cpu_increase_pct: number` — nonnegative finite number; negative
  or nonfinite values are rejected.
- `max_allowed_memory_increase_pct: number` — same constraints.

## Absolute limits

Values in `limits.global`, `limits.functions.*`, and `limits.aggregates.*` must
be nonnegative finite numbers. Negative limits are rejected. Zero is valid
(equality passes the limit check).

## Unknown keys

The top-level config object, all threshold sub-objects, and all limit sub-objects
are parsed with `.strict()`. Unknown keys at any level cause a descriptive error
naming the unrecognised field and the file name. Metric keys must be exactly one
of the eleven supported metric names (see `METRIC_KEYS` in `dist/diff`).

## Fail-closed behaviour

When a policy names a metric that is unavailable (e.g. `historical_data_read_bytes`,
`contract_data_hard_limit`, `tx_size_bytes`), `enforceThresholds` produces a
violation rather than silently passing. This applies regardless of whether the
rule is `strict_zero_tolerance`, a percentage cap, or a numeric value. Only
`"ignore"` suppresses the violation for unavailable metrics.

## Public API entry points

All three of the following agree on accepted and rejected inputs:

| Symbol | Module | Purpose |
|---|---|---|
| `RuleValueSchema` | `dist/config` | Validates a single rule value |
| `WeighinConfigSchema` | `dist/config` | Validates a complete policy object |
| `validateConfig` | `dist/config`, re-exported from `dist/threshold` | Validates and returns a typed config; throws on failure |
| `enforceThresholds` | `dist/threshold` | Validates config then enforces against a diff |

`loadConfig` and `loadConfigContent` in `dist/threshold` both call `validateConfig`
internally, so TOML-parsed configs go through the same rules.

## Error messages

Validation errors include the file name (`weighin.toml` when called through
`validateConfig`) and a `- path: message` line for each issue. The file name is
customisable via `formatZodError(error, fileName)` from `dist/config`.

Example error for a malformed rule:

```
Invalid WeighIn configuration in weighin.toml:
- thresholds.functions.hello.cpu_instructions: Invalid rule string. Must be 'ignore', 'strict_zero_tolerance', or 'allow_X_percent_increase' where X is a nonnegative decimal
```
