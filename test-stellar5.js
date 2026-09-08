const { nativeToScVal } = require("@stellar/stellar-sdk");
let buf = Buffer.from("deadbeef", "hex");
console.log(nativeToScVal(buf, { type: "bytes" }));
