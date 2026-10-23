# Deployment notes

## Windows native test limitation

`cargo test --lib` for the Rust contract fails on Windows with
`LNK2001: unresolved external symbol __builtin_bswap32`.

**Root cause:** `aws-lc-sys` 0.39.1 (pinned transitively by
`near-crypto 0.37.4` -> `aws-lc-rs 1.16.2`) incorrectly enables
`AWS_LC_BUILTIN_SWAP_SUPPORTED` on MSVC. The upstream fix landed in
`aws-lc-sys 0.40.0`, but the exact pin prevents upgrading.

**Impact on deployment:** none. The wasm build
(`cargo near build non-reproducible-wasm --no-abi`) succeeds and the
resulting `registry.wasm` is validated by `wasm-opt`.

**Testing strategy:**
- Linux/macOS: `cargo test --lib` runs the 7 unit tests.
- Windows: unit tests are validated via live testnet deployment.

## Windows workaround (if you need to run native tests)

1. Install NASM (`winget install NASM.NASM`) and MSVC Build Tools.
2. From `contract/`: `cargo vendor`
3. Edit `vendor/aws-lc-sys/builder/cc_builder.rs`, line ~750, wrap:
   `cc_build.define("AWS_LC_BUILTIN_SWAP_SUPPORTED", Some("1"));`
   with `if !cfg!(target_env = "msvc") { ... }`.
4. Update `vendor/aws-lc-sys/.cargo-checksum.json`: replace the old
   sha256 of `cc_builder.rs` with the new one shown in the cargo error.
5. Create `contract/.cargo/config.toml`:
   [source.crates-io]
   replace-with = "vendored-sources"
   [source.vendored-sources]
   directory = "vendor"
   [env]
   AWS_LC_SYS_PREBUILT_NASM = "1"
6. `cargo clean -p aws-lc-sys && cargo test --lib`

## Contract deployment

- Source: `contract/registry/src/lib.rs`
- Build: `cd contract/registry && cargo near build non-reproducible-wasm --no-abi`
- Artifact: `contract/target/near/registry/registry.wasm` (~118 KB)
- Network: testnet
