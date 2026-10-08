// Called only by action-local-hook.cjs. Genuine prebuilt contract artifacts are
// copied into the base directory; this does not prove contract build/checkout.
const fs = require('node:fs');
const path = require('node:path');
const [command, ...args] = process.argv.slice(2);
const base = process.env.WEIGHIN_EXPERIMENT_BASE_DIR;
if (!base) throw new Error('Missing experiment base directory');
console.error(`[EXPERIMENT infrastructure stub] ${command} ${args.join(' ')}`);
const failure = process.env.WEIGHIN_EXPERIMENT_FAILURE;
if ((failure === 'checkout' && command === 'git' && args[0] === 'fetch')
  || (failure === 'worktree' && command === 'git' && args[1] === 'add')
  || (failure === 'build' && command === 'stellar' && args[0] === 'contract' && !process.cwd().startsWith(process.env.GITHUB_WORKSPACE + path.sep))) {
  console.error(`Deliberate experiment infrastructure failure: ${failure}`);
  process.exit(1);
}
if (command === 'rustc') console.log('rustc 1.95.0');
else if (command === 'stellar' && args[0] === '--version') console.log('stellar 28.1.0');
else if (command === 'stellar' && args[0] === 'contract') {
  const workspace = path.dirname(process.cwd());
  fs.copyFileSync(path.join(workspace, 'contract/contract.wasm'), path.join(args[args.indexOf('--out-dir') + 1], 'contract.wasm'));
}
else if (command === 'cargo' && args[0] === 'metadata') console.log(JSON.stringify({ workspace_members: ['experiment'], packages: [{ id: 'experiment', name: 'contract', manifest_path: path.join(process.cwd(), 'Cargo.toml'), targets: [{ crate_types: ['cdylib'] }] }] }));
else if (command === 'cargo' && args.includes('--target')) {}
else if (command === 'git' && args[0] === 'rev-parse') console.log(process.cwd() === process.env.GITHUB_WORKSPACE ? 'temporary-head' : 'temporary-base');
else if (command === 'git' && args[0] === 'fetch') {}
else if (command === 'git' && args[0] === 'worktree' && args[1] === 'add') {
  fs.cpSync(base, args[3], { recursive: true });
  if (failure === 'missing-fixtures') fs.unlinkSync(path.join(args[3], 'fixtures.json'));
  if (failure === 'measurement') {
    const fixture = path.join(args[3], 'fixtures.json');
    const spec = JSON.parse(fs.readFileSync(fixture));
    spec.contracts[0].invocations[0].function_name = 'missing_function';
    fs.writeFileSync(fixture, JSON.stringify(spec));
  }
}
else if (command === 'git' && args[0] === 'worktree' && args[1] === 'remove') {
  const directory = args.at(-1);
  if (!path.resolve(directory).startsWith(path.resolve(process.env.TMPDIR) + path.sep)) throw new Error('Refusing cleanup outside experiment');
  fs.rmSync(directory, { recursive: true, force: true });
} else throw new Error(`Unexpected infrastructure command: ${command} ${args.join(' ')}`);
