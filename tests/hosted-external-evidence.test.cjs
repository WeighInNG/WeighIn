const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');const {xdr,scValToNative}=require('@stellar/stellar-sdk');
const {enforceThresholds}=require('../dist/threshold');
const hash=value=>createHash('sha256').update(value).digest('hex');
const archive=path.resolve(__dirname,'../docs/experiments/hosted-soroban-forge');
for(const scenario of ['control','regression','threshold']) test(`hosted external ${scenario}: real exit, logical pairing, deployed WASM and raw/native resource provenance`,()=>{
 const root=path.join(archive,scenario);
 const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
 for(const [file,expected] of Object.entries(JSON.parse(fs.readFileSync(path.join(archive,'sha256.json'),'utf8')))) assert.equal(hash(fs.readFileSync(path.join(archive,file))),expected,file);
const proof=read('verification.json'),diff=read('diff.json'),native=read('native.json'),rpc=read('rpc.json');
assert.equal(proof.status,'VERIFIED');assert.equal(proof.weighin_sha,'bbbe9001bbd375fd6a1ff75be5da2593c86fff20');
assert.equal(diff.contracts.length,1);assert.deepEqual(diff.newContracts,[]);assert.deepEqual(diff.removedContracts,[]);
const c=diff.contracts[0];assert.equal(c.functions.length,1);assert.deepEqual(c.newBenchmarks,[]);assert.deepEqual(c.removedBenchmarks,[]);
const fn=c.functions[0];assert.deepEqual([c.fixture_id,c.logical_id,fn.function_name,fn.case_id],['id:soroban-forge-escrow-proof','id:escrow','escrows_for_participant','id:empty-participant-page']);
assert.equal(c.base_commit,proof.base_sha);assert.equal(c.head_commit,proof.head_sha);
for(const side of ['base','head']){
 const provenance=fn[`${side}_provenance`];assert.equal(provenance.protocol,28);
 const row=native.find(r=>r.output&&hash(JSON.stringify(r.input))===provenance.input_sha256);assert.ok(row);
 const out=row.output;
 const call=rpc.find(r=>r.request.method==='simulateTransaction'&&r.raw.result?.latestLedger===provenance.ledger&&r.raw.result?.transactionData===out.transaction_data_xdr&&r.raw.result?.results?.[0]?.xdr===out.retval_xdr);assert.ok(call);
 const resource=xdr.SorobanTransactionData.fromXDR(call.raw.result.transactionData,'base64').resources();
 const events=(call.raw.result.events||[]).map(e=>xdr.DiagnosticEvent.fromXDR(e,'base64')).filter(e=>e.inSuccessfulContractCall()&&e.event().type().name!=='diagnostic').map(e=>e.event().toXDR('base64'));
 assert.deepEqual(events,out.contract_events_xdr);assert.deepEqual(scValToNative(xdr.ScVal.fromXDR(out.retval_xdr,'base64')),{ids:[],next_cursor:null,total:0});
 const expected={cpu_instructions:out.cpu_instructions_consumed,memory_bytes:out.memory_bytes_consumed,ledger_read_entries:resource.footprint().readOnly().length+resource.footprint().readWrite().length,ledger_read_bytes:resource.diskReadBytes(),ledger_write_entries:resource.footprint().readWrite().length,ledger_write_bytes:resource.writeBytes(),events_count:events.length,event_data_bytes:[...events,out.retval_xdr].reduce((n,e)=>n+Buffer.from(e,'base64').length,0)};
 for(const [key,value] of Object.entries(expected))assert.equal(fn.metrics.find(m=>m.key===key)[side].consumed,value);
 for(const key of ['historical_data_read_bytes','contract_data_hard_limit','tx_size_bytes']){const m=fn.metrics.find(m=>m.key===key);assert.equal(m[side].consumed,null);assert.equal(m.delta,null);}
 const wasm=fs.readFileSync(path.join(root,`${side}.wasm`));assert.equal(hash(wasm),proof.wasm[side].sha256);assert.equal(wasm.length,proof.wasm[side].size);
 const metadata=WebAssembly.Module.customSections(new WebAssembly.Module(wasm),'contractmetav0').map(x=>Buffer.from(x).toString('utf8').replace(/[^\x20-\x7e]/g,' ')).join('\n');assert.ok(metadata.includes('1.95.0'));assert.ok(metadata.includes('28.0.0'));
}
const negative=proof.scenario==='threshold';assert.equal(read('process-exit.json').code,negative?1:0);assert.equal(proof.action_exit,negative?1:0);assert.equal(proof.action_outcome,negative?'failure':'success');assert.equal(proof.action_result,negative?'fail':'pass');
assert.deepEqual(enforceThresholds(diff,proof.threshold_config),proof.violations);
if(proof.scenario==='control'){assert.equal(proof.wasm.base.sha256,proof.wasm.head.sha256);for(const m of fn.metrics.filter(m=>m.availability==='comparable'))assert.equal(m.delta,0);}else{assert.notEqual(proof.wasm.base.sha256,proof.wasm.head.sha256);assert.notEqual(c.base_contract_id,c.head_contract_id);assert.ok(fn.metrics.find(m=>m.key==='cpu_instructions').delta>0);}

 assert.equal(proof.scenario,scenario);
 assert.equal(read('run.json').head_sha,proof.head_sha);
 assert.equal(read('run.json').conclusion,'success');
 const benchmark=read('jobs.json').jobs[0].steps.find(step=>step.name==='Run the real pinned WeighIn Action');
 const verifier=read('jobs.json').jobs[0].steps.find(step=>step.name==='Require real comparison, return parity and the expected policy outcome');
 assert.equal(verifier.conclusion,'success');
 assert.equal(benchmark.conclusion,'success'); // Threshold is continued; original failure/exit are independently retained above.
 const report=fs.readFileSync(path.join(root,'report.md'),'utf8');
 assert.ok(report.includes('escrows_for_participant'));if(negative)assert.ok(report.includes(proof.violations[0].message));
});

