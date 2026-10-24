#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, vec, Env, Symbol, Vec};

const STATE_KEY: Symbol = symbol_short!("state");
const SEEDED_VALUE: Symbol = symbol_short!("seeded");

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    /// Benchmark proof contract for discarded simulation writes (#172).
    ///
    /// - `mode == "write"`: writes `STATE_KEY -> SEEDED_VALUE` in persistent contract storage
    ///   and returns `["Hello", "write", "wrote", "seeded"]`.
    /// - `mode == "read"`: reads `STATE_KEY` from persistent contract storage without mutating
    ///   state; returns `["Hello", "read", "present", val]` if committed state exists or
    ///   `["Hello", "read", "absent", "uninit"]` if no committed entry exists.
    /// - `mode == "require"`: requires `STATE_KEY` to be initialized in committed storage and
    ///   panics if the prior write was only simulated and discarded.
    pub fn hello(env: Env, mode: Symbol) -> Vec<Symbol> {
        let persistent = env.storage().persistent();
        if mode == symbol_short!("write") {
            persistent.set(&STATE_KEY, &SEEDED_VALUE);
            vec![
                &env,
                symbol_short!("Hello"),
                mode,
                symbol_short!("wrote"),
                SEEDED_VALUE,
            ]
        } else if mode == symbol_short!("read") {
            match persistent.get::<Symbol, Symbol>(&STATE_KEY) {
                Some(value) => vec![
                    &env,
                    symbol_short!("Hello"),
                    mode,
                    symbol_short!("present"),
                    value,
                ],
                None => vec![
                    &env,
                    symbol_short!("Hello"),
                    mode,
                    symbol_short!("absent"),
                    symbol_short!("uninit"),
                ],
            }
        } else if mode == symbol_short!("require") {
            let value: Symbol = persistent
                .get(&STATE_KEY)
                .expect("setup required: state key not initialized in committed storage");
            vec![
                &env,
                symbol_short!("Hello"),
                mode,
                symbol_short!("verified"),
                value,
            ]
        } else {
            panic!("unsupported mode");
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn test_write_read_and_require_modes() {
        let env = Env::default();
        let contract_id = env.register(Contract, ());
        let client = ContractClient::new(&env, &contract_id);

        // Fresh uninitialized read observes absent committed state
        assert_eq!(
            client.hello(&symbol_short!("read")),
            vec![
                &env,
                symbol_short!("Hello"),
                symbol_short!("read"),
                symbol_short!("absent"),
                symbol_short!("uninit"),
            ]
        );

        // In unit tests (where calls commit into the test Env), write seeds state
        assert_eq!(
            client.hello(&symbol_short!("write")),
            vec![
                &env,
                symbol_short!("Hello"),
                symbol_short!("write"),
                symbol_short!("wrote"),
                symbol_short!("seeded"),
            ]
        );
        assert_eq!(
            client.hello(&symbol_short!("read")),
            vec![
                &env,
                symbol_short!("Hello"),
                symbol_short!("read"),
                symbol_short!("present"),
                symbol_short!("seeded"),
            ]
        );
        assert_eq!(
            client.hello(&symbol_short!("require")),
            vec![
                &env,
                symbol_short!("Hello"),
                symbol_short!("require"),
                symbol_short!("verified"),
                symbol_short!("seeded"),
            ]
        );
    }
}
