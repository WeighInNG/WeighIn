import * as path from "path";
import { ZodError } from "zod";
import type { FixturesSpec, ContractSpec, InvocationSpec } from "./measurement";
import { FixturesSpecSchema, formatZodError } from "./config";

export interface IdentifiedInvocation extends InvocationSpec {
  case_id: string;
}

export interface IdentifiedContract extends ContractSpec {
  logical_id: string;
  invocations: IdentifiedInvocation[];
}

export interface IdentifiedFixtures extends FixturesSpec {
  fixture_id: string;
  contracts: IdentifiedContract[];
}

function relativePath(value: string): string {
  const portable = value.replace(/\\/g, "/");
  if (path.posix.isAbsolute(portable) || /^[A-Za-z]:/.test(portable)) {
    throw new Error(
      `Comparison identity requires a relative path or an explicit id: ${value}`,
    );
  }
  return path.posix.normalize(portable);
}

// Argument object key order is irrelevant; argument array order is significant.
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

/** Resolve logical identities before any deployment or simulation side effects.
 * fixturePath is a stable workspace-relative path, shared by BASE and HEAD.
 * Explicit ids are scoped to their fixture/contract, not global names.
 */
export function parseFixtures(
  raw: string,
  fixturePath: string,
): IdentifiedFixtures {
  let fixtures: ReturnType<typeof FixturesSpecSchema.parse>;
  try {
    fixtures = FixturesSpecSchema.parse(JSON.parse(raw));
  } catch (err) {
    if (err instanceof ZodError) {
      throw new Error(formatZodError(err, fixturePath));
    }
    throw err;
  }
  const fixture_id =
    fixtures.id === undefined
      ? `path:${relativePath(fixturePath)}`
      : `id:${fixtures.id}`;
  const contractIds = new Set<string>();
  const contracts = fixtures.contracts.map((contract) => {
    const logical_id =
      contract.id === undefined
        ? `wasm:${relativePath(contract.wasm_path)}`
        : `id:${contract.id}`;
    if (contractIds.has(logical_id)) {
      throw new Error(
        `Duplicate logical contract identity in ${fixture_id}: ${logical_id}`,
      );
    }
    contractIds.add(logical_id);

    const caseIds = new Set<string>();
    const invocations = contract.invocations.map((invocation) => {
      const args = invocation.args.map((arg) => ({
        type: arg.type.toLowerCase(),
        value: canonical(arg.value),
      }));
      const case_id =
        invocation.id === undefined
          ? `args:${JSON.stringify(args)}`
          : `id:${invocation.id}`;
      const key = JSON.stringify([invocation.function_name, case_id]);
      if (caseIds.has(key)) {
        throw new Error(
          `Duplicate benchmark identity in ${logical_id}: ${invocation.function_name} / ${case_id}. Set distinct invocation ids.`,
        );
      }
      caseIds.add(key);
      return { ...invocation, case_id };
    });
    return { ...contract, logical_id, invocations };
  });
  return { ...fixtures, fixture_id, contracts };
}

export interface SetupResultBindingRecord {
  expectedType: string;
  value: unknown;
}

/**
 * Resolve typed setup-result bindings (`$setup:<bindingId>[.<fieldOrIndex>]`) into
 * concrete call arguments while validating expected types and rejecting malformed paths (#215).
 */
export function resolveSetupResultBinding(
  reference: string,
  expectedType: string,
  bindings: Readonly<Record<string, SetupResultBindingRecord>>,
): unknown {
  if (!reference.startsWith("$setup:")) {
    throw new Error(`Invalid setup-result reference prefix: ${reference}`);
  }
  const rawPath = reference.slice("$setup:".length).trim();
  if (
    !rawPath ||
    rawPath.startsWith(".") ||
    rawPath.endsWith(".") ||
    rawPath.includes("..")
  ) {
    throw new Error(`Malformed setup-result binding path: ${reference}`);
  }

  const segments = rawPath.split(".");
  const rootId = segments[0];
  if (!/^[A-Za-z0-9_-]+$/.test(rootId)) {
    throw new Error(`Invalid setup-result binding identifier: ${rootId}`);
  }

  const record = bindings[rootId];
  if (!record) {
    throw new Error(`Unknown setup-result binding: ${rootId}`);
  }

  if (record.expectedType.toLowerCase() !== expectedType.toLowerCase()) {
    throw new Error(
      `Setup-result binding type mismatch for ${rootId}: expected ${expectedType}, got ${record.expectedType}`,
    );
  }

  let current: any = record.value;
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(seg)) {
        throw new Error(
          `Invalid array index "${seg}" in setup-result binding ${reference}`,
        );
      }
      const idx = Number(seg);
      if (idx < 0 || idx >= current.length) {
        throw new Error(
          `Out-of-bounds array index ${idx} in setup-result binding ${reference}`,
        );
      }
      current = current[idx];
    } else if (current !== null && typeof current === "object") {
      if (!Object.prototype.hasOwnProperty.call(current, seg)) {
        throw new Error(
          `Missing field "${seg}" in setup-result binding ${reference}`,
        );
      }
      current = current[seg];
    } else {
      throw new Error(
        `Cannot traverse segment "${seg}" on scalar setup-result binding ${reference}`,
      );
    }
  }

  return current;
}
