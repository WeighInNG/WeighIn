const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {spawnSync}=require('node:child_process');
function startup(mode){const result=spawnSync(process.execPath,['--require',path.join(__dirname,'support/network-startup-hook.cjs'),
  path.resolve(__dirname,'../scripts/wait-for-local-network.cjs')],{encoding:'utf8',timeout:10000,
  env:{...process.env,WEIGHIN_STARTUP_UNIT_MODE:mode}});assert.ifError(result.error);return result;}
for(const mode of ['unhealthy','metadata-only'])test(`startup fails closed for ${mode} RPC`,()=>{
  const r=startup(mode);assert.equal(r.status,1);assert.match(r.stderr,/RPC readiness failed within 120s/);
  assert.doesNotMatch(r.stdout,/network is ready|Funding deployer/);
});
test('healthy RPC with persistent Friendbot failure does not report network readiness',()=>{
  const r=startup('funding-failure');assert.equal(r.status,1);assert.match(r.stderr,/Account readiness failed within 120s/);
  assert.doesNotMatch(r.stdout,/network is ready/);
});
test('startup reports readiness only after healthy RPC and account inclusion',()=>{
  const r=startup('ready');assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/confirmed in RPC/);assert.match(r.stdout,/network is ready/);
});
