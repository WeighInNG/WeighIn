#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol, symbol_short};

#[contract]
pub struct PrngContract;

#[contractimpl]
impl PrngContract {
    pub fn flip(env: Env) -> Symbol {
        let value = env.prng().gen_u64();
        if value % 2 == 0 {
            symbol_short!("even")
        } else {
            symbol_short!("odd")
        }
    }
}
