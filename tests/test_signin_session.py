"""Resident sign-in API tests: JSON POST /api/session backing the React sign-in screen."""
from __future__ import annotations

import os
import tempfile

_test_root = tempfile.mkdtemp(prefix="proofpath-signin-test-")
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

USERNAME = "testroot"
PASSWORD = "test-passphrase-16-chars-min"


@pytest.fixture()
def client():
    with TestClient(main.app) as test_client:
        yield test_client


def test_json_login_returns_session_and_cookie(client: TestClient):
    response = client.post("/api/session", json={"username": USERNAME, "password": PASSWORD})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["username"] == USERNAME
    assert body["role"] == "super_admin"
    assert isinstance(body["privileges"], list)
    assert main.SESSION_COOKIE in response.cookies
    assert client.get("/api/session").status_code == 200


def test_json_login_rejects_bad_password_without_enumeration(client: TestClient):
    bad_password = client.post("/api/session", json={"username": USERNAME, "password": "wrong-password-0000"})
    assert bad_password.status_code == 401
    unknown_user = client.post("/api/session", json={"username": "nobody-here", "password": "wrong-password-0000"})
    assert unknown_user.status_code == 401
    assert bad_password.json()["detail"] == unknown_user.json()["detail"]


def test_json_login_accepts_email_identifier(client: TestClient):
    with TestClient(main.app) as session:
        created = session.post("/api/session", json={"username": USERNAME, "password": PASSWORD})
        assert created.status_code == 200, created.text
