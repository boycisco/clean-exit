from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # App
    app_env: str = "development"
    app_host: str = "127.0.0.1"
    app_port: int = 8000
    app_log_level: str = "INFO"
    app_cors_origins: str = ""

    # Database
    database_url: str = "sqlite+aiosqlite:///./clean.db"

    # NEAR
    near_network: str = "testnet"
    near_rpc_url: str = "https://rpc.testnet.near.org"
    near_signer_account: str = ""
    near_signer_key_path: str = ""

    # Receipt publisher
    receipt_contract: str = ""
    receipt_publisher_account: str = ""
    receipt_publisher_key_path: str = ""

    # Bootstrap
    bootstrap_token: str = ""

    # Limits
    rate_limit_default: int = 60
    rate_limit_destructive: int = 10

    # Worker
    worker_enabled: bool = False
    worker_poll_seconds: float = 2.0
    worker_max_retries: int = 3
    worker_stale_seconds: int = 60

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.app_cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() in {"production", "prod"}

    @property
    def is_mainnet(self) -> bool:
        return self.near_network.lower() == "mainnet"

    @property
    def signer_configured(self) -> bool:
        if not self.near_signer_account or not self.near_signer_key_path:
            return False
        return Path(self.near_signer_key_path).exists()

    @property
    def publisher_configured(self) -> bool:
        if not (
            self.receipt_contract
            and self.receipt_publisher_account
            and self.receipt_publisher_key_path
        ):
            return False
        return Path(self.receipt_publisher_key_path).exists()

    def signing_allowed(self) -> tuple[bool, str]:
        if not self.near_signer_account or not self.near_signer_key_path:
            return False, "signer_unavailable"
        if not Path(self.near_signer_key_path).exists():
            return False, "signer_unavailable"
        if self.is_mainnet and not self.is_production:
            return False, "mainnet_signing_forbidden_in_non_production"
        try:
            from signer import Signer

            Signer.from_file(
                self.near_signer_key_path,
                expected_account=self.near_signer_account,
            )
        except Exception:
            return False, "signer_invalid"
        return True, "ok"

    def publisher_allowed(self) -> tuple[bool, str]:
        if not self.receipt_contract:
            return False, "contract_not_configured"
        if not self.receipt_publisher_account or not self.receipt_publisher_key_path:
            return False, "publisher_not_configured"
        if not Path(self.receipt_publisher_key_path).exists():
            return False, "publisher_unavailable"
        if self.is_mainnet and not self.is_production:
            return False, "mainnet_publishing_forbidden_in_non_production"
        try:
            from signer import Signer

            Signer.from_file(
                self.receipt_publisher_key_path,
                expected_account=self.receipt_publisher_account,
            )
        except Exception:
            return False, "publisher_invalid"
        return True, "ok"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()