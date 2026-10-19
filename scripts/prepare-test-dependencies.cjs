// Provision the caches required by the offline inventory and consumer tests.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
execFileSync('cargo', ['+1.95.0', 'fetch', '--locked', '--manifest-path',
  'native/simulation/Cargo.toml'], { cwd: root, stdio: 'inherit' });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'weighin-test-cache-'));
try {
  const { dependencies } = require(path.join(root, 'package.json'));
  fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({
    private: true, dependencies,
  }));
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: temporary, stdio: 'inherit',
  });
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
