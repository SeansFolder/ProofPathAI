"""Auth gating for report entry points, username rules, and ownership.

Covers the authenticated-creation contract: every upload / AI / report
endpoint rejects signed-out callers before doing work, usernames stay
case-insensitively unique (including a same-moment duplicate race), email
and username both sign in, and created reports belong to the caller.
"""
from __future__ import annotations

import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing

_test_root = tempfile.mkdtemp(prefix="proofpath-authz-test-")
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


def _signup(client: TestClient, email: str, username: str, password: str = "resident-passphrase-16"):
    return client.post("/api/residents", json={"email": email, "username": username, "password": password})


def _json_login(client: TestClient, identifier: str, password: str = "resident-passphrase-16"):
    return client.post("/api/session", json={"username": identifier, "password": password})


def test_unauthenticated_report_endpoints_reject_before_work(client: TestClient):
    # Report creation with evidence must not accept anonymous uploads.
    response = client.post(
        "/api/reports",
        data={"title": "Anon", "category": "Other", "description": "Anonymous upload attempt here."},
        files={"evidence": ("anon.png", PNG_BYTES, "image/png")},
    )
    assert response.status_code == 401, response.text
    # Row lookup happens after auth: even a bogus id answers 401, not 404.
    response = client.patch("/api/reports/does-not-exist", json={"title": "x"})
    assert response.status_code == 401, response.text
    # AI processing is gated the same way (no free unauthenticated analysis).
    response = client.post("/api/ai/segment", files={"evidence": ("anon.png", PNG_BYTES, "image/png")})
    assert response.status_code == 401, response.text
    response = client.post("/api/ai/assist", json={"observation": "A photo of a cracked road surface here."})
    assert response.status_code == 401, response.text


def test_username_and_email_duplicates_are_case_insensitive(client: TestClient):
    first = _signup(client, "CaseOne@example.com", "CaseUser")
    assert first.status_code == 201, first.text
    # Same username in different case must conflict, not create a sibling.
    assert _signup(client, "other@example.com", "caseuser").status_code == 409
    assert _signup(client, "other@example.com", "CASEUSER").status_code == 409
    # Same email in different case must conflict as well.
    assert _signup(client, "caseone@EXAMPLE.com", "anotheruser").status_code == 409


def test_simultaneous_duplicate_signup_yields_one_account(client: TestClient):
    # Same username claimed at the same moment from two sessions: the UNIQUE
    # constraint lets exactly one through and the loser gets a clean 409.
    def attempt(suffix: str):
        with TestClient(main.app) as thread_client:
            return thread_client.post(
                "/api/residents",
                json={
                    "email": f"race{suffix}@example.com",
                    "username": "raceuser",
                    "password": "resident-passphrase-16",
                },
            ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = sorted(pool.map(attempt, ("a", "b")))
    assert codes == [201, 409], codes
    with closing(main.connect_database()) as connection:
        count = connection.execute("SELECT COUNT(*) FROM users WHERE username = 'raceuser'").fetchone()[0]
    assert count == 1


def test_signin_accepts_email_or_username_case_insensitively(client: TestClient):
    assert _signup(client, "SigninCase@example.com", "SigninUser").status_code == 201
    for identifier in ("SigninUser", "signinuser", "SIGNINUSER", "SigninCase@example.com", "signincase@EXAMPLE.com"):
        with TestClient(main.app) as fresh_client:
            response = _json_login(fresh_client, identifier)
            assert response.status_code == 200, (identifier, response.text)


def test_legacy_resident_without_username_can_choose_one(client: TestClient):
    # A pre-username account whose username is the old email address is
    # flagged, keeps signing in with the email, and can claim a username once.
    salt, password_hash = main.hash_password("resident-passphrase-16")
    with closing(main.connect_database()) as connection:
        connection.execute(
            "INSERT INTO users (username, email, password_hash, salt, role, privileges, active, created_at)"
            " VALUES ('legacy@example.com', 'legacy@example.com', ?, ?, 'resident', '[]', 1, datetime('now'))",
            (password_hash, salt),
        )
        connection.commit()
    assert _json_login(client, "legacy@example.com").status_code == 200
    account = client.get("/api/account").json()
    assert account["needs_username"] is True
    assert client.patch("/api/account", json={"display_name": "Legacy"}).status_code == 200
    assert client.patch("/api/account", json={"username": "legacyuser"}).status_code == 200
    assert _json_login(client, "legacyuser").status_code == 200
    # Usernames stay unique across accounts.
    assert _signup(client, "someone@example.com", "legacyuser").status_code == 409


def test_created_report_belongs_to_authenticated_owner(client: TestClient):
    assert _signup(client, "owner@example.com", "owneruser").status_code == 201
    login = _json_login(client, "owneruser")
    assert login.status_code == 200, login.text
    owner_id = login.json()["id"]
    created = client.post(
        "/api/reports",
        data={
            "title": "Owned report",
            "category": "Other",
            "description": "Ownership must follow the authenticated caller.",
        },
        files={"evidence": ("owned.png", PNG_BYTES, "image/png")},
    )
    assert created.status_code == 201, created.text
    report_id = created.json()["id"]
    with closing(main.connect_database()) as connection:
        row = connection.execute("SELECT owner_id, role FROM users JOIN reports ON reports.owner_id = users.id WHERE reports.id = ?", (report_id,)).fetchone()
    assert row is not None
    assert row["owner_id"] == owner_id
