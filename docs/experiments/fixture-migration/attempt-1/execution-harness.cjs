// Real historical BASE -> bridge -> stable-ID migration, plus strict regression.
// Temporary Git fixture history only; repository/public history is never changed.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../..'),destination=path.resolve(process.argv[2]||'/tmp/weighin-fixture-migration');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'weighin-fixture-migration-'));
const workspace=path.join(temporary,'project'),origin=path.join(temporary,'origin.git'),cargoTarget=path.join(temporary,'cargo-cache');
const rpcUrl=process.env.WEIGHIN_EXPERIMENT_RPC_URL||'http://localhost:18000/rpc';
const helper=path.join(root,'native/simulation/target/x86_64-unknown-linux-gnu/release/weighin-simulation');
const hash=data=>createHash('sha256').update(data).digest('hex');
fs.mkdirSync(destination,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(destination,name),JSON.stringify(value,null,2)+'\n');
const inputFiles=['contract/Cargo.toml','contract/Cargo.lock','contract/src/lib.rs','rust-toolchain.toml','weighin-fixtures.json','weighin.toml'];
async function child(command,args,cwd=workspace,env=process.env){
  return new Promise((resolve,reject)=>{
    const proc=spawn(command,args,{cwd,env});let stdout='',stderr='';
    proc.stdout.on('data',data=>stdout+=data);proc.stderr.on('data',data=>stderr+=data);
    proc.on('error',reject);proc.on('close',status=>resolve({status,stdout,stderr}));
  });
}
async function git(...args){const r=await child('git',args);assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function outputField(raw,name){
  const lines=raw.split('\n'),start=lines.findIndex(line=>line.startsWith(`${name}<<`));assert.ok(start>=0);
  const delimiter=lines[start].split('<<')[1];return lines.slice(start+1,lines.indexOf(delimiter,start+1)).join('\n');
}
async function commit(message){await git('add',...inputFiles);await git('commit','-m',message);return git('rev-parse','HEAD');}
async function action(label,baseRef,expected){
  const dir=path.join(destination,label);fs.mkdirSync(dir);
  const runnerTemp=path.join(temporary,label);fs.mkdirSync(runnerTemp);
  const outputs=path.join(dir,'outputs.txt'),summary=path.join(dir,'summary.md');fs.writeFileSync(outputs,'');fs.writeFileSync(summary,'');
  const result=await child(process.execPath,['--require',path.join(root,'tests/support/record-migration-io.cjs'),
    path.join(root,'bundled/index.js')],workspace,{...process.env,TMPDIR:runnerTemp,CARGO_TARGET_DIR:cargoTarget,
    CARGO_BUILD_JOBS:'2',CARGO_INCREMENTAL:'0',WEIGHIN_HELPER_PATH:helper,WEIGHIN_MIGRATION_EVIDENCE:dir,
    GITHUB_WORKSPACE:workspace,GITHUB_OUTPUT:outputs,GITHUB_STEP_SUMMARY:summary,
    'INPUT_FIXTURES-PATH':'weighin-fixtures.json','INPUT_CONFIG-PATH':'weighin.toml','INPUT_BASE-REF':baseRef,
    'INPUT_RPC-URL':rpcUrl,'INPUT_GITHUB-TOKEN':'','INPUT_RUST-TOOLCHAIN':'1.95.0'});
  write(`${label}/process.json`,result);assert.equal(result.status,expected,result.stdout+result.stderr);
  assert.equal(outputField(fs.readFileSync(outputs,'utf8'),'result'),expected?'fail':'pass');
  const diff=JSON.parse(outputField(fs.readFileSync(outputs,'utf8'),'diff-json'));write(`${label}/diff.json`,diff);
  fs.copyFileSync(path.join(workspace,'weighin-fixtures.json'),path.join(dir,'head-fixtures.json'));
  const native=JSON.parse(fs.readFileSync(path.join(dir,'native.json'))),calls=JSON.parse(fs.readFileSync(path.join(dir,'rpc.json')));
  for(const contract of diff.contracts||[])for(const fn of contract.functions)for(const side of ['base','head']){
    const provenance=fn[`${side}_provenance`];
    const replay=native.find(row=>row.output&&hash(JSON.stringify(row.input))===provenance.input_sha256);assert.ok(replay);
    assert.ok(calls.some(c=>c.request.method==='simulateTransaction'&&c.raw.result?.latestLedger===provenance.ledger
      &&c.raw.result?.transactionData===replay.output.transaction_data_xdr&&c.raw.result?.results?.[0]?.xdr===replay.output.retval_xdr));
    assert.equal(fn.metrics.find(m=>m.key==='cpu_instructions')[side].consumed,replay.output.cpu_instructions_consumed);
  }
  const hashes=[...result.stdout.matchAll(/Built contract_test: .*?; SHA256 ([a-f0-9]{64})/g)].map(m=>m[1]);
  console.log(`${label}: expected exit ${expected}, actual ${result.status}; matched contracts ${(diff.contracts||[]).length}`);
  return {diff,build_hashes:hashes,exit:result.status};
}
async function main(){
  // Check network before any clone/build work.
  for(let i=0;i<60;i++){
    try{const r=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getHealth'})});
      if((await r.json()).result?.status==='healthy')break;}catch{}
    if(i===59)throw new Error('RPC not healthy');await new Promise(resolve=>setTimeout(resolve,1000));
  }
  const clone=await child('git',['clone','--no-hardlinks',root,workspace],temporary);assert.equal(clone.status,0,clone.stderr);
  const historicalSha=await git('rev-parse','HEAD');await git('branch','migration-historical',historicalSha);
  await git('config','user.name','WeighIn isolated migration experiment');await git('config','user.email','experiment@example.invalid');
  for(const file of inputFiles){
    const target=path.join(destination,'historical',file);fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(path.join(workspace,file),target);
  }
  const bare=await child('git',['clone','--bare',workspace,origin],temporary);assert.equal(bare.status,0,bare.stderr);
  await git('remote','set-url','origin',origin);await git('checkout','-b','migration-candidate');
  for(const file of inputFiles)fs.copyFileSync(path.join(root,file),path.join(workspace,file));
  const bridge=JSON.parse(fs.readFileSync(path.join(root,'weighin-fixtures.json')));
  const stable={contracts:bridge.contracts.filter(c=>c.id)};
  fs.writeFileSync(path.join(workspace,'weighin-fixtures.json'),JSON.stringify(stable,null,2)+'\n');
  const unbridgedSha=await commit('Isolated direct path-to-ID transition (expected failure)');
  const unbridged=await action('unbridged','migration-historical',1);
  assert.deepEqual(unbridged.diff,{});
  assert.match(fs.readFileSync(path.join(destination,'unbridged/summary.md'),'utf8'),/No matched BASE\/HEAD benchmarks/);
  fs.writeFileSync(path.join(workspace,'weighin-fixtures.json'),JSON.stringify(bridge,null,2)+'\n');
  const bridgeSha=await commit('Isolated bridge fixture with stable contract ID');await git('branch','migration-bridge',bridgeSha);
  const originRef=await child('git',['--git-dir',origin,'update-ref','refs/heads/migration-bridge',bridgeSha],temporary);assert.equal(originRef.status,0,originRef.stderr);
  const migration=await action('bridge','migration-historical',0);
  assert.equal(migration.diff.contracts.length,1);
  const legacy='wasm:'+JSON.parse(fs.readFileSync(path.join(destination,'historical/weighin-fixtures.json'))).contracts[0].wasm_path;
  assert.equal(migration.diff.contracts[0].logical_id,legacy);assert.equal(migration.diff.newContracts.length,1);
  assert.deepEqual(migration.diff.removedContracts,[]);
  assert.equal(migration.build_hashes.length,3);assert.equal(migration.build_hashes[0],migration.build_hashes[1]);
  fs.copyFileSync(path.join(workspace,bridge.contracts[0].wasm_path),path.join(destination,'modern-control.wasm'));
  assert.equal(hash(fs.readFileSync(path.join(workspace,bridge.contracts[1].wasm_path))),migration.build_hashes[0]);
  fs.writeFileSync(path.join(workspace,'weighin-fixtures.json'),JSON.stringify(stable,null,2)+'\n');
  fs.writeFileSync(path.join(workspace,'weighin.toml'),'[thresholds.functions.hello]\ncpu_instructions="strict_zero_tolerance"\n');
  const cleanupSha=await commit('Isolated bridge retirement and strict control');
  const cleanup=await action('retirement','migration-bridge',0);
  assert.equal(cleanup.diff.contracts.length,1);assert.equal(cleanup.diff.contracts[0].logical_id,'id:reference-contract');
  assert.equal(cleanup.diff.removedContracts.length,1);assert.deepEqual(cleanup.diff.newContracts,[]);
  assert.equal(cleanup.diff.contracts[0].functions[0].metrics.find(m=>m.key==='cpu_instructions').delta,0);
  const source=path.join(workspace,'contract/src/lib.rs');
  fs.writeFileSync(source,fs.readFileSync(source,'utf8').replace('vec![&env,','env.storage().persistent().set(&symbol_short!("bench"), &to);\n        vec![&env,'));
  const regressionSha=await commit('Isolated intentional regression after identity migration');
  const regression=await action('regression','migration-bridge',1);
  assert.equal(regression.diff.contracts[0].logical_id,'id:reference-contract');
  assert.notEqual(regression.diff.contracts[0].base_contract_id,regression.diff.contracts[0].head_contract_id);
  const cpu=regression.diff.contracts[0].functions[0].metrics.find(m=>m.key==='cpu_instructions');assert.ok(cpu.delta>0);
  fs.copyFileSync(source,path.join(destination,'regression-contract.rs'));
  fs.copyFileSync(path.join(workspace,stable.contracts[0].wasm_path),path.join(destination,'regression.wasm'));
  const archive=await child('git',['archive','--format=tar','--output='+path.join(destination,'isolated-revisions.tar'),
    regressionSha,...inputFiles]);assert.equal(archive.status,0,archive.stderr);
  write('verification.json',{status:'HISTORICAL_IDENTITY_MIGRATION_PASS',historical_sha:historicalSha,unbridged_sha:unbridgedSha,
    bridge_sha:bridgeSha,retirement_sha:cleanupSha,regression_sha:regressionSha,temporary_git_history_only:true,
    actual_repository_base_used:true,real_git_build_rpc_native_and_action:true,io_observers_only:true,
    unbridged_exit:unbridged.exit,bridge_exit:migration.exit,retirement_exit:cleanup.exit,regression_exit:regression.exit,
    bridge_matched_identity:legacy,stable_identity:'id:reference-contract',bridge_alias_hash_matches_modern_output:true,
    migration_policy:'existing report-only weighin.toml; not a zero-regression claim across SDK upgrades',
    migration_cpu_delta:migration.diff.contracts[0].functions[0].metrics.find(m=>m.key==='cpu_instructions').delta,
    strict_control_cpu_delta:0,regression_cpu_base:cpu.base.consumed,regression_cpu_head:cpu.head.consumed,regression_cpu_delta:cpu.delta,
    source_sdks:{historical:'21.7.7',modern:'28.0.0'},compiler_target:'wasm32v1-none',shared_cargo_cache:true,
    helper_sha256:hash(fs.readFileSync(helper)),bundle_sha256:hash(fs.readFileSync(path.join(root,'bundled/index.js'))),
    public_ci_proven:false,repository_commit_or_push_performed:false});
}
main().catch(error=>{write('failure.json',{message:error.message,stack:error.stack});console.error(error);process.exitCode=1;});
