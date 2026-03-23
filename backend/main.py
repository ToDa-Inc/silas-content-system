from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import get_cors_list, get_settings
from routers import clients, intelligence, jobs

settings = get_settings()
app = FastAPI(title="Silas Content API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_list(settings),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(clients.router)
app.include_router(intelligence.router)
app.include_router(jobs.router)


@app.get("/health")
def health() -> dict:
    return {"ok": True}
