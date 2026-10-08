#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, vec, token, Address, Env, String, Vec};
#[contract] pub struct Audit;
#[contractimpl] impl Audit {
  pub fn __constructor(env: Env) { env.storage().persistent().set(&symbol_short!("bench"), &7u32); }
  pub fn bench(env: Env, mode: i32, token: String, owner: String) -> Vec<u32> {
    let key = symbol_short!("bench");
    match mode {
      0 => {
        assert_eq!(env.storage().persistent().get::<_,u32>(&key), Some(7));
        assert_eq!(env.storage().persistent().get::<_,u32>(&key), Some(7));
        assert!(!env.storage().persistent().has(&symbol_short!("missing")));
      },
      1 => env.storage().persistent().set(&key, &7u32),
      2 => env.storage().persistent().remove(&key),
      3 => { env.events().publish((symbol_short!("audit"),), 7u32); },
      4 => { assert!(token::Client::new(&env, &Address::from_string(&token)).balance(&Address::from_string(&owner)) > 0); },
      5 => { let mut out = Vec::new(&env); for i in 0..80 { out.push_back(i); } return out; },
      _ => panic!("unknown mode"),
    }
    vec![&env,7]
  }
}
