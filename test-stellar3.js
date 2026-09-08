const { Address } = require("@stellar/stellar-sdk");
try {
  let addr = "GB65G5QTVDNTXQ7T2I7U7V34HUIOZYMFZFYHYHTTYX43O2PFR7Q2W4F5";
  console.log(Address.fromString(addr).toScVal());
} catch (e) {
  console.log(e.message);
}
try {
  let addr = "invalid";
  Address.fromString(addr).toScVal();
} catch (e) {
  console.log("invalid address error: ", e.message);
}
