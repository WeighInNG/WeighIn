// Local Action exit proof ONLY. Redirect checkout and contract-build processes
// to the infrastructure shim; native helper, RPC, diff and policies stay real.
const childProcess = require('node:child_process');
const path = require('node:path');
const original = childProcess.spawn;
childProcess.spawn = function (command, args, options) {
  const tool = path.basename(command);
  if (['git', 'rustc', 'stellar'].includes(tool) || (tool === 'cargo' && (args.includes('--target') || args[0] === 'metadata'))) {
    return original(process.execPath, [path.join(__dirname, 'action-local-tools.cjs'), tool, ...args], options);
  }
  return original(command, args, options);
};

// Save exact raw responses without changing them. Invocations are unsigned and
// captures contain no deployer secrets.
if (process.env.WEIGHIN_EXPERIMENT_CAPTURE_FILE) {
  const fs = require('node:fs');
  const fetch = globalThis.fetch;
  const captures = [];
  globalThis.fetch = async (...args) => {
    const response = await fetch(...args);
    if (args[1]?.method === 'POST') {
      captures.push({ request: JSON.parse(args[1].body), raw: await response.clone().json() });
      fs.writeFileSync(process.env.WEIGHIN_EXPERIMENT_CAPTURE_FILE, JSON.stringify(captures, null, 2) + '\n');
    }
    return response;
  };
}
