import httpx

def main() -> None:
    response = httpx.post(
        "https://rpc.testnet.near.org",
        json={"jsonrpc": "2.0", "id": "probe", "method": "status", "params": []},
        timeout=15,
    )
    response.raise_for_status()
    data = response.json()
    sync = data.get("result", {}).get("sync_info", {})
    print("Connected to NEAR testnet")
    print("Latest block height:", sync.get("latest_block_height"))
    print("Latest block hash:  ", sync.get("latest_block_hash"))

if __name__ == "__main__":
    main()