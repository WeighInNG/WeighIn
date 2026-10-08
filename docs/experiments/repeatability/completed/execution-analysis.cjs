// Experiment analysis only; production diff/policy semantics remain unchanged.
const { diffBenchmarks, METRIC_KEYS } = require('../../dist/diff');
const unavailableKeys = ['historical_data_read_bytes','contract_data_hard_limit','tx_size_bytes'];
function cases(records) {
  const result = new Map();
  for (const contract of records) for (const benchmark of contract.benchmarks) {
    const key = JSON.stringify([contract.fixture_id,contract.logical_id,benchmark.function_name,benchmark.case_id]);
    if (result.has(key)) throw new Error('Duplicate repeatability benchmark');
    result.set(key,benchmark);
  }
  if (!result.size) throw new Error('Empty repeatability measurements');
  return result;
}
function analyzeSeries(samples) {
  const first = cases(samples[0]);
  const maps = samples.map(cases);
  for (const map of maps) {
    if (JSON.stringify([...map.keys()].sort()) !== JSON.stringify([...first.keys()].sort())) {
      throw new Error('Repeatability benchmark identities changed');
    }
  }
  // Validate schemas, provenance compatibility and records through the public API.
  const diffs = samples.map(records => diffBenchmarks(samples[0],records));
  const series = [...first].map(([identity]) => {
    const benchmarks = maps.map(map => map.get(identity));
    const metrics = Object.fromEntries(METRIC_KEYS.map(key => {
      const values = benchmarks.map(b => b.metrics[key].consumed);
      if (values.every(value => value === null)) {
        return [key,{availability:'unavailable',values,reason:benchmarks[0].metrics[key].reason}];
      }
      if (values.some(value => value === null)) throw new Error(`Metric availability changed: ${key}`);
      const minimum = Math.min(...values), maximum = Math.max(...values);
      const mean = values.reduce((sum,value)=>sum+value,0)/values.length;
      const standardDeviation = Math.sqrt(values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length);
      return [key,{availability:'measured',values,min:minimum,max:maximum,range:maximum-minimum,mean,
        population_standard_deviation:standardDeviation,stable:minimum===maximum}];
    }));
    return {identity,wasm_hashes:[...new Set(benchmarks.map(b=>b.wasm_sha256))],metrics,
      ledgers:benchmarks.map(b=>b.provenance.ledger),
      snapshot_hashes:[...new Set(benchmarks.map(b=>b.provenance.snapshot_sha256))],
      full_config_hashes:[...new Set(benchmarks.map(b=>b.provenance.config_sha256))],
      compute_config_hashes:[...new Set(benchmarks.map(b=>b.provenance.compute_config_sha256))],
      resource_limit_hashes:[...new Set(benchmarks.map(b=>b.provenance.resource_limits_sha256))]};
  });
  return {series,diffs,metrics_stable:series.every(s=>Object.values(s.metrics).every(m=>m.availability==='unavailable'||m.stable)),
    wasm_stable:series.every(s=>s.wasm_hashes.length===1)};
}
function analyzeRepeatability(runs) {
  if (runs.length<5) throw new Error('Repeatability requires at least five completed runs');
  const numbers = new Set(runs.map(run=>run.run));
  if (numbers.size!==runs.length || runs.some(run=>!Number.isInteger(run.run)||run.run<1)) throw new Error('Duplicate/invalid run number');
  if (new Set(runs.map(run=>run.source_snapshot_sha256)).size!==1) throw new Error('Source snapshot changed between runs');
  for (const run of runs) {
    if (run.reference_build.compiled_cache_initial_entries!==0 || !run.reference_build.target_directory_existed_at_start) {
      throw new Error('A reference build did not start with a verified empty Cargo target directory');
    }
    for (const benchmark of cases(run.reference_measurements).values()) {
      if (benchmark.wasm_sha256!==run.reference_build.wasm_sha256) throw new Error('Measured WASM differs from clean build');
    }
  }
  const reference=analyzeSeries(runs.map(run=>run.reference_measurements));
  const audit=analyzeSeries(runs.map(run=>run.audit_measurements));
  const stable=reference.metrics_stable&&reference.wasm_stable&&audit.metrics_stable&&audit.wasm_stable;
  return {status:stable?'SCOPED_REPEATABILITY_PASS':'REPEATABILITY_VARIATION_FOUND',completed_runs:runs.length,
    clean_reference_builds:runs.length,compiled_artifact_cache_reused_between_reference_builds:false,
    audit_wasm_reused:true,reference,audit,unavailable_metrics:unavailableKeys,
    public_github_ci_proven:false,cross_machine_build_determinism_proven:false,
    arbitrary_live_state_determinism_proven:false};
}
module.exports={analyzeRepeatability};
