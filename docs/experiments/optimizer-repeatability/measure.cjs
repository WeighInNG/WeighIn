const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root='/home/mxr/Documents/localRepo/Weighin';
const {runMeasurement}=require(root+'/.stage6-delivery/dist/measurement');
const {diffBenchmarks}=require(root+'/.stage6-delivery/dist/diff');
const dir=root+'/.stage6-delivery/docs/experiments/optimizer-repeatability/live';
async function main(){
 const rows=[],results={};
 for(const mode of ['system-temp','workspace-temp']){
  results[mode]=[];
  for(let i=1;i<=5;i++){
   const fixture=JSON.parse(fs.readFileSync(root+'/.stage6-delivery/docs/experiments/external-soroban-forge/integration/weighin-fixtures.json'));
   fixture.contracts[0].wasm_path=root+`/.stage6b-work/temp-${mode}-${i}.wasm`;
   const file=path.join(dir,`${mode}-${i}-fixtures.json`);fs.writeFileSync(file,JSON.stringify(fixture,null,2)+'\n');
   const result=await runMeasurement({fixturesPath:file,fixtureId:'weighin-fixtures.json',gitCommit:'07d7935234e9c86816116471121998b871b68439',sdkVersion:'28.0.0',rpcUrl:'http://localhost:18000/rpc',keyFile:root+'/.stage6b-work/private-key'});
   fs.writeFileSync(path.join(dir,`${mode}-${i}-results.json`),JSON.stringify(result,null,2)+'\n');results[mode].push(result);
   const bench=result[0].benchmarks[0];rows.push({mode,run:i,wasm_sha256:bench.wasm_sha256,metrics:Object.fromEntries(Object.entries(bench.metrics).filter(([,m])=>m.availability==='measured').map(([k,m])=>[k,m.consumed]))});console.log(JSON.stringify(rows.at(-1)));
  }
 }
 for(const mode of Object.keys(results))for(const result of results[mode]){
  const diff=diffBenchmarks(results[mode][0],result);assert.equal(diff.contracts.length,1);assert.ok(diff.contracts[0].functions[0].metrics.filter(m=>m.availability==='comparable').every(m=>m.delta===0));
 }
 const diff=diffBenchmarks(results['system-temp'][0],results['workspace-temp'][0]);fs.writeFileSync(path.join(dir,'diff.json'),JSON.stringify(diff,null,2)+'\n');
 assert.equal(diff.contracts[0].functions[0].metrics.find(m=>m.key==='cpu_instructions').delta,-2);
 fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify({status:'VERIFIED',five_live_runs_per_mode:true,within_mode_all_measured_deltas_zero:true,cross_mode_cpu_delta:-2,rows},null,2)+'\n');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
