// Enforce a local-only transport for the real bundled comment Action.
const net = require('node:net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof options === 'object' ? options.host || options.hostname : args[1];
  if (host !== '127.0.0.1') throw new Error(`Non-local network connection forbidden in comment test: ${host}`);
  return connect.apply(this, args);
};
