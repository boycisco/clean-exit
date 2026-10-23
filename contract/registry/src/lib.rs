use near_sdk::store::IterableMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

/// On-chain record for a finalized Clean Exit receipt.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Receipt {
    pub receipt_id: String,
    pub payload_hash: String,
    pub agent_account: Option<String>,
    pub schema_version: u32,
    pub published_at: u64,
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Receipts,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Registry {
    owner: AccountId,
    receipts: IterableMap<String, Receipt>,
}

#[near]
impl Registry {
    #[init]
    pub fn new() -> Self {
        Self {
            owner: env::predecessor_account_id(),
            receipts: IterableMap::new(StorageKey::Receipts),
        }
    }

    /// Publish a receipt commitment. Only the owner can call this.
    /// Panics if the receipt_id already exists — receipts are immutable.
    pub fn publish(
        &mut self,
        receipt_id: String,
        payload_hash: String,
        agent_account: Option<String>,
        schema_version: u32,
    ) {
        require!(
            env::predecessor_account_id() == self.owner,
            "unauthorized: only owner can publish"
        );
        require!(!receipt_id.is_empty(), "receipt_id must not be empty");
        require!(
            payload_hash.len() == 64,
            "payload_hash must be 64 hex chars (sha256)"
        );
        require!(
            !self.receipts.contains_key(&receipt_id),
            "receipt already published: immutable"
        );

        let receipt = Receipt {
            receipt_id: receipt_id.clone(),
            payload_hash,
            agent_account,
            schema_version,
            published_at: env::block_timestamp(),
        };

        self.receipts.insert(receipt_id, receipt);
    }

    pub fn get(&self, receipt_id: String) -> Option<Receipt> {
        self.receipts.get(&receipt_id).cloned()
    }

    pub fn verify(&self, receipt_id: String, expected_hash: String) -> bool {
        match self.receipts.get(&receipt_id) {
            Some(r) => r.payload_hash == expected_hash,
            None => false,
        }
    }

    pub fn owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn count(&self) -> u64 {
        self.receipts.len() as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(predecessor: AccountId) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(predecessor);
        b
    }

    fn dummy_hash() -> String {
        "a".repeat(64)
    }

    #[test]
    fn init_sets_owner() {
        testing_env!(ctx(accounts(0)).build());
        let c = Registry::new();
        assert_eq!(c.owner(), accounts(0));
    }

    #[test]
    fn owner_can_publish() {
        testing_env!(ctx(accounts(0)).build());
        let mut c = Registry::new();
        c.publish("r1".into(), dummy_hash(), Some("alice.testnet".into()), 1);
        let r = c.get("r1".into()).expect("exists");
        assert_eq!(r.receipt_id, "r1");
        assert_eq!(r.payload_hash, dummy_hash());
        assert_eq!(r.schema_version, 1);
        assert_eq!(c.count(), 1);
    }

    #[test]
    #[should_panic(expected = "unauthorized")]
    fn non_owner_cannot_publish() {
        testing_env!(ctx(accounts(0)).build());
        let mut c = Registry::new();
        testing_env!(ctx(accounts(1)).build());
        c.publish("r1".into(), dummy_hash(), None, 1);
    }

    #[test]
    #[should_panic(expected = "immutable")]
    fn duplicate_publish_rejected() {
        testing_env!(ctx(accounts(0)).build());
        let mut c = Registry::new();
        c.publish("r1".into(), dummy_hash(), None, 1);
        c.publish("r1".into(), "b".repeat(64), None, 1);
    }

    #[test]
    #[should_panic(expected = "64 hex")]
    fn bad_hash_length_rejected() {
        testing_env!(ctx(accounts(0)).build());
        let mut c = Registry::new();
        c.publish("r1".into(), "short".into(), None, 1);
    }

    #[test]
    #[should_panic(expected = "empty")]
    fn empty_receipt_id_rejected() {
        testing_env!(ctx(accounts(0)).build());
        let mut c = Registry::new();
        c.publish("".into(), dummy_hash(), None, 1);
    }

    #[test]
    fn verify_matches_and_mismatches() {
        testing_env!(ctx(accounts(0)).build());
        let mut c = Registry::new();
        c.publish("r1".into(), dummy_hash(), None, 1);
        assert!(c.verify("r1".into(), dummy_hash()));
        assert!(!c.verify("r1".into(), "b".repeat(64)));
        assert!(!c.verify("missing".into(), dummy_hash()));
    }
}