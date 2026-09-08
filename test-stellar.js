const { nativeToScVal, xdr, Address, ScInt } = require("@stellar/stellar-sdk");
console.log("nativeToScVal exists:", !!nativeToScVal);
console.log("ScInt exists:", !!ScInt);
try {
  console.log(nativeToScVal("10000000000", { type: "u64" }));
} catch(e) {
  console.log("Error nativeToScVal u64:", e.message);
}
try {
  console.log(nativeToScVal(123n, { type: "u64" }));
} catch(e) {
  console.log("Error nativeToScVal 123n:", e.message);
}
try {
  console.log(new ScInt("10000000000").toU64());
} catch (e) {
  console.log("ScInt error:", e.message);
}
