"""AUTO-ONE API application entry point."""

from fastapi import FastAPI

from auto_one import __version__

app = FastAPI(
    title="AUTO-ONE API",
    description="API foundation for the AUTO-ONE unified automation system.",
    version=__version__,
)


@app.get("/healthz", tags=["system"], summary="Check API process health")
async def health_check() -> dict[str, str]:
    """Return a lightweight health response without exposing secrets or host details."""
    return {
        "status": "ok",
        "service": "auto-one-api",
        "version": __version__,
    }
