exec(open('/home/mxr/Documents/localRepo/Weighin/.stage6b-work/run-optimizer.py').read().split('records=[]')[0])
records=[]
for mode in ['default','1']:
 for run in range(1,6):
  out=work/f'build-{mode}-{run}';out.mkdir(exist_ok=True)
  env=dict(os.environ,PATH=str(root/'.stage6-cli')+':'+os.environ['PATH'],RUSTUP_TOOLCHAIN='1.95.0',CARGO_TARGET_DIR=str(root/'.stage6-cargo'),CARGO_BUILD_JOBS='2',CARGO_INCREMENTAL='0',TMPDIR=str(work))
  env.pop('BINARYEN_CORES',None)
  if mode!='default': env['BINARYEN_CORES']=mode
  cmd=[str(root/'.stage6-cli/stellar'),'contract','build','--manifest-path',str(work/'project/crates/escrow/Cargo.toml'),'--package','soroban-forge-escrow','--locked','--optimize=true','--out-dir',str(out)]
  start=time.monotonic();p=subprocess.run(cmd,env=env,cwd=work/'project/crates/escrow',capture_output=True,text=True)
  (work/f'build-{mode}-{run}.log').write_text(p.stdout+p.stderr)
  rec={'mode':mode,'run':run,'command':cmd,'exit':p.returncode,'elapsed_seconds':round(time.monotonic()-start,3)}
  wasm=out/'soroban_forge_escrow.wasm'
  if p.returncode==0: rec.update(sha256=hashlib.sha256(wasm.read_bytes()).hexdigest(),bytes=wasm.stat().st_size)
  records.append(rec);(work/'build-results.json').write_text(json.dumps(records,indent=2)+'\n'); print(json.dumps(rec),flush=True)
  if p.returncode: print(p.stderr);raise SystemExit(p.returncode)
