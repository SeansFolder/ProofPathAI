"""Resident role: seeding safety plus ownership and staff-boundary enforcement."""
from __future__ import annotations

import os
import sqlite3
import tempfile
from contextlib import closing

_test_root = tempfile.mkdtemp(prefix="proofpath-resident-test-")
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


def _login(client: TestClient, username: str, password: str) -> None:
    response = client.post(
        "/login", data={"username": username, "password": password}, follow_redirects=False
    )
    assert response.status_code == 303, response.text


def _make_resident(username: str, password: str = "resident-passphrase-16") -> None:
    salt, password_hash = main.hash_password(password)
    with closing(main.connect_database()) as connection:
        try:
            connection.execute(
                "INSERT INTO users (username, password_hash, salt, role, privileges, active, created_at)"
                " VALUES (?, ?, ?, 'resident', '[]', 1, datetime('now'))",
                (username, password_hash, salt),
            )
            connection.commit()
        except sqlite3.IntegrityError:
            pass


def _make_report(client: TestClient, title: str) -> dict:
    response = client.post(
        "/api/reports",
        data={"title": title, "category": "Drainage and flooding",
              "description": "A resident verification report over ten characters.",
              "location": "Test Street 1"},
        files={"evidence": ("check.png", PNG_BYTES, "image/png")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_seed_disabled_by_default_and_repeat_safe(monkeypatch):
    monkeypatch.delenv("PROOFPATH_SEED_DEMO_ACCOUNTS", raising=False)
    assert main.seed_demo_accounts() == []

    monkeypatch.setenv("PROOFPATH_SEED_DEMO_ACCOUNTS", "1")
    monkeypatch.setenv("PROOFPATH_ADMIN_USERNAME", "seed.admin")
    monkeypatch.setenv("PROOFPATH_ADMIN_PASSWORD", "seed-admin-passphrase-16")
    monkeypatch.setenv("PROOFPATH_RESIDENT_USERNAME", "seed.resident")
    monkeypatch.setenv("PROOFPATH_RESIDENT_PASSWORD", "seed-resident-passphrase-16")
    first = main.seed_demo_accounts()
    assert "created:seed.admin:admin" in first
    assert "created:seed.resident:resident" in first
    with closing(main.connect_database()) as connection:
        admin_id = connection.execute(
            "SELECT id FROM users WHERE username = 'seed.admin'").fetchone()["id"]
        resident_id = connection.execute(
            "SELECT id FROM users WHERE username = 'seed.resident'").fetchone()["id"]
    second = main.seed_demo_accounts()
    assert second == ["exists-preserved:seed.admin", "exists-preserved:seed.resident"]
    with closing(main.connect_database()) as connection:
        assert connection.execute(
            "SELECT id FROM users WHERE username = 'seed.admin'").fetchone()["id"] == admin_id
        assert connection.execute(
            "SELECT id FROM users WHERE username = 'seed.resident'").fetchone()["id"] == resident_id
        assert connection.execute(
            "SELECT role FROM users WHERE username = 'seed.resident'").fetchone()["role"] == "resident"


def test_seed_never_overwrites_and_reports_conflicts(monkeypatch):
    _make_resident("clash.resident", "original-passphrase-16")
    monkeypatch.setenv("PROOFPATH_SEED_DEMO_ACCOUNTS", "yes")
    monkeypatch.setenv("PROOFPATH_RESIDENT_USERNAME", "clash.resident")
    monkeypatch.setenv("PROOFPATH_RESIDENT_PASSWORD", "different-passphrase-16")
    monkeypatch.delenv("PROOFPATH_ADMIN_USERNAME", raising=False)
    assert main.seed_demo_accounts() == ["exists-preserved:clash.resident"]
    with TestClient(main.app) as client:
        _login(client, "clash.resident", "original-passphrase-16")

    monkeypatch.setenv("PROOFPATH_ADMIN_USERNAME", "testroot")
    monkeypatch.setenv("PROOFPATH_ADMIN_PASSWORD", "another-passphrase-16xx")
    monkeypatch.setenv("PROOFPATH_RESIDENT_USERNAME", "testroot")
    monkeypatch.setenv("PROOFPATH_RESIDENT_PASSWORD", "another-passphrase-16xx")
    assert main.seed_demo_accounts() == [
        "skipped:PROOFPATH_ADMIN_USERNAME", "skipped:PROOFPATH_RESIDENT_USERNAME"]


def test_resident_own_reports_only(client: TestClient):
    _make_resident("res.one")
    _make_resident("res.two")
    with TestClient(main.app) as one, TestClient(main.app) as two:
        _login(one, "res.one", "resident-passphrase-16")
        _login(two, "res.two", "resident-passphrase-16")
        own = _make_report(one, "Res one pothole")
        assert own["owner_id"] is not None
        assert [r["id"] for r in one.get("/api/reports").json()] == [own["id"]]
        assert two.get("/api/reports").json() == []
        for method, url, kwargs in [
            ("PATCH", f"/api/reports/{own['id']}",
             {"json": {"title": "Nope", "category": "Drainage and flooding",
                       "description": " long enough description here.", "location": None}}),
            ("PATCH", f"/api/reports/{own['id']}/status", {"json": {"status": "Submitted"}}),
            ("DELETE", f"/api/reports/{own['id']}", {}),
            ("GET", f"/api/evidence/{own['evidence_name']}", {}),
        ]:
            response = two.request(method, url, **kwargs)
            assert response.status_code == 404, (method, url, response.status_code)
        assert two.get(f"/api/reports/{own['id']}").status_code in (404, 405)


def test_resident_reporting_flow_and_staff_visibility(client: TestClient):
    _make_resident("res.flow")
    with TestClient(main.app) as resident:
        _login(resident, "res.flow", "resident-passphrase-16")
        created = _make_report(resident, "Res flow drain")
        rid = created["id"]
        edited = resident.patch(
            f"/api/reports/{rid}",
            json={"title": "Res flow drain edited", "category": "Drainage and flooding",
                  "description": "Edited description well over ten characters.", "location": "Lane 2"})
        assert edited.status_code == 200 and edited.json()["title"].endswith("edited")
        moved = resident.patch(f"/api/reports/{rid}/status", json={"status": "Submitted"})
        assert moved.status_code == 200 and moved.json()["status"] == "Submitted"
        assert resident.get(f"/api/evidence/{created['evidence_name']}").status_code == 200
        for method, url, kwargs in [
            ("GET", "/api/admins", {}),
            ("POST", "/api/admins", {"json": {"username": "z", "password": "x" * 16, "privileges": []}}),
            ("GET", "/api/ai/jobs", {}),
            ("POST", "/api/ai/jobs", {"json": {"evidence_names": ["12345678-1234-1234-1234-1234567890ab.png"]}}),
        ]:
            response = resident.request(method, url, **kwargs)
            assert response.status_code == 403, (method, url, response.status_code)
    _login(client, "testroot", "test-passphrase-16-chars-min")
    staff_list = client.get("/api/reports").json()
    assert any(r["id"] == rid for r in staff_list)
    assert client.delete(f"/api/reports/{rid}").status_code == 204
