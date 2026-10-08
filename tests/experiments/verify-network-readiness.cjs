// Explicit live experiment: three fresh pinned networks, production startup and bundled Action.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../..'),destination=path.resolve(process.argv[2]||'/tmp/weighin-network-readiness');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'weighin-network-readiness-'));
const workspace=path.join(temporary,'project'),helper=path.join(root,'native/simulation/target/x86_64-unknown-linux-gnu/release/weighin-simulation');
const hash=b=>createHash('sha256').update(b).digest('hex');
fs.mkdirSync(destination,{recursive:true});
const write=(name,v)=>fs.writeFileSync(path.join(destination,name),JSON.stringify(v,null,2)+'\n');
async function child(command,args,cwd=root,env=process.env) {
  return new Promise((resolve,reject)=>{const p=cp.spawn(command,args,{cwd,env});let stdout='',stderr='';
    const heartbeat=setInterval(()=>console.log(`Live readiness: ${command} ${args[0]} in progress`),30000);
    p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);
    p.on('error',e=>{clearInterval(heartbeat);reject(e);});p.on('close',status=>{clearInterval(heartbeat);resolve({status,stdout,stderr});});});
}
function outputField(raw,name){const lines=raw.split('\n'),start=lines.findIndex(l=>l.startsWith(name+'<<'));
  assert.ok(start>=0);const delimiter=lines[start].split('<<')[1];return lines.slice(start+1,lines.indexOf(delimiter,start+1)).join('\n');}
async function main(){
  const existing=await child('docker',['ps','-a','-q','-f','name=^/stellar-quickstart$']);
  assert.equal(existing.status,0,existing.stderr);assert.equal(existing.stdout.trim(),'','Refusing to replace an existing sidecar in this experiment');
  const clone=await child('git',['clone','--no-hardlinks',root,workspace],temporary);assert.equal(clone.status,0,clone.stderr);
  const branch=await child('git',['branch','--show-current'],workspace);assert.equal(branch.status,0);
  fs.writeFileSync(path.join(workspace,'weighin.toml'),'[thresholds.functions.hello]\ncpu_instructions="strict_zero_tolerance"\n');
  const runs=[];
  for(let i=1;i<=3;i++){
    const name='run-'+i,dir=path.join(destination,name);fs.mkdirSync(dir);
    const startup=path.join(dir,'startup'),action=path.join(dir,'action');fs.mkdirSync(startup);fs.mkdirSync(action);
    try {
      const env={...process.env,WEIGHIN_MIGRATION_EVIDENCE:startup,WEIGHIN_HELPER_PATH:helper,
        NODE_OPTIONS:'--require='+path.join(root,'tests/support/record-network-io.cjs')};
      const start=await child('bash',['scripts/start-local-network.sh'],root,env);write(name+'/startup/process.json',start);
      const inspect=await child('docker',['inspect','stellar-quickstart']);assert.equal(inspect.status,0,inspect.stderr);
      write(name+'/container.json',JSON.parse(inspect.stdout));assert.equal(start.status,0,start.stdout+start.stderr);
      const runner=path.join(temporary,name);fs.mkdirSync(runner);
      const outputs=path.join(action,'outputs.txt'),summary=path.join(action,'summary.md');fs.writeFileSync(outputs,'');fs.writeFileSync(summary,'');
      const result=await child(process.execPath,['--require',path.join(root,'tests/support/record-network-io.cjs'),path.join(root,'bundled/index.js')],workspace,
        {...process.env,WEIGHIN_MIGRATION_EVIDENCE:action,WEIGHIN_HELPER_PATH:helper,TMPDIR:runner,
          PATH:'/tmp/weighin-stage3-stellar:'+process.env.PATH,CARGO_BUILD_JOBS:'2',CARGO_INCREMENTAL:'0',
          CARGO_TARGET_DIR:process.env.WEIGHIN_EXPERIMENT_CARGO_TARGET_DIR||path.join(temporary,'cargo-cache'),
          GITHUB_WORKSPACE:workspace,GITHUB_OUTPUT:outputs,GITHUB_STEP_SUMMARY:summary,
          'INPUT_BASE-REF':branch.stdout.trim(),'INPUT_RPC-URL':'http://localhost:8000/rpc',
          'INPUT_FIXTURES-PATH':'weighin-fixtures.json','INPUT_CONFIG-PATH':'weighin.toml','INPUT_GITHUB-TOKEN':'','INPUT_RUST-TOOLCHAIN':'1.95.0'});
      write(name+'/action/process.json',result);assert.equal(result.status,0,result.stdout+result.stderr);
      assert.equal(outputField(fs.readFileSync(outputs,'utf8'),'result'),'pass');
      const diff=JSON.parse(outputField(fs.readFileSync(outputs,'utf8'),'diff-json'));write(name+'/action/diff.json',diff);
      assert.equal(diff.contracts.length,2);for(const c of diff.contracts)for(const f of c.functions){
        assert.equal(f.metrics.find(m=>m.key==='cpu_instructions').delta,0);}
      const http=JSON.parse(fs.readFileSync(path.join(startup,'http.json')));
      assert.ok(http.some(c=>c.request.method==='GET'&&c.request.url.includes('/friendbot?')&&c.status===200));
      assert.ok(start.stdout.includes('confirmed in RPC'));assert.ok(result.stdout.includes('confirmed in RPC'));
      const container=JSON.parse(inspect.stdout)[0];
      runs.push({run:i,container_id:container.Id,image:container.Image,startup_exit:start.status,action_exit:result.status,
        matched_benchmarks:2,cpu_deltas:[0,0],startup_funding_statuses:http.filter(c=>c.request.url.includes('/friendbot?')).map(c=>c.status||c.error)});
      write('runs.json',runs);console.log(`${name}: fresh startup and real Action passed; two matched benchmarks, CPU deltas 0`);
    } finally {
      const logs=await child('docker',['logs','--tail','100','stellar-quickstart']);fs.writeFileSync(path.join(dir,'network-tail.log'),logs.stdout+logs.stderr);
      const stop=await child('docker',['stop','stellar-quickstart']);write(name+'/stop.json',stop);
    }
  }
  assert.equal(new Set(runs.map(r=>r.container_id)).size,3);
  write('verification.json',{status:'FRESH_NETWORK_READINESS_PASS',fresh_containers:3,production_startup_and_action:true,
    io_observers_only:true,shared_cargo_cache:true,clean_build_claim:false,public_ci_proven:false,
    bundle_sha256:hash(fs.readFileSync(path.join(root,'bundled/index.js'))),helper_sha256:hash(fs.readFileSync(helper)),
    unchanged_contract_source:true,strict_cpu_control_policy:true,runs});
}
main().catch(error=>{write('failure.json',{message:error.message,stack:error.stack});console.error(error.message);process.exitCode=1;});
