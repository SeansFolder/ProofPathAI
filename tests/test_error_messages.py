"""Backend failures must show friendly UI text, never config/debug internals."""
from __future__ import annotations

import os
import tempfile

_test_root = tempfile.mkdtemp(prefix="proofpath-errors-test-")
os.environ.setdefault("PROOFPATH_DATA_DIR", os.path.join(_test_root, "data"))
os.environ.setdefault("PROOFPATH_SUPERADMIN_USERNAME", "testroot")
os.environ.setdefault("PROOFPATH_SUPERADMIN_PASSWORD", "test-passphrase-16-chars-min")
os.environ.setdefault("PROOFPATH_SESSION_SECRET", "test-secret-" + "x" * 40)
for _var in (
    "PROOFPATH_MODAL_SAM_ENDPOINT",
    "PROOFPATH_SPARK_ENDPOINT",
    "PROOFPATH_IMAGE_ENDPOINT",
):
    os.environ.pop(_var, None)

import pytest
from fastapi.testclient import TestClient

import main

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100


@pytest.fixture()
def client():
    with TestClient(main.app) as test_client:
        yield test_client


@pytest.fixture()
def authed(client: TestClient):
    response = client.post(
        "/login",
        data={"username": "testroot", "password": "test-passphrase-16-chars-min"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    return client


def test_login_unconfigured_redirects_to_friendly_page(client: TestClient, monkeypatch):
    monkeypatch.setattr(main, "SESSION_SECRET", "short")
    response = client.post(
        "/login", data={"username": "testroot", "password": "anything"}, follow_redirects=False
    )
    assert response.status_code == 303
    assert response.headers["location"] == "/login?error=unavailable"

    page = client.get("/login?error=unavailable")
    assert page.status_code == 200
    assert "temporarily unavailable" in page.text
    assert "PROOFPATH_" not in page.text


def test_session_unconfigured_hides_config_name(client: TestClient, monkeypatch):
    monkeypatch.setattr(main, "SESSION_SECRET", "short")
    response = client.get("/api/session")
    assert response.status_code == 503
    assert "PROOFPATH_" not in response.json()["detail"]


def test_ai_unconfigured_hides_config_names(authed: TestClient):
    segment = authed.post("/api/ai/segment", files={"evidence": ("photo.png", PNG_BYTES, "image/png")})
    assert segment.status_code == 503
    assert "PROOFPATH_" not in segment.json()["detail"]

    graphic = authed.post("/api/ai/awareness-graphic", json={"prompt": "Keep drains clear of autumn leaves"})
    assert graphic.status_code == 503
    assert "PROOFPATH_" not in graphic.json()["detail"]
