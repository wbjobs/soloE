from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    UPLOAD_DIR: Path = Path("uploads")
    OUTPUT_DIR: Path = Path("outputs")
    DATABASE_URL: str = "sqlite+aiosqlite:///./meeting_analyzer.db"
    WHISPER_MODEL: str = "medium"
    WHISPER_COMPUTE_TYPE: str = "int8"
    WHISPER_DEVICE: str = "auto"
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "command-r"
    MAX_SPEAKERS: int = 10
    DEFAULT_SPEAKERS: int = 2
    USE_PYANNOTE: bool = False
    PYANNOTE_AUTH_TOKEN: str = ""
    VAD_MIN_SPEECH_DURATION: float = 0.3
    VAD_MAX_SPEECH_DURATION: float = 30.0

    class Config:
        env_file = ".env"


settings = Settings()

settings.UPLOAD_DIR.mkdir(exist_ok=True)
settings.OUTPUT_DIR.mkdir(exist_ok=True)
