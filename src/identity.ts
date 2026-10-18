import * as path from "path";
import type { FixturesSpec, ContractSpec, InvocationSpec } from "./measurement";
import { FixturesSpecSchema } from "./config";

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
export function canonical(value: any): any {
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

/**
 * Canonicalize an invocation argument and any nested typed nodes (vec / map)
 * using conversion semantics matching toScVal:
 * - Lowercases the type property of top-level and nested typed vec/map nodes.
 * - Recursively processes elements within `vec` and key/value pairs within `map`.
 * - Preserves string payloads, numbers, booleans, addresses, and unrelated objects without alteration.
 * - Sorts object keys deterministically.
 */
export function canonicalArg(arg: { type: string; value: any }): {
  type: string;
  value: any;
} {
  const normalizedType = arg.type.toLowerCase();
  const val = arg.value;
  if (normalizedType === "vec" && Array.isArray(val)) {
    return {
      type: normalizedType,
      value: val.map((item) => {
        if (
          item !== null &&
          typeof item === "object" &&
          typeof item.type === "string" &&
          "value" in item
        ) {
          return canonicalArg(item);
        }
        return canonical(item);
      }),
    };
  }
  if (normalizedType === "map" && Array.isArray(val)) {
    return {
      type: normalizedType,
      value: val.map((entry) => {
        if (entry !== null && typeof entry === "object") {
          const sortedKeys = Object.keys(entry).sort();
          const canonicalEntry: Record<string, any> = {};
          for (const k of sortedKeys) {
            if (
              (k === "key" || k === "value") &&
              entry[k] !== null &&
              typeof entry[k] === "object" &&
              typeof entry[k].type === "string" &&
              "value" in entry[k]
            ) {
              canonicalEntry[k] = canonicalArg(entry[k]);
            } else {
              canonicalEntry[k] = canonical(entry[k]);
            }
          }
          return canonicalEntry;
        }
        return canonical(entry);
      }),
    };
  }
  return {
    type: normalizedType,
    value: canonical(val),
  };
}

/** Resolve logical identities before any deployment or simulation side effects.
 * fixturePath is a stable workspace-relative path, shared by BASE and HEAD.
 * Explicit ids are scoped to their fixture/contract, not global names.
 */
export function parseFixtures(
  raw: string,
  fixturePath: string,
): IdentifiedFixtures {
  const fixtures = FixturesSpecSchema.parse(JSON.parse(raw));
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
      const args = invocation.args.map((arg) => canonicalArg(arg));
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
