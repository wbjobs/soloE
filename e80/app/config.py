from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Federated Query API Gateway"
    api_version: str = "v1"

    sqlite_db_path: str = "./data/sales.db"

    pg_host: str = "localhost"
    pg_port: int = 5432
    pg_user: str = "postgres"
    pg_password: str = "postgres"
    pg_db: str = "products"

    use_mock_pg: bool = True

    log_level: str = "INFO"


settings = Settings()
