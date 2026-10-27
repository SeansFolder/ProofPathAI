"""Focused API tests: auth gates, AI status/fallback, jobs, filters, headers."""
from __future__ import annotations

import os
import tempfile

_test_root = tempfile.mkdtemp(prefix="proofpath-test-")
os.environ["PROOFPATH_DATA_DIR"] = os.path.join(_test_root, "data")
os.environ["PROOFPATH_SUPERADMIN_USERNAME"] = "testroot"
os.environ["PROOFPATH_SUPERADMIN_PASSWORD"] = "test-passphrase-16-chars-min"
os.environ["PROOFPATH_SESSION_SECRET"] = "test-secret-" + "x" * 40
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
    response = client.post("/login", data={"username": "testroot", "password": "test-passphrase-16-chars-min"})
    assert response.status_code == 303
    return client


def test_health_reports_version_and_ai_status(client: TestClient):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"] == main.app.version
    assert body["ai_analysis"] == "not_configured"
    assert body["ai"]["segmentation"]["configured"] is False
    assert body["ai"]["background_jobs"] is True


def test_security_headers_present(client: TestClient):
    response = client.get("/api/health")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert "Content-Security-Policy" in response.headers


def test_login_rejects_bad_password(client: TestClient):
    response = client.post("/login", data={"username": "testroot", "password": "wrong-password-0000"})
    assert response.status_code == 303
    assert "error=invalid" in response.headers["location"]


def test_reports_require_auth(client: TestClient):
    assert client.get("/api/reports").status_code == 401


def test_ai_status_requires_auth(client: TestClient):
    assert client.get("/api/ai/status").status_code == 401


def test_ai_status_not_configured(authed: TestClient):
    body = authed.get("/api/ai/status").json()
    assert body["segmentation"] == {"configured": False, "provider": None}
    assert body["reasoning"] == {"configured": False, "provider": None}
    assert body["image_generation"] == {"configured": False, "provider": None}
    assert body["batch"] is True


def test_assist_falls_back_without_spark(authed: TestClient):
    response = authed.post("/api/ai/assist", json={"observation": "Water pooling by the curb near the bus stop"})
    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "local-fallback"
    assert "bus stop" in body["structured_description"]
    assert body["missing_info"], "fallback should flag missing when/how details"
    assert body["followup_questions"], "fallback should ask follow-up questions"


def test_segment_unconfigured_returns_503(authed: TestClient):
    response = authed.post("/api/ai/segment", files={"evidence": ("photo.png", PNG_BYTES, "image/png")})
    assert response.status_code == 503


def test_segment_rejects_video(authed: TestClient):
    response = authed.post("/api/ai/segment", files={"evidence": ("clip.mp4", b"video-bytes", "video/mp4")})
    assert response.status_code == 415


def test_awareness_graphic_unconfigured_returns_503(authed: TestClient):
    response = authed.post("/api/ai/awareness-graphic", json={"prompt": "Keep drains clear of autumn leaves"})
    assert response.status_code == 503


def test_segment_job_lifecycle(authed: TestClient):
    name = "12345678-1234-1234-1234-1234567890ab.png"
    created = authed.post("/api/ai/jobs", json={"evidence_names": [name]})
    assert created.status_code == 201
    job_id = created.json()["id"]
    fetched = authed.get(f"/api/ai/jobs/{job_id}")
    assert fetched.status_code == 200
    assert fetched.json()["evidence_names"] == [name]
    assert fetched.json()["status"] in ("queued", "running", "done", "error")
    listed = authed.get("/api/ai/jobs")
    assert any(job["id"] == job_id for job in listed.json())


def test_segment_job_rejects_bad_name(authed: TestClient):
    response = authed.post("/api/ai/jobs", json={"evidence_names": ["../../etc/passwd.png"]})
    assert response.status_code == 422


def test_reports_filter_params(authed: TestClient):
    assert authed.get("/api/reports", params={"status": "Draft"}).status_code == 200
    assert authed.get("/api/reports", params={"status": "Bogus"}).status_code == 422
    assert authed.get("/api/reports", params={"limit": 5}).status_code == 200


def test_index_redirects_to_login_when_anonymous(client: TestClient):
    response = client.get("/", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/login"


def test_frontend_assets_require_auth(client: TestClient):
    assert client.get("/assets/index-test.js").status_code == 401


def test_login_stylesheet_is_public(client: TestClient):
    response = client.get("/static/styles.css")
    assert response.status_code == 200
    assert "text/css" in response.headers["content-type"]