test('hosted external source lineage and permission boundaries remain precise',()=>{
 const graph=JSON.parse(fs.readFileSync(path.join(archive,'graph.json'),'utf8'));
 assert.equal(graph.upstream,'07d7935234e9c86816116471121998b871b68439');
 assert.deepEqual(graph.baseline_changed_files.sort(),['docs/WEIGHIN_PROOF.md','scripts/capture-weighin-process.cjs','scripts/verify-weighin-proof.cjs','weighin-fixtures.json','weighin-report-only.toml','weighin.toml'].sort());
 assert.deepEqual(graph.regression_changed_files,['crates/escrow/src/lib.rs']);
 const source=path.join(archive,'source');
 const base=fs.readFileSync(path.join(source,'escrow-base.rs'),'utf8'),head=fs.readFileSync(path.join(source,'escrow-head.rs'),'utf8');
 const marker='    ) -> ParticipantEscrowsPage {\n';
 const addition='        // PROOF ONLY: redundant participant-index existence check.\n        let _ = env\n            .storage()\n            .persistent()\n            .has(&DataKey::ParticipantIndex(participant.clone()));\n';
 assert.equal(base.split(marker).length,2);assert.equal(head,base.replace(marker,marker+addition));
 const fork=JSON.parse(fs.readFileSync(path.join(archive,'fork.json'),'utf8'));assert.equal(fork.fork,true);assert.equal(fork.parent.full_name,'Meet-hybrid/soroban-forge');
 const safety=JSON.parse(fs.readFileSync(path.join(archive,'workflow-safety.json'),'utf8'));for(const name of ['Release','ForgeBot','Security Audit'])assert.match(safety.workflows.find(w=>w.name===name).state,/^disabled/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(archive,'secrets-inventory.json'),'utf8')).total_count,0);
 assert.equal(JSON.parse(fs.readFileSync(path.join(archive,'token-permissions.json'),'utf8')).default_workflow_permissions,'read');
});
