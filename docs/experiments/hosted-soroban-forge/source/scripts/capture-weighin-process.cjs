// Pure forwarding observation of the real pinned Action. No response/exit substitution.
const fs = require('node:fs');
const path = require('node:path');
require(path.resolve('.weighin-engine/tests/support/record-migration-io.cjs'));
process.once('exit', code => {
  fs.writeFileSync(path.join(process.env.WEIGHIN_MIGRATION_EVIDENCE, 'process-exit.json'),
    JSON.stringify({ code, node: process.version, observed_process: 'pinned WeighIn Action' }, null, 2) + '\n');
});
