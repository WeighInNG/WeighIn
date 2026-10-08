const {test}=require('node:test');
const assert=require('node:assert/strict');
const {analyzeRepeatability}=require('./experiments/repeatability-analysis.cjs');
// Real schema-4 objects from the live Stage 3 proof; altered values below exercise
// analysis behavior only and are never used as live repeatability evidence.
const captured=require('../docs/experiments/metric-provenance/measurements.json');
function runs(){return Array.from({length:5},(_,i)=>({run:i+1,source_snapshot_sha256:'same-source',
  reference_build:{compiled_cache_initial_entries:0,target_directory_existed_at_start:true,wasm_sha256:captured[0].benchmarks[0].wasm_sha256},
  reference_measurements:structuredClone(captured),audit_measurements:structuredClone(captured)}));}
test('five unchanged measured samples produce stable min/max/range and keep unsupported values null',()=>{
  const result=analyzeRepeatability(runs());assert.equal(result.status,'SCOPED_REPEATABILITY_PASS');
  assert.equal(result.clean_reference_builds,5);
  const metrics=result.reference.series[0].metrics;
  assert.equal(metrics.cpu_instructions.range,0);assert.equal(metrics.cpu_instructions.population_standard_deviation,0);
  assert.deepEqual(metrics.ledger_read_bytes.values,[0,0,0,0,0]);
  assert.deepEqual(metrics.tx_size_bytes.values,[null,null,null,null,null]);
  assert.equal(result.cross_machine_build_determinism_proven,false);
});
test('a CPU increase is preserved as variance and a regression, rather than averaged away',()=>{
  const samples=runs();samples[4].reference_measurements[0].benchmarks[0].metrics.cpu_instructions.consumed+=10;
  const result=analyzeRepeatability(samples);assert.equal(result.status,'REPEATABILITY_VARIATION_FOUND');
  assert.equal(result.reference.series[0].metrics.cpu_instructions.range,10);
  assert.ok(result.reference.diffs[4].hasRegression);
});
test('a decrease still marks repeatability variation even when no metric regresses',()=>{
  const samples=runs();samples[4].reference_measurements[0].benchmarks[0].metrics.cpu_instructions.consumed-=10;
  const result=analyzeRepeatability(samples);assert.equal(result.status,'REPEATABILITY_VARIATION_FOUND');
  assert.equal(result.reference.diffs[4].hasRegression,false);
});
test('different WASM with stable consumption is separately identified as artifact variation',()=>{
  const samples=runs();samples[4].reference_build.wasm_sha256='different';
  for(const b of samples[4].reference_measurements[0].benchmarks)b.wasm_sha256='different';
  const result=analyzeRepeatability(samples);assert.equal(result.status,'REPEATABILITY_VARIATION_FOUND');
  assert.equal(result.reference.metrics_stable,true);assert.equal(result.reference.wasm_stable,false);
});
test('four samples, duplicate run numbers, changed source and nonempty target cannot prove five clean runs',()=>{
  assert.throws(()=>analyzeRepeatability(runs().slice(0,4)),/at least five/);
  for(const change of [r=>{r[4].run=1;},r=>{r[4].source_snapshot_sha256='changed';},r=>{r[4].reference_build.compiled_cache_initial_entries=1;}]){
    const samples=runs();change(samples);assert.throws(()=>analyzeRepeatability(samples),/run number|Source snapshot|empty Cargo/);
  }
});
test('measurement/build hash disagreement and changed benchmark cases fail instead of disappearing from the series',()=>{
  const mismatch=runs();mismatch[4].reference_build.wasm_sha256='different';
  assert.throws(()=>analyzeRepeatability(mismatch),/Measured WASM differs/);
  const removed=runs();removed[4].audit_measurements[0].benchmarks.pop();
  assert.throws(()=>analyzeRepeatability(removed),/benchmark identities changed/);
});
test('different compute calibration fails and full-config metadata drift is recorded independently of metric stability',()=>{
  const incompatible=runs();incompatible[4].reference_measurements[0].benchmarks[0].provenance.compute_config_sha256='changed';
  assert.throws(()=>analyzeRepeatability(incompatible),/Incompatible measurement environment/);
  const samples=runs();samples[4].reference_measurements[0].benchmarks[0].provenance.config_sha256='changed';
  const result=analyzeRepeatability(samples);assert.equal(result.status,'SCOPED_REPEATABILITY_PASS');
  assert.equal(result.reference.series[0].full_config_hashes.length,2);
});
