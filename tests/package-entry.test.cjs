const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
test('CLI --help and -h exit 0 offline outside Git without reading fixtures or creating result files',()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'weighin-cli-help-'));
  try{
    const pkg=require('../package.json'),cli=path.resolve(__dirname,'..',pkg.bin.weighin);
    fs.writeFileSync(path.join(temporary,'weighin-fixtures.json'),'{not valid json');
    const env={...process.env,PATH:'',WEIGHIN_HELPER_PATH:path.join(temporary,'missing-helper')};
    for(const flag of ['--help','-h']){
      const r=spawnSync(process.execPath,[cli,flag],{cwd:temporary,encoding:'utf8',env,timeout:10000});
      assert.ifError(r.error);
      assert.equal(r.status,0);
      assert.equal(r.stderr,'');
      assert.match(r.stdout,/Usage: weighin \[<fixtures\.json> \[<output\.json>\]\] \[--rpc-url <url>\] \[--output <path>\]/);
      assert.match(r.stdout,/--rpc-url <url>/);
      assert.match(r.stdout,/--output <path>/);
      assert.match(r.stdout,/weighin-fixtures\.json/);
      assert.match(r.stdout,/weighin-results\.json/);
      assert.match(r.stdout,/http:\/\/localhost:8000\/rpc/);
      assert.match(r.stdout,/Measurement-only command for prebuilt WASMs/);
      assert.doesNotMatch(r.stdout,/Starting Weighin Benchmarking/);
      assert.doesNotMatch(r.stdout,/\bBASE\b|\bHEAD\b|--base|--head|--config/);
      assert.equal(fs.existsSync(path.join(temporary,'weighin-results.json')),false);
      assert.deepEqual(fs.readdirSync(temporary),['weighin-fixtures.json']);
    }
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
test('CLI --version exits 0 offline and reads version from installed package metadata',()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'weighin-cli-version-'));
  try{
    const pkg=require('../package.json'),cli=path.resolve(__dirname,'..',pkg.bin.weighin);
    fs.writeFileSync(path.join(temporary,'weighin-fixtures.json'),'{not valid json');
    const env={...process.env,PATH:'',WEIGHIN_HELPER_PATH:path.join(temporary,'missing-helper')};
    const r=spawnSync(process.execPath,[cli,'--version'],{cwd:temporary,encoding:'utf8',env,timeout:10000});
    assert.ifError(r.error);
    assert.equal(r.status,0);
    assert.equal(r.stderr,'');
    assert.equal(r.stdout.trim(),pkg.version);
    assert.equal(fs.existsSync(path.join(temporary,'weighin-results.json')),false);

    const installedRoot=path.join(temporary,'installed-pkg');
    fs.mkdirSync(path.join(installedRoot,'dist'),{recursive: true});
    fs.writeFileSync(path.join(installedRoot,'package.json'),JSON.stringify({name:'weighin',version:'2.4.6-metadata-check'}));
    for(const file of fs.readdirSync(path.resolve(__dirname,'../dist'))){
      if(file.endsWith('.js'))fs.copyFileSync(path.resolve(__dirname,'../dist',file),path.join(installedRoot,'dist',file));
    }
    const relocated=spawnSync(process.execPath,[path.join(installedRoot,'dist/cli.js'),'--version'],{
      cwd:temporary,
      encoding:'utf8',
      env:{...env,NODE_PATH:path.resolve(__dirname,'../node_modules')},
      timeout:10000,
    });
    assert.ifError(relocated.error);
    assert.equal(relocated.status,0);
    assert.equal(relocated.stderr,'');
    assert.equal(relocated.stdout.trim(),'2.4.6-metadata-check');
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
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

test('CLI rejects ambiguous combination of stdout mode and explicit output file',()=>{
  const pkg=require('../package.json');
  const bin=path.resolve(__dirname,'..',pkg.bin.weighin);

  // Case 1: --json-stdout and --output file.json
  const r1=spawnSync(process.execPath,[bin,'fixtures.json','--json-stdout','--output','out.json'],
    {encoding:'utf8',timeout:5000});
  assert.equal(r1.status,1);
  assert.match(r1.stderr,/Ambiguous output configuration/);
  assert.equal(r1.stdout,'');

  // Case 2: --stdout and positional output
  const r2=spawnSync(process.execPath,[bin,'fixtures.json','positional.json','--stdout'],
    {encoding:'utf8',timeout:5000});
  assert.equal(r2.status,1);
  assert.match(r2.stderr,/Ambiguous output configuration/);
  assert.equal(r2.stdout,'');
});

test('CLI stdout failure emits error on stderr and nothing on stdout',()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'weighin-stdout-fail-'));
  try{
    const pkg=require('../package.json');
    const bin=path.resolve(__dirname,'..',pkg.bin.weighin);
    const r=spawnSync(process.execPath,[bin,path.join(temporary,'nonexistent.json'),'--json-stdout'],
      {cwd:temporary,encoding:'utf8',timeout:10000});
    assert.equal(r.status,1);
    assert.match(r.stderr,/Benchmarking failed/);
    assert.equal(r.stdout,'');
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
