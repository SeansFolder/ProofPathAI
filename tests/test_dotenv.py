"""Focused test: .env file values load without overriding real environment."""
from __future__ import annotations

import os
from pathlib import Path

import main


def test_load_dotenv_sets_missing_vars_only(tmp_path: Path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "PROOFPATH_SESSION_SECRET=dotenv-secret-value-1234567890abcdef\n"
        "PROOFPATH_SUPERADMIN_USERNAME=dotenvadmin\n"
        "# a comment line\n"
        "\n"
        'PROOFPATH_SUPERADMIN_PASSWORD="quoted-passphrase-16-min"\n',
        encoding="utf-8",
    )
    monkeypatch.delenv("PROOFPATH_SESSION_SECRET", raising=False)
    monkeypatch.delenv("PROOFPATH_SUPERADMIN_USERNAME", raising=False)
    monkeypatch.delenv("PROOFPATH_SUPERADMIN_PASSWORD", raising=False)
    monkeypatch.setenv("PROOFPATH_SUPERADMIN_USERNAME", "kept-admin")

    main.load_dotenv(env_file)

    assert os.environ["PROOFPATH_SESSION_SECRET"] == "dotenv-secret-value-1234567890abcdef"
    assert os.environ["PROOFPATH_SUPERADMIN_USERNAME"] == "kept-admin"
    assert os.environ["PROOFPATH_SUPERADMIN_PASSWORD"] == "quoted-passphrase-16-min"
