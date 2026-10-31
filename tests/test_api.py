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
    response = client.post(
        "/login",
        data={"username": "testroot", "password": "test-passphrase-16-chars-min"},
        follow_redirects=False,
    )
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
    response = client.post("/login", data={"username": "testroot", "password": "wrong-password-0000"}, follow_redirects=False)
    assert response.status_code == 303
    assert "error=invalid" in response.headers["location"]


def test_admin_can_sign_in_with_email(authed: TestClient):
    created = authed.post(
        "/api/admins",
        json={
            "username": "email.user",
            "password": "email-test-passphrase-16",
            "privileges": ["reports_view"],
            "email": "Email.User@example.org",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["email"] == "email.user@example.org"

    with TestClient(main.app) as session:
        via_email = session.post(
            "/login",
            data={"username": "email.user@EXAMPLE.org", "password": "email-test-passphrase-16"},
            follow_redirects=False,
        )
        assert via_email.status_code == 303
        assert via_email.headers["location"] == "/"
        assert session.get("/api/session").status_code == 200

    with TestClient(main.app) as session:
        via_username = session.post(
            "/login",
            data={"username": "email.user", "password": "email-test-passphrase-16"},
            follow_redirects=False,
        )
        assert via_username.status_code == 303
        assert session.get("/api/session").status_code == 200


def test_admin_email_must_be_valid_and_unique(authed: TestClient):
    bad = authed.post(
        "/api/admins",
        json={"username": "bad.mail", "password": "email-test-passphrase-16", "privileges": [], "email": "not-an-email"},
    )
    assert bad.status_code == 422

    first = authed.post(
        "/api/admins",
        json={"username": "first.mail", "password": "email-test-passphrase-16", "privileges": [], "email": "taken@example.org"},
    )
    assert first.status_code == 201, first.text
    duplicate = authed.post(
        "/api/admins",
        json={"username": "second.mail", "password": "email-test-passphrase-16", "privileges": [], "email": "TAKEN@example.org"},
    )
    assert duplicate.status_code == 409


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


def test_index_serves_landing_page_to_guests(client: TestClient):
    # The public Homepage landing must load without signing in.
    response = client.get("/", follow_redirects=False)
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]


def test_frontend_assets_are_public(client: TestClient):
    # Built bundles carry no secrets; guests need them for the landing page.
    # A missing asset still 404s (and does not leak auth-gated content).
    assert client.get("/assets/index-test.js").status_code == 404


def test_login_stylesheet_is_public(client: TestClient):
    response = client.get("/static/styles.css")
    assert response.status_code == 200
    assert "text/css" in response.headers["content-type"]


def _make_report(client: TestClient, title: str = "Pothole on Mabini Street") -> dict:
    response = client.post(
        "/api/reports",
        data={
            "title": title,
            "category": "Road damage",
            "description": "A large pothole near the footbridge, over ten characters.",
            "location": "Mabini Street, near the footbridge",
        },
        files={"evidence": ("road.png", PNG_BYTES, "image/png")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_report_detail_round_trip(authed: TestClient):
    created = _make_report(authed)
    assert created["public_code"].startswith("PP-")
    fetched = authed.get(f"/api/reports/{created['id']}")
    assert fetched.status_code == 200, fetched.text
    body = fetched.json()
    assert body["id"] == created["id"]
    assert body["public_code"] == created["public_code"]
    assert body["observations"] == []
    assert body["observed_date"] is None
    assert body["resident_context"] is None


def test_report_detail_404_and_auth(authed: TestClient):
    from fastapi.testclient import TestClient as FreshClient

    created = _make_report(authed)
    assert authed.get("/api/reports/does-not-exist").status_code == 404
    assert authed.get("/api/reports/does-not-exist").json()["detail"] == "Report not found."
    with FreshClient(main.app) as guest:
        assert guest.get(f"/api/reports/{created['id']}").status_code == 401


def test_report_patch_extended_fields(authed: TestClient):
    created = _make_report(authed)
    patched = authed.patch(
        f"/api/reports/{created['id']}",
        json={
            "title": "Pothole on Mabini Street edited",
            "category": "Roads and pathways",
            "description": "Edited description well over ten characters.",
            "location": "Mabini Street",
            "observed_date": "2026-10-27",
            "resident_context": "I saw it after the rain.",
            "observations": [
                {"id": "01", "title": "Pothole", "body": "A deep hole in the road.", "selected": True},
                {"id": "02", "title": "Crack", "body": "A surface crack nearby.", "selected": False},
            ],
        },
    )
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["observed_date"] == "2026-10-27"
    assert body["observed_date"] != body["created_at"]
    assert body["resident_context"] == "I saw it after the rain."
    assert len(body["observations"]) == 2
    assert body["observations"][0]["selected"] is True
    fetched = authed.get(f"/api/reports/{created['id']}").json()
    assert fetched["observed_date"] == "2026-10-27"


def test_report_status_guardrails(authed: TestClient):
    created = _make_report(authed, "Status guardrail report")
    rid = created["id"]
    assert authed.patch(f"/api/reports/{rid}/status", json={"status": "Resolved"}).status_code == 200
    downgrade = authed.patch(f"/api/reports/{rid}/status", json={"status": "Draft"})
    assert downgrade.status_code == 409
    assert "confirm" in downgrade.json()["detail"].lower()
    confirmed = authed.patch(
        f"/api/reports/{rid}/status", json={"status": "Draft", "confirm_downgrade": True}
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "Draft"


def test_evidence_replace_and_remove(authed: TestClient):
    created = _make_report(authed, "Evidence replace report")
    rid = created["id"]
    replaced = authed.post(
        f"/api/reports/{rid}/evidence",
        files={"evidence": ("road2.png", PNG_BYTES, "image/png")},
        data={"strip_metadata": "true", "blur_applied": "true"},
    )
    assert replaced.status_code == 200, replaced.text
    assert replaced.json()["strip_metadata"] is True
    assert replaced.json()["blur_applied"] is True
    removed = authed.delete(f"/api/reports/{rid}/evidence")
    assert removed.status_code == 204
    assert authed.get(f"/api/evidence/{created['evidence_name']}").status_code == 404


def test_report_pdf_download(authed: TestClient):
    created = _make_report(authed, "PDF download report")
    authed.patch(
        f"/api/reports/{created['id']}",
        json={
            "title": "PDF download report",
            "category": "Road damage",
            "description": "Description well over ten characters.",
            "location": "Mabini Street",
            "observed_date": "2026-10-27",
            "resident_context": "Seen after heavy rain.",
            "observations": [
                {"id": "01", "title": "Pothole", "body": "Deep hole.", "selected": True},
            ],
        },
    )
    response = authed.get(f"/api/reports/{created['id']}/pdf")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")
    assert "attachment" in response.headers["content-disposition"]
    assert created["public_code"] in response.headers["content-disposition"]


def test_report_pdf_auth_and_404(authed: TestClient):
    from fastapi.testclient import TestClient as FreshClient

    created = _make_report(authed, "PDF auth report")
    with FreshClient(main.app) as guest:
        assert guest.get(f"/api/reports/{created['id']}/pdf").status_code == 401
    missing = authed.get("/api/reports/does-not-exist/pdf")
    assert missing.status_code == 404
    assert "PROOFPATH_" not in missing.json()["detail"]
