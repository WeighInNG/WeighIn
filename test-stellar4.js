const { Keypair, Address } = require("@stellar/stellar-sdk");
let kp = Keypair.random();
console.log("real address:", kp.publicKey());
let addr = Address.fromString(kp.publicKey());
console.log(addr.toScVal());
