"""Resident password recovery + own-account profile: generic request copy,
single-use expiring reset tokens, and profile persistence."""
from __future__ import annotations

import os
import tempfile
from contextlib import closing

_test_root = tempfile.mkdtemp(prefix="proofpath-recovery-test-")
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
NEW_PASSWORD = "resident-new-passphrase-16"


@pytest.fixture()
def client():
    with TestClient(main.app) as test_client:
        yield test_client


def _username_for(email: str) -> str:
    return email.split("@", 1)[0].lower().replace("-", "_") or "resident"


def _signup(client: TestClient, email: str, password: str = PASSWORD):
    response = client.post("/api/residents", json={"email": email, "username": _username_for(email), "password": password})
    assert response.status_code == 201, response.text
    return response.json()


def _row_by_email(email: str):
    with closing(main.connect_database()) as connection:
        return connection.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()


def _reset_token_for(email: str) -> str:
    wanted = main._verification_hash  # same sha256 hex scheme as reset tokens
    for path in main.EMAIL_OUTBOX_DIR.glob("*.json"):
        content = path.read_text(encoding="utf-8")
        if email in content and "/?reset=" in content:
            raw = content.split("/?reset=", 1)[1].split('"', 1)[0].split("\\", 1)[0].strip()
            row = _row_by_email(email)
            if row and wanted(raw) == row["password_reset_token_hash"]:
                return raw
    raise AssertionError(f"no reset preview found for {email}")


def test_request_is_generic_for_unknown_and_known(client: TestClient):
    _signup(client, "recovery-known@example.com")
    known = client.post("/api/residents/password/request", json={"email": "recovery-known@example.com"})
    unknown = client.post("/api/residents/password/request", json={"email": "recovery-nobody@example.com"})
    assert known.status_code == 200 and unknown.status_code == 200
    assert known.json() == unknown.json()
    assert "will arrive shortly" in known.json()["detail"]
    # The known address gets a stored single-use token; nothing leaks in body.
    assert _row_by_email("recovery-known@example.com")["password_reset_token_hash"] != ""
    assert "dev_preview_url" not in known.json()


def test_reset_consumes_single_use_token(client: TestClient):
    _signup(client, "recovery-consume@example.com")
    client.post("/api/residents/password/request", json={"email": "recovery-consume@example.com"})
    token = _reset_token_for("recovery-consume@example.com")
    ok = client.post("/api/residents/password/reset", json={"token": token, "password": NEW_PASSWORD})
    assert ok.status_code == 200, ok.text
    assert ok.json() == {"reset": True}
    row = _row_by_email("recovery-consume@example.com")
    assert row["password_reset_token_hash"] == ""
    # Reuse is rejected.
    reuse = client.post("/api/residents/password/reset", json={"token": token, "password": NEW_PASSWORD})
    assert reuse.status_code == 400
    # New password signs in; old password no longer works.
    with TestClient(main.app) as session:
        assert session.post("/api/session", json={"username": "recovery-consume@example.com", "password": NEW_PASSWORD}).status_code == 200
    with TestClient(main.app) as stale:
        assert stale.post("/api/session", json={"username": "recovery-consume@example.com", "password": PASSWORD}).status_code == 401


def test_reset_rejects_bad_token_expired_and_short_password(client: TestClient):
    _signup(client, "recovery-expire@example.com")
    client.post("/api/residents/password/request", json={"email": "recovery-expire@example.com"})
    token = _reset_token_for("recovery-expire@example.com")
    assert client.post("/api/residents/password/reset", json={"token": "bogus", "password": NEW_PASSWORD}).status_code == 400
    assert client.post("/api/residents/password/reset", json={"token": "", "password": NEW_PASSWORD}).status_code == 400
    assert client.post("/api/residents/password/reset", json={"token": token, "password": "short"}).status_code == 422
    with closing(main.connect_database()) as connection:
        connection.execute(
            "UPDATE users SET password_reset_expires = '2000-01-01T00:00:00+00:00' WHERE email = ?",
            ("recovery-expire@example.com",),
        )
        connection.commit()
    assert client.post("/api/residents/password/reset", json={"token": token, "password": NEW_PASSWORD}).status_code == 410


def test_reset_request_ignores_caller_supplied_role(client: TestClient):
    _signup(client, "recovery-role@example.com")
    response = client.post(
        "/api/residents/password/request",
        json={"email": "recovery-role@example.com", "role": "super_admin"},
    )
    assert response.status_code == 200, response.text
    assert _row_by_email("recovery-role@example.com")["role"] == "resident"


def test_account_profile_round_trip(client: TestClient):
    _signup(client, "recovery-profile@example.com")
    other = _signup(client, "recovery-other@example.com")
    assert other  # second account exists for the clash check
    with TestClient(main.app) as session:
        assert session.post("/api/session", json={"username": "recovery-profile@example.com", "password": PASSWORD}).status_code == 200
        before = session.get("/api/account")
        assert before.status_code == 200
        assert before.json()["email"] == "recovery-profile@example.com"
        saved = session.patch("/api/account", json={"display_name": "Lane Watcher", "email": "recovery-profile@example.com"})
        assert saved.status_code == 200, saved.text
        assert saved.json()["display_name"] == "Lane Watcher"
        assert saved.json()["verification_required"] is False
        assert _row_by_email("recovery-profile@example.com")["display_name"] == "Lane Watcher"
        clash = session.patch("/api/account", json={"email": "recovery-other@example.com"})
        assert clash.status_code == 409
        changed = session.patch("/api/account", json={"email": "recovery-moved@example.com"})
        assert changed.status_code == 200, changed.text
        assert changed.json()["verification_required"] is True
        moved = _row_by_email("recovery-moved@example.com")
        assert moved is not None and moved["role"] == "resident" and moved["email_verified"] == 0
        # Usernames stay independent of email: an email change never rewrites it.
        assert moved["username"] == "recovery_profile"
        assert session.patch("/api/account", json={}).status_code == 422


def test_legacy_resident_chooses_username_via_account(client: TestClient):
    _signup(client, "recovery-legacy@example.com")
    with closing(main.connect_database()) as connection:
        connection.execute(
            "UPDATE users SET username = 'recovery-legacy@example.com' WHERE email = ?",
            ("recovery-legacy@example.com",),
        )
        connection.commit()
    with TestClient(main.app) as session:
        assert session.post("/api/session", json={"username": "recovery-legacy@example.com", "password": PASSWORD}).status_code == 200
        assert session.get("/api/account").json()["needs_username"] is True
        assert session.patch("/api/account", json={"username": "ab"}).status_code == 422
        chosen = session.patch("/api/account", json={"username": "legacy.hero_1"})
        assert chosen.status_code == 200, chosen.text
        assert chosen.json()["username"] == "legacy.hero_1"
        assert session.get("/api/account").json()["needs_username"] is False
        # Email sign-in still works and the username survives an email change.
        assert _row_by_email("recovery-legacy@example.com")["username"] == "legacy.hero_1"


def test_account_requires_session(client: TestClient):
    assert client.get("/api/account").status_code in (401, 503)
    assert client.patch("/api/account", json={"display_name": "Nobody"}).status_code in (401, 503)
