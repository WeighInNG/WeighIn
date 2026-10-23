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

export interface DependencyNode {
  id: string;
  depends_on?: string[];
}

/**
 * Compute a deterministic topological deployment order for fixture contract declarations (#213).
 * Rejects unknown dependency targets, self-dependencies, and dependency cycles before deployment.
 */
export function resolveTopologicalDeploymentOrder<T extends DependencyNode>(
  nodes: readonly T[],
): T[] {
  const byId = new Map<string, T>();
  for (const node of nodes) {
    if (!node.id || !node.id.trim()) {
      throw new Error(
        "Dependency declaration requires a non-empty contract id",
      );
    }
    if (byId.has(node.id)) {
      throw new Error(`Duplicate contract id in dependency graph: ${node.id}`);
    }
    byId.set(node.id, node);
  }

  const state = new Map<string, "visiting" | "visited">();
  const ordered: T[] = [];

  const visit = (id: string, stack: string[]) => {
    const current = state.get(id);
    if (current === "visited") return;
    if (current === "visiting") {
      throw new Error(
        `Cyclic fixture dependency detected: ${[...stack, id].join(" -> ")}`,
      );
    }

    const node = byId.get(id);
    if (!node) {
      throw new Error(`Unknown fixture dependency target: ${id}`);
    }

    state.set(id, "visiting");
    for (const dep of node.depends_on ?? []) {
      if (dep === id) {
        throw new Error(`Contract cannot depend on itself: ${id}`);
      }
      if (!byId.has(dep)) {
        throw new Error(
          `Contract ${id} depends on unknown contract prerequisite: ${dep}`,
        );
      }
      visit(dep, [...stack, id]);
    }
    state.set(id, "visited");
    ordered.push(node);
  };

  for (const node of nodes) {
    visit(node.id, []);
  }

  return ordered;
}
