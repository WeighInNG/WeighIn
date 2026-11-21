// Provision the funded fixture signer in the Action's own temporary key directory.
// RPC and helper observations forward requests and preserve the original responses.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const keyFile = process.env.WEIGHIN_TOKEN_TRANSFER_KEY_FILE;
if (!keyFile) throw new Error("Missing disposable transfer signer file");
const mkdtemp = fs.mkdtempSync;
fs.mkdtempSync = function (prefix, options) {
  const directory = mkdtemp.call(this, prefix, options);
  if (prefix === path.join(os.tmpdir(), "weighin-key-")) {
    fs.copyFileSync(
      keyFile,
      path.join(directory, "weighin-deployer.key"),
      fs.constants.COPYFILE_EXCL,
    );
  }
  return directory;
};

require("../support/record-network-io.cjs");
