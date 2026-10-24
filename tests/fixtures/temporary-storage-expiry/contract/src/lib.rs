#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, vec, Env, Symbol, Vec};

const TEMP_KEY: Symbol = symbol_short!("temp_ttl");
const TEMP_TTL_THRESHOLD: u32 = 16;
const TEMP_TTL_EXTEND_TO: u32 = 64;

#[contract]
pub struct HelloContract;

#[contractimpl]
impl HelloContract {
    pub fn hello(env: Env, to: Symbol) -> Vec<Symbol> {
        let sequence = env.ledger().sequence();
        let mut out = vec![&env, symbol_short!("Hello"), to];
        if let Some(_cached_seed_ledger) = env.storage().temporary().get::<Symbol, u32>(&TEMP_KEY) {
            out.push_back(symbol_short!("live"));
        } else {
            env.storage().temporary().set(&TEMP_KEY, &sequence);
            env.storage()
                .temporary()
                .extend_ttl(&TEMP_KEY, TEMP_TTL_THRESHOLD, TEMP_TTL_EXTEND_TO);
            out.push_back(symbol_short!("expired"));
            out.push_back(symbol_short!("reinit"));
        }
        out
    }
}
