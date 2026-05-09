from fastapi import FastAPI
from fastapi.responses import RedirectResponse

from dashboard.app import router as dashboard_router

app = FastAPI(title="shiwake-ai PR Agent")

app.include_router(dashboard_router)


@app.get("/")
async def root() -> RedirectResponse:
    return RedirectResponse(url="/dashboard/")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
