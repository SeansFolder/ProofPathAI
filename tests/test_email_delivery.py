"""Configurable email delivery: provider send with outbox-preview fallback."""
from __future__ import annotations

import os
import smtplib
import tempfile
import urllib.request
from contextlib import closing

_test_root = tempfile.mkdtemp(prefix="proofpath-email-test-")
os.environ["PROOFPATH_DATA_DIR"] = os.path.join(_test_root, "data")
os.environ["PROOFPATH_SUPERADMIN_USERNAME"] = "testroot"
os.environ["PROOFPATH_SUPERADMIN_PASSWORD"] = "test-passphrase-16-chars-min"
os.environ["PROOFPATH_SESSION_SECRET"] = "test-secret-" + "x" * 40
for _var in (
    "PROOFPATH_MODAL_SAM_ENDPOINT",
    "PROOFPATH_SPARK_ENDPOINT",
    "PROOFPATH_IMAGE_ENDPOINT",
    "PROOFPATH_EMAIL_API_URL",
    "PROOFPATH_EMAIL_API_KEY",
    "PROOFPATH_SMTP_HOST",
    "PROOFPATH_SMTP_PORT",
    "PROOFPATH_SMTP_USER",
    "PROOFPATH_SMTP_PASSWORD",
    "PROOFPATH_SMTP_FROM",
    "PROOFPATH_PUBLIC_BASE_URL",
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


def _outbox_count() -> int:
    return len(list(main.EMAIL_OUTBOX_DIR.glob("*.json")))


class _FakeSMTP:
    instances: list = []

    def __init__(self, host, port, timeout=None):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.tls_started = False
        self.login_args = None
        self.sent = []
        _FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def starttls(self):
        self.tls_started = True

    def login(self, username, password):
        self.login_args = (username, password)

    def send_message(self, message):
        self.sent.append(message)


@pytest.fixture(autouse=True)
def _clean_email_env(monkeypatch):
    for var in (
        "PROOFPATH_EMAIL_API_URL",
        "PROOFPATH_EMAIL_API_KEY",
        "PROOFPATH_SMTP_HOST",
        "PROOFPATH_SMTP_PORT",
        "PROOFPATH_SMTP_USER",
        "PROOFPATH_SMTP_PASSWORD",
        "PROOFPATH_SMTP_FROM",
        "PROOFPATH_PUBLIC_BASE_URL",
    ):
        monkeypatch.delenv(var, raising=False)
    _FakeSMTP.instances = []
    yield


def test_unconfigured_writes_preview_and_returns_false():
    before = _outbox_count()
    assert main._deliver_email("a@example.org", "Subject", "Body /?verify=abc") is False
    assert _outbox_count() == before + 1


def test_smtp_send_returns_true_without_preview(monkeypatch):
    monkeypatch.setenv("PROOFPATH_SMTP_HOST", "mail.example.org")
    monkeypatch.setenv("PROOFPATH_SMTP_USER", "sender@example.org")
    monkeypatch.setenv("PROOFPATH_SMTP_FROM", "ProofPath <sender@example.org>")
    monkeypatch.setattr(smtplib, "SMTP", _FakeSMTP)
    before = _outbox_count()
    assert main._deliver_email("to@example.org", "Hello", "Body text") is True
    assert _outbox_count() == before
    assert len(_FakeSMTP.instances) == 1
    client = _FakeSMTP.instances[0]
    assert client.tls_started is True
    assert client.login_args == ("sender@example.org", "")
    assert client.sent[0]["To"] == "to@example.org"
    assert client.sent[0]["Subject"] == "Hello"


def test_smtp_failure_falls_back_to_preview(monkeypatch):
    monkeypatch.setenv("PROOFPATH_SMTP_HOST", "mail.example.org")

    class _FailingSMTP(_FakeSMTP):
        def send_message(self, message):
            raise smtplib.SMTPException("connection lost")

    monkeypatch.setattr(smtplib, "SMTP", _FailingSMTP)
    before = _outbox_count()
    assert main._deliver_email("to@example.org", "Hello", "Body /?reset=abc") is False
    assert _outbox_count() == before + 1


def test_api_provider_send_returns_true_without_preview(monkeypatch):
    monkeypatch.setenv("PROOFPATH_EMAIL_API_URL", "https://mail.example.org/send")
    monkeypatch.setenv("PROOFPATH_EMAIL_API_KEY", "secret-key")
    seen = {}

    class _FakeResponse:
        status = 202

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def _fake_urlopen(request, timeout=None):
        seen["url"] = request.full_url
        seen["auth"] = request.get_header("Authorization")
        return _FakeResponse()

    monkeypatch.setattr(urllib.request, "urlopen", _fake_urlopen)
    before = _outbox_count()
    assert main._deliver_email("to@example.org", "Hello", "Body text") is True
    assert _outbox_count() == before
    assert seen["url"] == "https://mail.example.org/send"
    assert seen["auth"] == "Bearer secret-key"


def test_signup_dev_preview_empty_when_provider_sends(client: TestClient, monkeypatch):
    monkeypatch.setenv("PROOFPATH_SMTP_HOST", "mail.example.org")
    monkeypatch.setattr(smtplib, "SMTP", _FakeSMTP)
    response = client.post(
        "/api/residents",
        json={"email": "smtp-resident@example.org", "username": "smtp_resident", "password": PASSWORD},
    )
    assert response.status_code == 201, response.text
    assert response.json()["dev_preview_url"] == ""
    assert len(_FakeSMTP.instances) == 1


def test_public_link_prefixes_base_url(monkeypatch):
    assert main._public_link("/?verify=abc") == "/?verify=abc"
    monkeypatch.setenv("PROOFPATH_PUBLIC_BASE_URL", "https://app.example.org")
    assert main._public_link("/?verify=abc") == "https://app.example.org/?verify=abc"
