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


## Testnet deployment evidence

**Network:** NEAR testnet (not mainnet)

**Contract account:** `clean-exit-registry-587840.testnet`

**Deploy transaction:** `DpKfKDJ7KTsyRMApDLx5vPtpqEJVBd2na2MFu745Kgkz`

**Wasm SHA-256 (full):**
`96c727a0d9704cb529bebe25041419ba81527ef39559476886b531294d007adc`

**Wasm size:** 118,801 bytes

### Verify the deployment yourself

Confirm the contract is live and initialized:

    near contract call-function as-read-only clean-exit-registry-587840.testnet count json-args '{}' network-config testnet now

Expected: `1` (one receipt has been published)

    near contract call-function as-read-only clean-exit-registry-587840.testnet owner json-args '{}' network-config testnet now

Expected: `"clean-exit-registry-587840.testnet"` (the deployer is the sole publisher)

Retrieve the published receipt by its UUID:

    python -c "import httpx, base64, json; args = base64.b64encode(json.dumps({'receipt_id':'5956db00-975d-434e-8fd0-67b1be133324'}, separators=(',',':')).encode()).decode(); r = httpx.post('https://rpc.testnet.near.org', json={'jsonrpc':'2.0','id':'x','method':'query','params':{'request_type':'call_function','finality':'final','account_id':'clean-exit-registry-587840.testnet','method_name':'get','args_base64':args}}, timeout=30); print(bytes(r.json()['result']['result']).decode())"

Expected: a JSON object with `"payload_hash":"ec8bb6d5c2c271a0f9fe78eeef5bbffcf4c676d77c98cfd92817aaea8666c0e9"`

Explorer: https://explorer.testnet.near.org/transactions/DpKfKDJ7KTsyRMApDLx5vPtpqEJVBd2na2MFu745Kgkz

### Scope of this evidence

- The deploy transaction hash above was captured in the original deployment output and matches the live on-chain state.
- The Wasm SHA-256 was verified against the local build artifact at `contract/target/near/registry/registry.wasm`.
- This is **testnet deployment evidence**, not a mainnet production deployment.