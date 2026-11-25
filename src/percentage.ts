// SPDX-License-Identifier: Apache-2.0
export interface PercentageLimit {
  numerator: bigint;
  denominator: bigint;
  text: string;
}

const DECIMAL_PATTERN = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
const RULE_PATTERN = /^allow_(\d+(?:\.\d+)?)_percent_increase$/;
const MAX_DECIMAL_SCALE = 4096;

export function parsePercentageLimit(
  value: number | string,
): PercentageLimit | null {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    text = String(value);
  } else if (typeof value === "string") {
    const named = value.match(RULE_PATTERN);
    if (!named) return null;
    text = named[1];
  } else {
    return null;
  }

  const match = text.match(DECIMAL_PATTERN);
  if (!match) return null;

  const whole = match[1];
  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? "0");
  if (
    !Number.isSafeInteger(exponent) ||
    fraction.length > MAX_DECIMAL_SCALE ||
    Math.abs(exponent) > MAX_DECIMAL_SCALE
  )
    return null;

  const scale = fraction.length - exponent;
  if (Math.abs(scale) > MAX_DECIMAL_SCALE) return null;

  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "");
  let numerator = BigInt(digits);
  let denominator = 1n;
  if (scale > 0) denominator = 10n ** BigInt(scale);
  else if (scale < 0) numerator *= 10n ** BigInt(-scale);

  return { numerator, denominator, text };
}

export function percentageLimitText(value: number | string): string {
  return parsePercentageLimit(value)?.text ?? String(value);
}

export function comparePercentageToLimit(
  delta: number,
  base: number,
  limit: number | string,
): -1 | 0 | 1 {
  const parsed = parsePercentageLimit(limit);
  if (!parsed) throw new Error(`Invalid percentage limit: ${String(limit)}`);
  if (!Number.isSafeInteger(delta))
    throw new Error(
      `Cannot evaluate percentage policy with unsafe delta ${delta}`,
    );
  if (!Number.isSafeInteger(base) || base < 0)
    throw new Error(
      `Cannot evaluate percentage policy with unsafe baseline ${base}`,
    );

  if (base === 0) return delta === 0 ? 0 : delta > 0 ? 1 : -1;

  const left = BigInt(delta) * 100n * parsed.denominator;
  const right = parsed.numerator * BigInt(base);
  return left > right ? 1 : left < right ? -1 : 0;
}
