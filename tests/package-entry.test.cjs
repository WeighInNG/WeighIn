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

test('CLI --list-identities outputs parser-derived logical identity tuples offline (#231)', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'weighin-identities-cli-'));
  try {
    const pkg = require('../package.json');
    const bin = path.resolve(__dirname, '..', pkg.bin.weighin);
    const f1 = path.join(temporary, 'f1.json');
    fs.writeFileSync(f1, JSON.stringify({
      id: 'suite-a',
      contracts: [{ id: 'vault', wasm_path: 'a/b/vault.wasm', invocations: [{ id: 'deposit-1', function_name: 'deposit', args: [] }] }]
    }));
    const res = spawnSync(process.execPath, [bin, 'f1.json', '--list-identities', '--json-stdout'], { cwd: temporary, encoding: 'utf8', timeout: 5000 });
    assert.equal(res.status, 0);
    const tuples = JSON.parse(res.stdout);
    assert.deepEqual(tuples, [{
      fixture_id: 'id:suite-a',
      logical_id: 'id:vault',
      function_name: 'deposit',
      case_id: 'id:deposit-1',
    }]);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
