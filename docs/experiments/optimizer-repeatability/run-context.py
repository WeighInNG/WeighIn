exec(open('/home/mxr/Documents/localRepo/Weighin/.stage6b-work/run-optimizer.py').read().split('records=[]')[0])
records=[]
for mode in ['no-out-dir','relative-out-dir','relative-optimizer']:
 for run in range(1,6):
  cwd=work/'project/crates/escrow'
  env=dict(os.environ,RUSTUP_TOOLCHAIN='1.95.0',CARGO_TARGET_DIR=str(root/'.stage6-cargo'),CARGO_BUILD_JOBS='2',CARGO_INCREMENTAL='0',TMPDIR=str(work))
  env.pop('BINARYEN_CORES',None)
  cmd=[str(root/'.stage6-cli/stellar'),'contract','build','--manifest-path','Cargo.toml','--package','soroban-forge-escrow','--locked','--optimize=true']
  if mode=='no-out-dir': artifact=root/'.stage6-cargo/wasm32v1-none/release/soroban_forge_escrow.wasm'
  elif mode=='relative-out-dir':
   cmd+=['--out-dir','../../../relative-output'];artifact=work/'relative-output/soroban_forge_escrow.wasm'
  else:
   cwd=work;cmd=[str(root/'.stage6-cli/stellar'),'contract','optimize','--wasm','../.stage6-delivery/docs/experiments/external-soroban-forge/provenance-checks/original-unoptimized.wasm','--wasm-out','relative.optimized.wasm'];artifact=work/'relative.optimized.wasm'
  p=subprocess.run(cmd,env=env,cwd=cwd,capture_output=True,text=True)
  (work/f'context-{mode}-{run}.log').write_text(p.stdout+p.stderr)
  rec={'mode':mode,'run':run,'command':cmd,'cwd':str(cwd),'exit':p.returncode}
  if p.returncode==0:
   data=artifact.read_bytes();(work/f'context-{mode}-{run}.wasm').write_bytes(data);rec.update(sha256=hashlib.sha256(data).hexdigest(),bytes=len(data))
  records.append(rec);(work/'context-results.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps(rec),flush=True)
  if p.returncode: print(p.stderr);raise SystemExit(p.returncode)
