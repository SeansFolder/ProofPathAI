"""Resident signup + email verification: POST /api/residents, /verify, /verify/resend."""
from __future__ import annotations

import os
import tempfile
from contextlib import closing

_test_root = tempfile.mkdtemp(prefix="proofpath-signup-test-")
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

PASSWORD = "resident-passphrase-16"


@pytest.fixture()
def client():
    with TestClient(main.app) as test_client:
        yield test_client


def _username_for(email: str) -> str:
    local = email.split("@", 1)[0].lower().replace("-", "_")
    return local or "resident"


def _signup(client: TestClient, email: str, password: str = PASSWORD, extra: dict | None = None):
    payload = {"email": email, "username": _username_for(email), "password": password}
    if extra:
        payload.update(extra)
    return client.post("/api/residents", json=payload)


def _row_by_email(email: str):
    with closing(main.connect_database()) as connection:
        return connection.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()


def test_signup_creates_resident_without_session(client: TestClient):
    response = _signup(client, "new-resident-a@example.com")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["email"] == "new-resident-a@example.com"
    assert body["username"] == "new_resident_a"
    assert "password" not in body
    assert body["verification_required"] is True
    assert body["dev_preview_url"].startswith("/?verify=")
    assert main.SESSION_COOKIE not in response.cookies
    row = _row_by_email("new-resident-a@example.com")
    assert row["role"] == "resident"
    assert row["privileges"] == "[]"
    assert row["email_verified"] == 0
    assert row["verification_token_hash"] != ""
    assert main.verify_password(PASSWORD, row["salt"], row["password_hash"])
    previews = list(main.EMAIL_OUTBOX_DIR.glob("*.json"))
    assert previews, "signup must write a local email preview (no SMTP configured)"


def test_signup_ignores_caller_supplied_role(client: TestClient):
    response = _signup(client, "new-resident-b@example.com", extra={"role": "super_admin"})
    assert response.status_code == 201, response.text
    assert _row_by_email("new-resident-b@example.com")["role"] == "resident"


def test_signup_rejects_duplicates_bad_email_short_password(client: TestClient):
    assert _signup(client, "new-resident-c@example.com").status_code == 201
    duplicate = _signup(client, "new-resident-c@example.com")
    assert duplicate.status_code == 409
    assert _signup(client, "not-an-email").status_code == 422
    assert _signup(client, "").status_code == 422
    assert _signup(client, "new-resident-d@example.com", password="short").status_code == 422


def test_signup_requires_valid_username(client: TestClient):
    assert client.post("/api/residents", json={"email": "nouser@example.com", "password": PASSWORD}).status_code == 422
    assert client.post("/api/residents", json={"email": "baduser@example.com", "username": "ab", "password": PASSWORD}).status_code == 422
    assert client.post("/api/residents", json={"email": "baduser2@example.com", "username": "has space", "password": PASSWORD}).status_code == 422
    assert client.post("/api/residents", json={"email": "baduser3@example.com", "username": "has@at", "password": PASSWORD}).status_code == 422
    assert client.post("/api/residents", json={"email": "okuser@example.com", "username": "ok.user_1", "password": PASSWORD}).status_code == 201
    clash = client.post("/api/residents", json={"email": "other@example.com", "username": "OK.USER_1", "password": PASSWORD})
    assert clash.status_code == 409
    assert "username" in clash.json()["detail"].lower()


def test_verify_consumes_single_use_token(client: TestClient):
    created = _signup(client, "new-resident-e@example.com").json()
    token = created["dev_preview_url"].split("verify=", 1)[1]
    ok = client.post("/api/residents/verify", json={"token": token})
    assert ok.status_code == 200, ok.text
    assert ok.json() == {"verified": True, "email": "new-resident-e@example.com"}
    assert _row_by_email("new-resident-e@example.com")["email_verified"] == 1
    reuse = client.post("/api/residents/verify", json={"token": token})
    assert reuse.status_code == 400
    assert client.post("/api/residents/verify", json={"token": "bogus"}).status_code == 400
    assert client.post("/api/residents/verify", json={"token": ""}).status_code == 400


def test_verify_rejects_expired_token(client: TestClient):
    _signup(client, "new-resident-f@example.com")
    with closing(main.connect_database()) as connection:
        connection.execute(
            "UPDATE users SET verification_expires = '2000-01-01T00:00:00+00:00' WHERE email = ?",
            ("new-resident-f@example.com",),
        )
        connection.commit()
        token_hash = connection.execute(
            "SELECT verification_token_hash FROM users WHERE email = ?", ("new-resident-f@example.com",)
        ).fetchone()[0]
    assert token_hash, "test needs a stored token hash"
    # Recover the raw token from the dev preview written at signup.
    raw = None
    for path in main.EMAIL_OUTBOX_DIR.glob("*.json"):
        content = path.read_text(encoding="utf-8")
        if "new-resident-f@example.com" in content and "/?verify=" in content:
            raw = content.split("/?verify=", 1)[1].split('"', 1)[0].split("\\", 1)[0].strip()
    assert raw and main._verification_hash(raw) == token_hash
    expired = client.post("/api/residents/verify", json={"token": raw})
    assert expired.status_code == 410


def test_resend_is_generic_and_refreshes_pending(client: TestClient):
    _signup(client, "new-resident-g@example.com")
    before = _row_by_email("new-resident-g@example.com")["verification_token_hash"]
    response = client.post("/api/residents/verify/resend", json={"email": "new-resident-g@example.com"})
    assert response.status_code == 200
    assert "pending confirmation" in response.json()["detail"]
    assert _row_by_email("new-resident-g@example.com")["verification_token_hash"] != before
    unknown = client.post("/api/residents/verify/resend", json={"email": "nobody-here@example.com"})
    assert unknown.status_code == 200
    assert unknown.json() == response.json()


def test_resident_can_sign_in_before_verifying_and_cannot_use_admin_apis(client: TestClient):
    _signup(client, "new-resident-h@example.com")
    with TestClient(main.app) as session:
        login = session.post("/api/session", json={"username": "new-resident-h@example.com", "password": PASSWORD})
        assert login.status_code == 200, login.text
        assert session.get("/api/admins").status_code == 403
