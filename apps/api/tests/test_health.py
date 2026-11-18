"""Tests for the API health endpoint."""

from fastapi.testclient import TestClient

from auto_one.api.main import app

client = TestClient(app)


def test_health_check_returns_ok() -> None:
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "auto-one-api",
        "version": "0.1.0",
    }
