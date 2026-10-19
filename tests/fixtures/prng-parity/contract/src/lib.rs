#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, vec, Env, Symbol, Vec};

#[contract]
pub struct PrngParityContract;

#[contractimpl]
impl PrngParityContract {
    pub fn sample_prng(env: Env, label: Symbol) -> Vec<u64> {
        let draw: u64 = env.prng().gen_range::<u64>(1..=16);
        let mut out = vec![&env, draw];
        let mut index = 0u64;
        while index < draw {
            out.push_back(index + 1);
            index += 1;
        }
        env.storage()
            .persistent()
            .set(&symbol_short!("prng_draw"), &(label.clone(), draw));
        env.events()
            .publish((symbol_short!("prng"), label), draw);
        out
    }
}
