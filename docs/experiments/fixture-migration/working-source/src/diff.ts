import { ComputeProvenance } from './simulation';
import { ContractBenchmark, BenchmarkResult, Metrics, MetricValue } from './measurement';

// All 11 metric keys in display order
export const METRIC_KEYS = [
  'cpu_instructions',
  'memory_bytes',
  'ledger_read_entries',
  'ledger_read_bytes',
  'ledger_write_entries',
  'ledger_write_bytes',
  'historical_data_read_bytes',
  'contract_data_hard_limit',
  'tx_size_bytes',
  'events_count',
  'event_data_bytes',
] as const;

export type MetricKey = typeof METRIC_KEYS[number];

export interface MetricDiff {
  key: MetricKey;
  base: MetricValue;
  head: MetricValue;
  /** Absolute change: head.consumed - base.consumed */
  delta: number | null;
  availability: 'comparable' | 'unavailable';
  reason?: string;
  /** Percentage change relative to base.consumed, or null when base.consumed === 0 */
  pct: number | null;
  /** True if head.consumed > base.consumed */
  regression: boolean;
}

export interface BenchmarkIdentity {
  function_name: string;
  case_id?: string;
}

export interface FunctionDiff extends BenchmarkIdentity {
  metrics: MetricDiff[];
  base_provenance?: ComputeProvenance;
  head_provenance?: ComputeProvenance;
  /** True if any metric regressed */
  hasRegression: boolean;
}

export interface ContractDiff {
  fixture_id?: string;
  logical_id?: string;
  /** Compatibility alias for head_contract_id. */
  contract_id: string;
  base_contract_id: string;
  head_contract_id: string;
  base_commit: string;
  head_commit: string;
  functions: FunctionDiff[];
  /** True if any function in this contract has a regression */
  hasRegression: boolean;
  /** Functions present in head but missing from base (new functions) */
  newFunctions: string[];
  /** Functions present in base but missing from head (removed functions) */
  removedFunctions: string[];
  /** Includes case additions/removals within an existing function. */
  newBenchmarks: BenchmarkIdentity[];
  removedBenchmarks: BenchmarkIdentity[];
}

export interface DiffResult {
  contracts: ContractDiff[];
  /** True if any contract has a regression */
  hasRegression: boolean;
  /** Contracts present in head but not base */
  newContracts: string[];
  /** Contracts present in base but not head */
  removedContracts: string[];
}

function diffMetrics(base: Metrics, head: Metrics): MetricDiff[] {
  return METRIC_KEYS.map((key) => {
    const b = base?.[key];
    const h = head?.[key];
    for (const value of [b, h]) {
      if (!value) throw new Error(`Missing metric ${key}; use an explicit unavailable record`);
      if (value.availability !== undefined && !['measured', 'unavailable'].includes(value.availability)) throw new Error(`Invalid metric availability ${key}`);
      if (value.availability === 'unavailable') {
        if (value.consumed !== null || !value.reason?.trim()) throw new Error(`Invalid unavailable metric ${key}`);
      } else if (value.consumed === null || !Number.isSafeInteger(value.consumed) || value.consumed < 0) {
        throw new Error(`Invalid measured metric ${key}`);
      }
      if (value.limit !== null && (!Number.isSafeInteger(value.limit) || value.limit < 0)) throw new Error(`Invalid metric limit ${key}`);
    }
    if (b.consumed === null || h.consumed === null) {
      return { key, base: b, head: h, availability: 'unavailable' as const,
        reason: [b.reason && `BASE: ${b.reason}`, h.reason && `HEAD: ${h.reason}`].filter(Boolean).join('; '),
        delta: null, pct: null, regression: false };
    }
    const delta = h.consumed - b.consumed;
    const pct = b.consumed === 0 ? null : (delta / b.consumed) * 100;
    return { key, base: b, head: h, availability: 'comparable' as const, delta, pct, regression: delta > 0 };
  });
}

