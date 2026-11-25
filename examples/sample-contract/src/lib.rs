#![no_std]

use soroban_sdk::{contract, contractimpl, symbol_short, Env};

const COUNT: soroban_sdk::Symbol = symbol_short!("count");

#[contract]
pub struct SampleContract;

#[contractimpl]
impl SampleContract {
    pub fn increment(env: Env) -> u32 {
        let count = env
            .storage()
            .persistent()
            .get::<_, u32>(&COUNT)
            .unwrap_or(0)
            .checked_add(1)
            .unwrap();
        env.storage().persistent().set(&COUNT, &count);
        count
    }

    pub fn get_count(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get::<_, u32>(&COUNT)
            .unwrap_or(0)
    }

    pub fn compute_fibonacci(_env: Env, n: u32) -> u64 {
        fibonacci(n)
    }
}

fn fibonacci(n: u32) -> u64 {
    match n {
        0 => 0,
        1 => 1,
        _ => fibonacci(n - 1) + fibonacci(n - 2),
    }
}
