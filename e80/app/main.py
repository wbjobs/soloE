from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .api.routes import router
from .database.sqlite import init_sqlite_db
from .database.postgresql import init_pg_db

app = FastAPI(title=settings.app_name, version=settings.api_version)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.on_event("startup")
def startup_event():
    init_sqlite_db()
    init_pg_db()


@app.get("/")
def root():
    return {
        "app": settings.app_name,
        "version": settings.api_version,
        "endpoints": {
            "query": "POST /api/v1/query",
            "health": "GET /api/v1/health",
        },
    }