function diffFunctions(
  baseFns: BenchmarkResult[],
  headFns: BenchmarkResult[]
): Pick<ContractDiff, 'functions' | 'newFunctions' | 'removedFunctions' | 'newBenchmarks' | 'removedBenchmarks'> {
  const baseMap = benchmarkMap(baseFns);
  const headMap = benchmarkMap(headFns);

  const baseNames = new Set(baseFns.map((fn) => fn.function_name));
  const headNames = new Set(headFns.map((fn) => fn.function_name));
  const newFunctions = [...headNames].filter((name) => !baseNames.has(name));
  const removedFunctions = [...baseNames].filter((name) => !headNames.has(name));
  const newBenchmarks: BenchmarkIdentity[] = [];
  const removedBenchmarks: BenchmarkIdentity[] = [];
  const functions: FunctionDiff[] = [];

  for (const [key, fn] of headMap) {
    if (!baseMap.has(key)) newBenchmarks.push(benchmarkIdentity(fn));
  }
  for (const [key, fn] of baseMap) {
    if (!headMap.has(key)) removedBenchmarks.push(benchmarkIdentity(fn));
  }

  for (const [key, headFn] of headMap) {
    const baseFn = baseMap.get(key);
    if (!baseFn) continue;

    if (baseFn.provenance || headFn.provenance) {
      const fields = ['source', 'source_version', 'protocol', 'helper_sha256', 'network_id', 'compute_config_sha256', 'seed', 'auth_mode', 'host_features'] as const;
      for (const field of fields) {
        if (!baseFn.provenance || !headFn.provenance || JSON.stringify(baseFn.provenance[field]) !== JSON.stringify(headFn.provenance[field])) {
          throw new Error(`Incompatible measurement environment: ${field}`);
        }
      }
      if (JSON.stringify(baseFn.provenance?.resource_limits_sha256) !== JSON.stringify(headFn.provenance?.resource_limits_sha256)) {
        throw new Error('Incompatible measurement environment: resource_limits_sha256');
      }
      if (headFn.provenance?.resource_limits_sha256) {
        for (const metric of METRIC_KEYS) {
          for (const field of ['availability', 'source', 'limit', 'limit_source', 'limit_reason'] as const) {
            if (baseFn.metrics[metric][field] !== headFn.metrics[metric][field]) {
              throw new Error(`Incompatible metric semantics: ${metric}.${field}`);
            }
          }
        }
      }
    }
    const metrics = diffMetrics(baseFn.metrics, headFn.metrics);
    const hasRegression = metrics.some((m) => m.regression);
    functions.push({ ...benchmarkIdentity(headFn), metrics, hasRegression, base_provenance: baseFn.provenance, head_provenance: headFn.provenance });
  }

  return { functions, newFunctions, removedFunctions, newBenchmarks, removedBenchmarks };
}

function benchmarkIdentity(fn: BenchmarkResult): BenchmarkIdentity {
  return { function_name: fn.function_name, ...(fn.case_id === undefined ? {} : { case_id: fn.case_id }) };
}

function benchmarkMap(functions: BenchmarkResult[]): Map<string, BenchmarkResult> {
  const result = new Map<string, BenchmarkResult>();
  for (const fn of functions) {
    if (!nonblank(fn.function_name)) throw new Error('Benchmark function_name must not be blank');
    const key = JSON.stringify([fn.function_name, fn.case_id ?? null]);
    if (result.has(key)) throw new Error(`Duplicate benchmark identity: ${key}`);
    result.set(key, fn);
  }
  return result;
}

function contractKey(contract: ContractBenchmark): string {
  const logical = contract.schema_version !== undefined || contract.fixture_id !== undefined || contract.logical_id !== undefined;
  if (!logical) {
    if (contract.benchmarks.some((fn) => fn.case_id !== undefined)) {
      throw new Error('Case identity requires fixture and logical contract identities');
    }
    return JSON.stringify(['legacy', contract.contract_id]);
  }
  if (![2, 3, 4].includes(contract.schema_version!) || !nonblank(contract.fixture_id) || !nonblank(contract.logical_id)
      || contract.benchmarks.some((fn) => !nonblank(fn.case_id))) {
    throw new Error('Version 2/3/4 results require fixture_id, logical_id, and case_id for every benchmark');
  }
  return JSON.stringify(['logical', contract.fixture_id, contract.logical_id]);
}

