const { nativeToScVal, Address, xdr } = require("@stellar/stellar-sdk");
try {
  let addr = "GB65G5QTVDNTXQ7T2I7U7V34HUIOZYMFZFYHYHTTYX43O2PFR7Q2W4F5";
  console.log(nativeToScVal(addr, { type: "address" }));
} catch(e) { console.log(e.message); }

try {
  let addr = "invalid";
  console.log(nativeToScVal(addr, { type: "address" }));
} catch(e) { console.log(e.message); }

