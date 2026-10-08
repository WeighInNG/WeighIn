// Forwarding observers: save HTTP and native IO without substituting responses.
require('./record-migration-io.cjs');
const fs = require('node:fs'), path = require('node:path');
const fetchOriginal = globalThis.fetch, calls = [];
const directory = process.env.WEIGHIN_MIGRATION_EVIDENCE;
globalThis.fetch = async (...args) => {
  const request = { url: String(args[0]), method: args[1]?.method || 'GET',
    body: args[1]?.body ? JSON.parse(args[1].body) : null };
  try {
    const response = await fetchOriginal(...args);
    calls.push({ request, status: response.status, body: await response.clone().text() });
    fs.writeFileSync(path.join(directory, 'http.json'), JSON.stringify(calls, null, 2) + '\n');
    return response;
  } catch (error) {
    calls.push({ request, error: error.message });
    fs.writeFileSync(path.join(directory, 'http.json'), JSON.stringify(calls, null, 2) + '\n');
    throw error;
  }
};