function nonblank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function contractMap(contracts: ContractBenchmark[]): Map<string, ContractBenchmark> {
  const result = new Map<string, ContractBenchmark>();
  for (const contract of contracts) {
    const key = contractKey(contract);
    if (result.has(key)) throw new Error(`Duplicate logical contract identity: ${key}`);
    // Validate even unmatched contracts: never silently discard duplicate cases.
    benchmarkMap(contract.benchmarks);
    for (const benchmark of contract.benchmarks) {
      diffMetrics(benchmark.metrics, benchmark.metrics); // Validate unmatched records too.
      if (contract.schema_version === 3 || contract.schema_version === 4) {
        if (!benchmark.provenance) throw new Error(`Schema ${contract.schema_version} benchmarks require compute provenance`);
        for (const field of ['source', 'source_version', 'helper_sha256', 'network_id', 'compute_config_sha256', 'header_sha256', 'snapshot_sha256', 'config_sha256', 'input_sha256', 'auth_mode'] as const) {
          if (!nonblank(benchmark.provenance[field])) throw new Error(`Invalid compute provenance: ${field}`);
        }
        if (!Number.isSafeInteger(benchmark.provenance.ledger) || benchmark.provenance.ledger < 0
          || !Number.isSafeInteger(benchmark.provenance.protocol)
          || !Array.isArray(benchmark.provenance.host_features) || !benchmark.provenance.host_features.every(nonblank)) {
          throw new Error('Invalid compute provenance: ledger/protocol/host_features');
        }
        if (!Array.isArray(benchmark.provenance.seed) || benchmark.provenance.seed.length !== 32
          || !benchmark.provenance.seed.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) {
          throw new Error('Invalid compute provenance: seed');
        }
        for (const key of METRIC_KEYS) {
          const value = benchmark.metrics[key];
          if (value.availability === undefined || (value.availability === 'measured' && !nonblank(value.source))) {
            throw new Error(`Schema ${contract.schema_version} requires explicit availability and measured source for ${key}`);
          }
          if (contract.schema_version === 4 && value.availability === 'measured') {
            if (value.limit === null ? !nonblank(value.limit_reason) : !nonblank(value.limit_source)) {
              throw new Error(`Schema 4 requires explicit limit provenance for ${key}`);
            }
          }
        }
        if (contract.schema_version === 4 && !/^[a-f0-9]{64}$/.test(benchmark.provenance.resource_limits_sha256 ?? '')) {
          throw new Error('Schema 4 requires resource_limits_sha256');
        }
      }
    }
    result.set(key, contract);
  }
  return result;
}

export function contractLabel(contract: Pick<ContractBenchmark, 'fixture_id' | 'logical_id' | 'contract_id'>): string {
  return contract.logical_id === undefined ? contract.contract_id : `${contract.fixture_id} / ${contract.logical_id}`;
}

/**
 * Compute a structural diff between a base and head measurement run.
 *
 * Versions 2–4 contracts match by (fixture_id, logical_id), and invocations by
 * (function_name, case_id). Runtime addresses and WASM hashes may differ.
 * Legacy results only match other legacy results by runtime address/function;
 * mixed schemas never guess a match. Additions/removals are not regressions.
 */
export function diffBenchmarks(
  base: ContractBenchmark[],
  head: ContractBenchmark[]
): DiffResult {
  const baseMap = contractMap(base);
  const headMap = contractMap(head);

  const newContracts: string[] = [];
  const removedContracts: string[] = [];
  const contracts: ContractDiff[] = [];

  for (const [key, contract] of headMap) {
    if (!baseMap.has(key)) newContracts.push(contractLabel(contract));
  }
  for (const [key, contract] of baseMap) {
    if (!headMap.has(key)) removedContracts.push(contractLabel(contract));
  }

  for (const [key, headContract] of headMap) {
    const baseContract = baseMap.get(key);
    if (!baseContract) continue;

    if (baseContract.schema_version !== headContract.schema_version) throw new Error('Cannot compare measurements with different schema versions');
    if (headContract.schema_version === 3 && [...baseContract.benchmarks, ...headContract.benchmarks].some(fn => !fn.provenance)) {
      throw new Error('Schema 3 benchmarks require compute provenance');
    }
    const benchmarkDiff = diffFunctions(
      baseContract.benchmarks,
      headContract.benchmarks
    );
    const hasRegression = benchmarkDiff.functions.some((f) => f.hasRegression);

    contracts.push({
      fixture_id: headContract.fixture_id,
      logical_id: headContract.logical_id,
      contract_id: headContract.contract_id,
      base_contract_id: baseContract.contract_id,
      head_contract_id: headContract.contract_id,
      base_commit: baseContract.git_commit,
      head_commit: headContract.git_commit,
      ...benchmarkDiff,
      hasRegression,
    });
  }

  return {
    contracts,
    hasRegression: contracts.some((c) => c.hasRegression),
    newContracts,
    removedContracts,
  };
}
