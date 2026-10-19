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

function validatePackageMetadata(manifest, runtimeVersion = process.version) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('package manifest must be an object');
  }
  if (!manifest.license || typeof manifest.license !== 'string' || manifest.license.trim() === '') {
    throw new Error('package.json must declare a valid license');
  }
  if (manifest.license !== 'Apache-2.0') {
    throw new Error(`Expected Apache-2.0 license, got ${manifest.license}`);
  }
  if (!manifest.repository || typeof manifest.repository !== 'object') {
    throw new Error('package.json must declare repository metadata object');
  }
  if (manifest.repository.type !== 'git') {
    throw new Error(`Expected git repository type, got ${manifest.repository.type}`);
  }
  const trustedRepoUrl = 'https://github.com/WeighInNG/WeighIn.git';
  if (manifest.repository.url !== trustedRepoUrl) {
    throw new Error(`Expected repository URL ${trustedRepoUrl}, got ${manifest.repository.url}`);
  }
  if (!manifest.engines || typeof manifest.engines !== 'object') {
    throw new Error('package.json must declare engines');
  }
  if (!manifest.engines.node || typeof manifest.engines.node !== 'string') {
    throw new Error('package.json must declare engines.node');
  }
  const nodeEngine = manifest.engines.node.trim();
  const validEnginePattern = /^>=\s*24(\.0\.0)?$/;
  if (!validEnginePattern.test(nodeEngine)) {
    throw new Error(`Engine claim '${nodeEngine}' is not bounded by CI verified runtime (Node >=24.0.0)`);
  }
  if (runtimeVersion) {
    const versionMatch = runtimeVersion.match(/^v?(\d+)\.(\d+)\.(\d+)/);
    if (!versionMatch) {
      throw new Error(`Invalid runtime version: ${runtimeVersion}`);
    }
    const major = parseInt(versionMatch[1], 10);
    if (major < 24) {
      throw new Error(`Runtime Node version ${runtimeVersion} does not satisfy engine requirement ${nodeEngine}`);
    }
  }
  return true;
}

test('package metadata declares valid Apache-2.0 license, git repository, and bounded Node 24 engine', () => {
  const pkg = require('../package.json');
  assert.equal(validatePackageMetadata(pkg, process.version), true);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.repository.type, 'git');
  assert.equal(pkg.repository.url, 'https://github.com/WeighInNG/WeighIn.git');
  assert.equal(pkg.engines.node, '>=24.0.0');
});

test('package metadata validation rejects invalid or missing fields', () => {
  const base = {
    name: 'weighin',
    version: '1.0.0',
    license: 'Apache-2.0',
    repository: { type: 'git', url: 'https://github.com/WeighInNG/WeighIn.git' },
    engines: { node: '>=24.0.0' },
  };

  // Missing / empty license
  assert.throws(() => validatePackageMetadata({ ...base, license: undefined }), /must declare a valid license/);
  assert.throws(() => validatePackageMetadata({ ...base, license: '' }), /must declare a valid license/);
  assert.throws(() => validatePackageMetadata({ ...base, license: 'MIT' }), /Expected Apache-2.0/);

  // Missing / invalid repository
  assert.throws(() => validatePackageMetadata({ ...base, repository: undefined }), /repository metadata object/);
  assert.throws(() => validatePackageMetadata({ ...base, repository: { type: 'svn', url: 'https://github.com/WeighInNG/WeighIn.git' } }), /Expected git repository type/);
  assert.throws(() => validatePackageMetadata({ ...base, repository: { type: 'git', url: 'https://github.com/evil/fork.git' } }), /Expected repository URL/);

  // Missing / unverified engines
  assert.throws(() => validatePackageMetadata({ ...base, engines: undefined }), /must declare engines/);
  assert.throws(() => validatePackageMetadata({ ...base, engines: {} }), /must declare engines\.node/);
  assert.throws(() => validatePackageMetadata({ ...base, engines: { node: '>=18.0.0' } }), /not bounded by CI verified runtime/);
  assert.throws(() => validatePackageMetadata({ ...base, engines: { node: '>=20.0.0' } }), /not bounded by CI verified runtime/);

  // Incompatible runtime versions
  assert.throws(() => validatePackageMetadata(base, 'v18.20.0'), /Runtime Node version v18.20.0 does not satisfy engine/);
  assert.throws(() => validatePackageMetadata(base, 'v20.18.0'), /Runtime Node version v20.18.0 does not satisfy engine/);
  assert.throws(() => validatePackageMetadata(base, 'v22.14.0'), /Runtime Node version v22.14.0 does not satisfy engine/);

  // Compatible runtime versions
  assert.equal(validatePackageMetadata(base, 'v24.0.0'), true);
  assert.equal(validatePackageMetadata(base, 'v24.17.0'), true);
  assert.equal(validatePackageMetadata(base, 'v25.0.0'), true);
});
