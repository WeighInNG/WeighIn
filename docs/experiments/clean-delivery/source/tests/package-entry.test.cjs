const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
test('package main loads the existing measurement API',()=>{
  const api=require('..');assert.equal(typeof api.runMeasurement,'function');
  assert.equal(typeof api.metricsFromSimulation,'function');
});
test('declared CLI entry runs and fails clearly without producing results for missing fixtures',()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'weighin-package-entry-'));
  try{
    const pkg=require('../package.json'),output=path.join(temporary,'results.json');
    const r=spawnSync(process.execPath,[path.resolve(__dirname,'..',pkg.bin.weighin),path.join(temporary,'missing.json'),'--output',output],
      {cwd:temporary,encoding:'utf8',timeout:10000});assert.ifError(r.error);assert.equal(r.status,1);
    assert.match(r.stderr,/Benchmarking failed/);assert.match(r.stderr,/ENOENT/);assert.equal(fs.existsSync(output),false);
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
