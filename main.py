from __future__ import annotations

import re
import secrets
import sqlite3
import uuid
import os
import hmac
import hashlib
import base64
import json
import time
import binascii
import logging
from contextlib import asynccontextmanager, closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile, Request, Response, Depends
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field

import ai_service


def load_dotenv(path: Path | str | None = None) -> None:
    """Load KEY=VALUE lines from the project .env file without overriding real env vars."""
    env_path = Path(path) if path is not None else Path(__file__).resolve().parent / ".env"
    try:
        content = env_path.read_text(encoding="utf-8")
    except OSError:
        return
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        key = key.strip()
        if not key or key in os.environ:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        os.environ[key] = value


load_dotenv()

logging.basicConfig(level=os.environ.get("PROOFPATH_LOG_LEVEL", "INFO"))
logger = logging.getLogger("proofpath")

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("PROOFPATH_DATA_DIR", str(BASE_DIR / "data"))).resolve()
UPLOAD_DIR = DATA_DIR / "uploads"
DATABASE_PATH = DATA_DIR / "proofpath.db"
FRONTEND_DIR = BASE_DIR / "frontend"
FRONTEND_DIST = FRONTEND_DIR / "dist"
LOGIN_STYLESHEET = FRONTEND_DIR / "src" / "index.css"
BRAND_MARK_FILE = FRONTEND_DIR / "src" / "assets" / "logo.png"
SIGNIN_SCRIPT_FILE = FRONTEND_DIR / "src" / "signin.js"
SUPERADMIN_USERNAME = os.environ.get("PROOFPATH_SUPERADMIN_USERNAME", "superadmin").strip().lower()
SUPERADMIN_PASSWORD = os.environ.get("PROOFPATH_SUPERADMIN_PASSWORD", "")
SESSION_SECRET = os.environ.get("PROOFPATH_SESSION_SECRET", "")
SESSION_COOKIE = "proofpath_session"
SESSION_SECONDS = 12 * 60 * 60
LOGIN_FAILURES: dict[str, list[float]] = {}
PERMISSIONS = {"reports_view", "reports_create", "reports_edit", "reports_status", "reports_delete"}
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
ALLOWED_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
}
AI_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
REPORT_STATUSES = ("Draft", "Submitted", "Resolved")

DATA_DIR.mkdir(exist_ok=True)
UPLOAD_DIR.mkdir(exist_ok=True)


def initialize_database() -> None:
    with closing(connect_database()) as connection:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'resident')),
                privileges TEXT NOT NULL DEFAULT '[]',
                active INTEGER NOT NULL DEFAULT 1,
                session_version INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )"""
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS reports (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                category TEXT NOT NULL,
                description TEXT NOT NULL,
                location TEXT,
                status TEXT NOT NULL,
                evidence_name TEXT NOT NULL,
                evidence_type TEXT NOT NULL,
                created_at TEXT NOT NULL
            )"""
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS ai_jobs (
                id TEXT PRIMARY KEY,
                job_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'queued',
                input_json TEXT NOT NULL DEFAULT '[]',
                result_json TEXT NOT NULL DEFAULT '{}',
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"""
        )
        connection.execute("CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC)")
        user_columns = [row[1] for row in connection.execute("PRAGMA table_info(users)").fetchall()]
        if "email" not in user_columns:
            connection.execute("ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''")
        connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email <> ''")
        if "email_verified" not in user_columns:
            connection.execute("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0")
        if "verification_token_hash" not in user_columns:
            connection.execute("ALTER TABLE users ADD COLUMN verification_token_hash TEXT NOT NULL DEFAULT ''")
        if "verification_expires" not in user_columns:
            connection.execute("ALTER TABLE users ADD COLUMN verification_expires TEXT NOT NULL DEFAULT ''")
        if "display_name" not in user_columns:
            connection.execute("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''")
        if "password_reset_token_hash" not in user_columns:
            connection.execute("ALTER TABLE users ADD COLUMN password_reset_token_hash TEXT NOT NULL DEFAULT ''")
        if "password_reset_expires" not in user_columns:
            connection.execute("ALTER TABLE users ADD COLUMN password_reset_expires TEXT NOT NULL DEFAULT ''")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_jobs(status)")
        _migrate_user_roles(connection)
        _migrate_report_ownership(connection)
        _migrate_report_details(connection)
        schema_version = connection.execute("PRAGMA user_version").fetchone()[0]
        if schema_version < 1:
            connection.execute(
                "UPDATE reports SET status = 'Draft' WHERE status = 'Submitted'"
            )
            connection.execute("PRAGMA user_version = 1")
        valid_superadmin_name = bool(re.fullmatch(r"[a-z0-9][a-z0-9._-]{2,31}", SUPERADMIN_USERNAME))
        if valid_superadmin_name and len(SUPERADMIN_PASSWORD) >= 16 and len(SESSION_SECRET) >= 32:
            exists = connection.execute("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1").fetchone()
            if exists is None:
                salt, password_hash = hash_password(SUPERADMIN_PASSWORD)
                connection.execute(
                    "INSERT INTO users (username, password_hash, salt, role, privileges, active, created_at) VALUES (?, ?, ?, 'super_admin', ?, 1, ?)",
                    (SUPERADMIN_USERNAME, password_hash, salt, json.dumps(sorted(PERMISSIONS)), datetime.now(timezone.utc).isoformat()),
                )
        connection.commit()
    seed_demo_accounts()


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_database()
    yield


app = FastAPI(title="ProofPath AI", version="0.2.0", lifespan=lifespan)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob: data:; "
        "style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; "
        "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    )
    if os.environ.get("PROOFPATH_COOKIE_SECURE", "0") == "1":
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return response


EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(value: str | None) -> str:
    return (value or "").strip().lower()


def validated_email(email: str) -> str:
    if email and not EMAIL_PATTERN.match(email):
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    return email


class NewAdmin(BaseModel):
    username: str
    password: str
    privileges: list[str]
    email: str = ""


class AdminUpdate(BaseModel):
    privileges: list[str] | None = None
    active: bool | None = None
    password: str | None = None
    email: str | None = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


RESIDENT_USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.]{2,29}$")
RESIDENT_USERNAME_HINT = "Usernames must be 3–30 characters using letters, numbers, underscores, or periods, starting with a letter or number."


def validated_resident_username(value: str | None) -> str:
    username = (value or "").strip().lower()
    if not username:
        raise HTTPException(status_code=422, detail="Enter a username.")
    if not RESIDENT_USERNAME_PATTERN.match(username):
        raise HTTPException(status_code=422, detail=RESIDENT_USERNAME_HINT)
    return username


class ResidentSignup(BaseModel):
    email: str
    password: str
    username: str = ""


class VerifyRequest(BaseModel):
    token: str = ""


class ResendRequest(BaseModel):
    email: str = ""


class PasswordResetRequest(BaseModel):
    email: str = ""


class PasswordResetConfirm(BaseModel):
    token: str = ""
    password: str = ""


class AccountProfileUpdate(BaseModel):
    display_name: str | None = None
    email: str | None = None
    username: str | None = None


class LoginRequest(BaseModel):
    username: str = ""
    password: str = ""


class Observation(BaseModel):
    id: str = Field(max_length=16)
    title: str = Field(max_length=120)
    body: str = Field(max_length=2000)
    selected: bool = False


class Report(BaseModel):
    id: str
    title: str
    category: str
    description: str
    location: str | None
    status: Literal["Draft", "Submitted", "Resolved"]
    evidence_name: str
    evidence_type: str
    created_at: str
    owner_id: int | None = None
    public_code: str = ""
    observed_date: str | None = None
    resident_context: str | None = None
    observations: list[Observation] = []
    strip_metadata: bool = False
    blur_applied: bool = False


class StatusUpdate(BaseModel):
    status: Literal["Draft", "Submitted", "Resolved"]
    confirm_downgrade: bool = False


class ReportUpdate(BaseModel):
    title: str
    category: str
    description: str
    location: str | None = None
    observed_date: str | None = None
    resident_context: str | None = None
    observations: list[Observation] | None = None


class AssistRequest(BaseModel):
    observation: str = Field(min_length=10, max_length=2000)
    title: str | None = Field(default=None, max_length=120)
    category: str | None = Field(default=None, max_length=60)
    location: str | None = Field(default=None, max_length=180)


class GraphicRequest(BaseModel):
    prompt: str = Field(min_length=10, max_length=1000)
    style: str | None = Field(default=None, max_length=120)


class SegmentJobCreate(BaseModel):
    evidence_names: list[str] = Field(min_length=1, max_length=20)


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _session_token(user_id: int, session_version: int = 0) -> str:
    payload = _b64(json.dumps({"uid": user_id, "sv": session_version, "exp": int(time.time()) + SESSION_SECONDS}).encode())
    signature = _b64(hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{signature}"


def current_user(request: Request) -> dict:
    if len(SESSION_SECRET) < 32:
        logger.warning("session secret too short; set PROOFPATH_SESSION_SECRET to 32+ characters")
        raise HTTPException(status_code=503, detail="Sign-in is temporarily unavailable. Please try again later.")
    token = request.cookies.get(SESSION_COOKIE, "")
    try:
        payload, signature = token.split(".", 1)
        expected = _b64(hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).digest())
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if not hmac.compare_digest(signature, expected) or claims.get("exp", 0) < time.time():
            raise ValueError("invalid session")
    except (ValueError, TypeError, json.JSONDecodeError, binascii.Error):
        raise HTTPException(status_code=401, detail="Please sign in.")
    with closing(connect_database()) as connection:
        row = connection.execute("SELECT * FROM users WHERE id = ? AND active = 1", (claims.get("uid"),)).fetchone()
    if row is None or claims.get("sv", 0) != row["session_version"]:
        raise HTTPException(status_code=401, detail="Please sign in.")
    user = dict(row)
    user["privileges"] = json.loads(user["privileges"])
    request.state.user = user
    return user


def require_permission(permission: str):
    def dependency(user: dict = Depends(current_user)) -> dict:
        if user["role"] != "super_admin" and permission not in user["privileges"]:
            raise HTTPException(status_code=403, detail="Your account does not have this privilege.")
        return user
    return dependency


def require_super_admin(user: dict = Depends(current_user)) -> dict:
    if user["role"] != "super_admin":
        raise HTTPException(status_code=403, detail="Super admin access is required.")
    return user


def _check_report_permission(user: dict, permission: str) -> None:
    """Keep the existing staff privilege check; residents act only on their own
    reports, which the caller verifies per row."""
    if user["role"] == RESIDENT_ROLE:
        return
    if user["role"] != "super_admin" and permission not in user["privileges"]:
        raise HTTPException(status_code=403, detail="Your account does not have this privilege.")


def _require_staff(user: dict, permission: str) -> None:
    if user["role"] == RESIDENT_ROLE:
        raise HTTPException(status_code=403, detail="Available to staff accounts.")
    if user["role"] != "super_admin" and permission not in user["privileges"]:
        raise HTTPException(status_code=403, detail="Your account does not have this privilege.")


def _resident_blocked(row, user: dict) -> bool:
    return user["role"] == RESIDENT_ROLE and (row is None or row["owner_id"] != user["id"])


def hash_password(password: str) -> tuple[str, str]:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return _b64(salt), _b64(digest)


def verify_password(password: str, salt: str, password_hash: str) -> bool:
    salt_bytes = base64.urlsafe_b64decode(salt + "=" * (-len(salt) % 4))
    digest = hashlib.scrypt(password.encode(), salt=salt_bytes, n=2**14, r=8, p=1)
    return hmac.compare_digest(_b64(digest), password_hash)


def connect_database() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    return connection


def has_super_admin() -> bool:
    with closing(connect_database()) as connection:
        return connection.execute("SELECT 1 FROM users WHERE role = 'super_admin' LIMIT 1").fetchone() is not None


RESIDENT_ROLE = "resident"


def _migrate_user_roles(connection) -> None:
    row = connection.execute("SELECT sql FROM sqlite_master WHERE name = 'users'").fetchone()
    if row is None or RESIDENT_ROLE in (row["sql"] or ""):
        return
    connection.execute(
        """CREATE TABLE users_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'resident')),
            privileges TEXT NOT NULL DEFAULT '[]',
            active INTEGER NOT NULL DEFAULT 1,
            session_version INTEGER NOT NULL DEFAULT 0,
            email TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        )"""
    )
    connection.execute(
        """INSERT INTO users_new (id, username, password_hash, salt, role, privileges, active, session_version, email, created_at)
            SELECT id, username, password_hash, salt, role, privileges, active, session_version, email, created_at FROM users"""
    )
    connection.execute("DROP TABLE users")
    connection.execute("ALTER TABLE users_new RENAME TO users")
    connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email <> ''")


def _migrate_report_ownership(connection) -> None:
    columns = [row[1] for row in connection.execute("PRAGMA table_info(reports)").fetchall()]
    if "owner_id" not in columns:
        connection.execute("ALTER TABLE reports ADD COLUMN owner_id INTEGER")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_reports_owner ON reports(owner_id)")


def _migrate_report_details(connection) -> None:
    """Add admin-workflow report fields; backfill stable public codes."""
    columns = [row[1] for row in connection.execute("PRAGMA table_info(reports)").fetchall()]
    if "observed_date" not in columns:
        connection.execute("ALTER TABLE reports ADD COLUMN observed_date TEXT")
    if "resident_context" not in columns:
        connection.execute("ALTER TABLE reports ADD COLUMN resident_context TEXT")
    if "observations" not in columns:
        connection.execute("ALTER TABLE reports ADD COLUMN observations TEXT NOT NULL DEFAULT '[]'")
    if "public_code" not in columns:
        connection.execute("ALTER TABLE reports ADD COLUMN public_code TEXT")
    if "strip_metadata" not in columns:
        connection.execute("ALTER TABLE reports ADD COLUMN strip_metadata INTEGER NOT NULL DEFAULT 0")
    if "blur_applied" not in columns:
        connection.execute("ALTER TABLE reports ADD COLUMN blur_applied INTEGER NOT NULL DEFAULT 0")
    missing = connection.execute(
        "SELECT id FROM reports WHERE public_code IS NULL OR public_code = '' ORDER BY created_at ASC"
    ).fetchall()
    next_number = _max_public_code_number(connection) + 1
    for row in missing:
        connection.execute(
            "UPDATE reports SET public_code = ? WHERE id = ?",
            (f"PP-{next_number:04d}", row["id"]),
        )
        next_number += 1
    connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_public_code ON reports(public_code)")


def _max_public_code_number(connection) -> int:
    highest = 0
    for row in connection.execute("SELECT public_code FROM reports WHERE public_code LIKE 'PP-%'").fetchall():
        code = row["public_code"] or ""
        try:
            highest = max(highest, int(code[3:]))
        except ValueError:
            continue
    return highest


def _next_public_code(connection) -> str:
    return f"PP-{_max_public_code_number(connection) + 1:04d}"


def _seed_enabled() -> bool:
    return os.environ.get("PROOFPATH_SEED_DEMO_ACCOUNTS", "").strip().lower() in ("1", "true", "yes")


def seed_demo_accounts() -> list[str]:
    """Create missing demo Admin/Resident accounts when the dev flag is enabled.

    Never modifies an existing account, password, role, or permissions.
    Returns short human-readable outcomes (usernames only, no secrets).
    """
    outcomes: list[str] = []
    if not _seed_enabled():
        return outcomes
    superadmin_name = os.environ.get("PROOFPATH_SUPERADMIN_USERNAME", "superadmin").strip().lower()
    specs = [
        ("PROOFPATH_ADMIN_USERNAME", "PROOFPATH_ADMIN_PASSWORD", "admin", sorted(PERMISSIONS)),
        ("PROOFPATH_RESIDENT_USERNAME", "PROOFPATH_RESIDENT_PASSWORD", RESIDENT_ROLE, []),
    ]
    wanted: dict[str, tuple[str, str, list[str]]] = {}
    for user_var, password_var, role, privileges in specs:
        username = os.environ.get(user_var, "").strip().lower()
        password = os.environ.get(password_var, "")
        if not username:
            continue
        if (
            not re.fullmatch(r"[a-z0-9][a-z0-9._-]{2,31}", username)
            or len(password) < 16
            or username == superadmin_name
            or username in wanted
        ):
            logger.error("demo seed skipped for %s: invalid, weak, or conflicting credentials", user_var)
            outcomes.append(f"skipped:{user_var}")
            continue
        wanted[username] = (password, role, privileges)
    with closing(connect_database()) as connection:
        for username, (password, role, privileges) in wanted.items():
            existing = connection.execute(
                "SELECT id, role FROM users WHERE username = ?", (username,)
            ).fetchone()
            if existing is not None:
                logger.warning(
                    "demo seed skipped: username '%s' already exists as %s; preserved unchanged",
                    username, existing["role"],
                )
                outcomes.append(f"exists-preserved:{username}")
                continue
            salt, password_hash = hash_password(password)
            connection.execute(
                "INSERT INTO users (username, password_hash, salt, role, privileges, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
                (username, password_hash, salt, role, json.dumps(privileges), datetime.now(timezone.utc).isoformat()),
            )
            connection.commit()
            logger.info("demo seed created '%s' as %s", username, role)
            outcomes.append(f"created:{username}:{role}")
    return outcomes


initialize_database()


def row_to_report(row: sqlite3.Row) -> Report:
    data = dict(row)
    try:
        data["observations"] = json.loads(data.get("observations") or "[]")
    except (json.JSONDecodeError, TypeError):
        data["observations"] = []
    data["strip_metadata"] = bool(data.get("strip_metadata", 0))
    data["blur_applied"] = bool(data.get("blur_applied", 0))
    if not data.get("public_code"):
        data["public_code"] = ""
    return Report(**data)


OBSERVED_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _validated_observed_date(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if not OBSERVED_DATE_PATTERN.match(cleaned):
        raise HTTPException(status_code=422, detail="Observed date must use YYYY-MM-DD format.")
    try:
        datetime.strptime(cleaned, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=422, detail="Observed date must use YYYY-MM-DD format.")
    return cleaned


def _get_scoped_report(connection, report_id: str, user: dict):
    row = connection.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
    if _resident_blocked(row, user):
        raise HTTPException(status_code=404, detail="Report not found.")
    if row is None:
        raise HTTPException(status_code=404, detail="Report not found.")
    return row


def _valid_evidence_name(evidence_name: str) -> bool:
    return bool(re.fullmatch(r"[0-9a-f-]{36}\.(jpg|png|webp|mp4|mov)", evidence_name))


def _image_signature_ok(content_type: str, header: bytes) -> bool:
    if content_type == "image/jpeg":
        return header.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return header.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/webp":
        return header.startswith(b"RIFF") and header[8:12] == b"WEBP"
    return False


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request) -> Response:
    if SESSION_SECRET:
        try:
            current_user(request)
            return RedirectResponse("/", status_code=303)
        except HTTPException:
            pass
    error = request.query_params.get("error")
    error_message = "The email address, username, or password is incorrect." if error == "invalid" else "Too many sign-in attempts. Wait 15 minutes and try again." if error == "throttled" else "Sign-in is temporarily unavailable. Please try again later." if error == "unavailable" else ""
    error_notice = f'<p class="signin-alert" role="alert">{error_message}</p>' if error_message else ""
    return HTMLResponse(f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="theme-color" content="#f4f5ef"><title>Staff sign in · ProofPath</title><link rel="stylesheet" href="/static/styles.css"></head>
<body class="signin">
<header class="signin-header"><div class="signin-header-inner"><a href="/" aria-label="ProofPath home"><img class="brand-lockup" src="/static/logo.png" alt="ProofPath"></a><a class="signin-back" href="/">Back to home</a></div></header>
<main class="signin-main"><section class="signin-card" aria-labelledby="signin-heading">
<p class="signin-kicker">Staff access</p>
<h1 id="signin-heading">Welcome back</h1><p class="signin-sub">Sign in with the account provided by your team.</p>
{error_notice}
<form method="post" action="/login" class="signin-form">
<div class="signin-field"><label class="signin-label" for="signin-username">Username or email</label>
<input id="signin-username" name="username" type="text" autocomplete="username" required></div>
<div class="signin-field"><label class="signin-label" for="signin-password">Password</label>
<input id="signin-password" name="password" type="password" autocomplete="current-password" required></div>
<p class="signin-note">Need access or password reset? Contact a super admin.</p>
<button type="submit" class="signin-submit">Sign in</button>
</form>
</section></main>
</body></html>''')


@app.post("/login")
async def login(request: Request) -> Response:
    if len(SESSION_SECRET) < 32:
        logger.warning("login attempt with a short session secret; set PROOFPATH_SESSION_SECRET to 32+ characters")
        return RedirectResponse("/login?error=unavailable", status_code=303)
    client_ip = request.client.host if request.client else "unknown"
    recent_failures = [stamp for stamp in LOGIN_FAILURES.get(client_ip, []) if stamp > time.time() - 900]
    LOGIN_FAILURES[client_ip] = recent_failures
    if len(recent_failures) >= 10:
        return RedirectResponse("/login?error=throttled", status_code=303)
    form = await request.form()
    username = str(form.get("username", "")).strip().lower()
    password = str(form.get("password", ""))
    with closing(connect_database()) as connection:
        user = connection.execute(
            "SELECT * FROM users WHERE (username = ? OR (email <> '' AND email = ?)) AND active = 1",
            (username, username),
        ).fetchone()
    valid = user is not None and verify_password(password, user["salt"], user["password_hash"])
    if not valid:
        LOGIN_FAILURES.setdefault(client_ip, []).append(time.time())
        return RedirectResponse("/login?error=invalid", status_code=303)
    LOGIN_FAILURES.pop(client_ip, None)
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(SESSION_COOKIE, _session_token(user["id"], user["session_version"]), httponly=True, secure=os.environ.get("PROOFPATH_COOKIE_SECURE", "0") == "1", samesite="strict", max_age=SESSION_SECONDS, path="/")
    return response


@app.post("/logout")
def logout() -> Response:
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


def _session_payload(user: dict) -> dict:
    return {
        "id": user["id"],
        "username": user["username"],
        "role": user["role"],
        "privileges": sorted(PERMISSIONS) if user["role"] == "super_admin" else user["privileges"],
    }


def _issue_session_cookie(response: Response, user: dict) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        _session_token(user["id"], user["session_version"]),
        httponly=True,
        secure=os.environ.get("PROOFPATH_COOKIE_SECURE", "0") == "1",
        samesite="strict",
        max_age=SESSION_SECONDS,
        path="/",
    )


@app.post("/api/session")
def login_json(payload: LoginRequest, request: Request, response: Response) -> dict:
    """JSON sign-in for the resident React sign-in screen.

    Mirrors the form POST /login throttle and username-or-email lookup so the
    in-app screen can authenticate without a full-page redirect. Error copy is
    generic and never reveals whether an account exists.
    """
    if len(SESSION_SECRET) < 32:
        logger.warning("login attempt with a short session secret; set PROOFPATH_SESSION_SECRET to 32+ characters")
        raise HTTPException(status_code=503, detail="Sign-in is temporarily unavailable. Please try again later.")
    client_ip = request.client.host if request.client else "unknown"
    recent_failures = [stamp for stamp in LOGIN_FAILURES.get(client_ip, []) if stamp > time.time() - 900]
    LOGIN_FAILURES[client_ip] = recent_failures
    if len(recent_failures) >= 10:
        raise HTTPException(status_code=429, detail="Too many sign-in attempts. Wait 15 minutes and try again.")
    username = (payload.username or "").strip().lower()
    with closing(connect_database()) as connection:
        row = connection.execute(
            "SELECT * FROM users WHERE (username = ? OR (email <> '' AND email = ?)) AND active = 1",
            (username, username),
        ).fetchone()
        user = dict(row) if row is not None else None
    if user is not None:
        user["privileges"] = json.loads(user["privileges"])
    valid = user is not None and verify_password(payload.password or "", user["salt"], user["password_hash"])
    if not valid:
        LOGIN_FAILURES.setdefault(client_ip, []).append(time.time())
        raise HTTPException(status_code=401, detail="The email address, username, or password is incorrect.")
    LOGIN_FAILURES.pop(client_ip, None)
    _issue_session_cookie(response, user)
    return _session_payload(user)


@app.get("/api/session")
def get_session(user: dict = Depends(current_user)) -> dict:
    return {"id": user["id"], "username": user["username"], "role": user["role"], "privileges": sorted(PERMISSIONS) if user["role"] == "super_admin" else user["privileges"]}


@app.get("/api/admins")
def list_admins(_: dict = Depends(require_super_admin)) -> list[dict]:
    with closing(connect_database()) as connection:
        rows = connection.execute("SELECT id, username, email, privileges, active, created_at FROM users WHERE role = 'admin' ORDER BY username COLLATE NOCASE").fetchall()
    return [{**dict(row), "privileges": json.loads(row["privileges"]), "active": bool(row["active"])} for row in rows]


@app.post("/api/admins", status_code=201)
def create_admin(admin: NewAdmin, _: dict = Depends(require_super_admin)) -> dict:
    username = admin.username.strip().lower()
    privileges = sorted(set(admin.privileges))
    email = validated_email(normalize_email(admin.email))
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{2,31}", username):
        raise HTTPException(status_code=422, detail="Username must be 3–32 characters using letters, numbers, dots, underscores, or hyphens.")
    if len(admin.password) < 16:
        raise HTTPException(status_code=422, detail="Use a password with at least 16 characters.")
    if not set(privileges).issubset(PERMISSIONS):
        raise HTTPException(status_code=422, detail="One or more privileges are not recognized.")
    salt, password_hash = hash_password(admin.password)
    with closing(connect_database()) as connection:
        if email and connection.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone():
            raise HTTPException(status_code=409, detail="That email address is already in use.")
        try:
            cursor = connection.execute(
                "INSERT INTO users (username, email, password_hash, salt, role, privileges, active, created_at) VALUES (?, ?, ?, ?, 'admin', ?, 1, ?)",
                (username, email, password_hash, salt, json.dumps(privileges), datetime.now(timezone.utc).isoformat()),
            )
            connection.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="That username is already in use.")
    return {"id": cursor.lastrowid, "username": username, "email": email, "privileges": privileges, "active": True}


@app.patch("/api/admins/{admin_id}")
def update_admin(admin_id: int, update: AdminUpdate, _: dict = Depends(require_super_admin)) -> dict:
    values: list[object] = []
    assignments: list[str] = []
    if update.privileges is not None:
        privileges = sorted(set(update.privileges))
        if not set(privileges).issubset(PERMISSIONS):
            raise HTTPException(status_code=422, detail="One or more privileges are not recognized.")
        assignments.append("privileges = ?")
        values.append(json.dumps(privileges))
    if update.active is not None:
        assignments.append("active = ?")
        values.append(int(update.active))
    if update.password is not None:
        if len(update.password) < 16:
            raise HTTPException(status_code=422, detail="Use a password with at least 16 characters.")
        salt, password_hash = hash_password(update.password)
        assignments.extend(["salt = ?", "password_hash = ?", "session_version = session_version + 1"])
        values.extend([salt, password_hash])
    if update.email is not None:
        email = validated_email(normalize_email(update.email))
        assignments.append("email = ?")
        values.append(email)
    if not assignments:
        raise HTTPException(status_code=422, detail="Provide privileges, active, password, or email to update.")
    values.append(admin_id)
    with closing(connect_database()) as connection:
        if update.email:
            clash = connection.execute("SELECT id FROM users WHERE email = ? AND id != ?", (normalize_email(update.email), admin_id)).fetchone()
            if clash:
                raise HTTPException(status_code=409, detail="That email address is already in use.")
        try:
            cursor = connection.execute(f"UPDATE users SET {', '.join(assignments)} WHERE id = ? AND role = 'admin'", values)
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="That email address is already in use.")
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Admin account not found.")
        connection.commit()
        row = connection.execute("SELECT id, username, email, privileges, active, created_at FROM users WHERE id = ?", (admin_id,)).fetchone()
    return {**dict(row), "privileges": json.loads(row["privileges"]), "active": bool(row["active"])}


@app.post("/api/account/password")
def change_own_password(change: PasswordChange, response: Response, user: dict = Depends(current_user)) -> dict:
    if not verify_password(change.current_password, user["salt"], user["password_hash"]):
        raise HTTPException(status_code=401, detail="Current password is incorrect.")
    if len(change.new_password) < 16:
        raise HTTPException(status_code=422, detail="Use a password with at least 16 characters.")
    salt, password_hash = hash_password(change.new_password)
    with closing(connect_database()) as connection:
        connection.execute("UPDATE users SET salt = ?, password_hash = ?, session_version = session_version + 1 WHERE id = ?", (salt, password_hash, user["id"]))
        connection.commit()
        updated = connection.execute("SELECT session_version FROM users WHERE id = ?", (user["id"],)).fetchone()
    response.set_cookie(SESSION_COOKIE, _session_token(user["id"], updated["session_version"]), httponly=True, secure=os.environ.get("PROOFPATH_COOKIE_SECURE", "0") == "1", samesite="strict", max_age=SESSION_SECONDS, path="/")
    return {"status": "password_changed"}


VERIFICATION_SECONDS = 24 * 60 * 60
RESET_SECONDS = 60 * 60
EMAIL_OUTBOX_DIR = DATA_DIR / "email_outbox"


def _verification_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _new_verification() -> tuple[str, str, str]:
    """Return (token, token_hash, expiry_iso) for a single-use expiring link."""
    token = secrets.token_urlsafe(32)
    expiry = datetime.fromtimestamp(time.time() + VERIFICATION_SECONDS, tz=timezone.utc).isoformat()
    return token, _verification_hash(token), expiry


def _new_password_reset() -> tuple[str, str, str]:
    """Return (token, token_hash, expiry_iso) for a single-use expiring reset link."""
    token = secrets.token_urlsafe(32)
    expiry = datetime.fromtimestamp(time.time() + RESET_SECONDS, tz=timezone.utc).isoformat()
    return token, _verification_hash(token), expiry


def _write_email_preview(to: str, subject: str, body: str) -> None:
    """Local development delivery preview. Used when no email provider is
    configured, or when the configured provider fails, so confirmation links
    are written under data/email_outbox instead of being lost."""
    EMAIL_OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).isoformat().replace(":", "-")
    path = EMAIL_OUTBOX_DIR / f"{stamp}-{secrets.token_hex(4)}.json"
    path.write_text(json.dumps({"to": to, "subject": subject, "body": body}, indent=2), encoding="utf-8")
    logger.info("verification preview for %s written to %s", to, path)


def _email_provider_configured() -> bool:
    """True when an email provider is configured via environment."""
    return bool(
        os.environ.get("PROOFPATH_EMAIL_API_URL", "").strip()
        or os.environ.get("PROOFPATH_SMTP_HOST", "").strip()
    )


def _public_link(path: str) -> str:
    """Build the link sent to residents. Stays relative unless
    PROOFPATH_PUBLIC_BASE_URL is configured for real delivery."""
    base = os.environ.get("PROOFPATH_PUBLIC_BASE_URL", "").strip().rstrip("/")
    return f"{base}{path}" if base else path


def _smtp_login(client) -> None:
    username = os.environ.get("PROOFPATH_SMTP_USER", "").strip()
    password = os.environ.get("PROOFPATH_SMTP_PASSWORD", "")
    if username:
        client.login(username, password)


def _deliver_email(to: str, subject: str, body: str) -> bool:
    """Send an account email via the configured provider.

    Tries an HTTP API provider first (PROOFPATH_EMAIL_API_URL), then SMTP
    (PROOFPATH_SMTP_HOST). Returns True when a provider accepted the message.
    When nothing is configured, or when the provider fails, falls back to the
    local outbox preview so existing flows keep working.
    """
    api_url = os.environ.get("PROOFPATH_EMAIL_API_URL", "").strip()
    if api_url:
        try:
            import urllib.request

            payload = json.dumps({"to": to, "subject": subject, "body": body}).encode("utf-8")
            headers = {"Content-Type": "application/json"}
            api_key = os.environ.get("PROOFPATH_EMAIL_API_KEY", "").strip()
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            request = urllib.request.Request(api_url, data=payload, headers=headers, method="POST")
            with urllib.request.urlopen(request, timeout=10) as response:
                if 200 <= response.status < 300:
                    return True
                raise ValueError(f"email provider returned status {response.status}")
        except Exception:
            logger.warning("email API provider failed; writing local preview instead", exc_info=True)
    smtp_host = os.environ.get("PROOFPATH_SMTP_HOST", "").strip()
    if smtp_host:
        try:
            import smtplib
            from email.message import EmailMessage

            port = int(os.environ.get("PROOFPATH_SMTP_PORT", "587") or 587)
            message = EmailMessage()
            message["Subject"] = subject
            message["From"] = os.environ.get(
                "PROOFPATH_SMTP_FROM",
                os.environ.get("PROOFPATH_SMTP_USER", "no-reply@localhost"),
            )
            message["To"] = to
            message.set_content(body)
            if os.environ.get("PROOFPATH_SMTP_TLS", "1") == "1":
                with smtplib.SMTP(smtp_host, port, timeout=10) as client:
                    client.starttls()
                    _smtp_login(client)
                    client.send_message(message)
            else:
                with smtplib.SMTP(smtp_host, port, timeout=10) as client:
                    _smtp_login(client)
                    client.send_message(message)
            return True
        except Exception:
            logger.warning("SMTP send failed; writing local preview instead", exc_info=True)
    _write_email_preview(to, subject, body)
    return False


@app.post("/api/residents", status_code=201)
def signup_resident(signup: ResidentSignup) -> dict:
    """Public resident registration. Always creates role='resident'; any extra
    caller-supplied fields (including a role) are ignored by the model.
    The resident chooses a username distinct from their email; existing
    accounts are never modified here."""
    email = validated_email(normalize_email(signup.email))
    if not email:
        raise HTTPException(status_code=422, detail="Enter your email address.")
    username = validated_resident_username(signup.username)
    if len(signup.password) < 16:
        raise HTTPException(status_code=422, detail="Use a password with at least 16 characters.")
    token, token_hash, expiry = _new_verification()
    salt, password_hash = hash_password(signup.password)
    with closing(connect_database()) as connection:
        if connection.execute(
            "SELECT id FROM users WHERE username = ?",
            (username,),
        ).fetchone():
            raise HTTPException(status_code=409, detail="That username is already in use.")
        if connection.execute(
            "SELECT id FROM users WHERE email <> '' AND email = ?",
            (email,),
        ).fetchone():
            raise HTTPException(status_code=409, detail="An account with that email address already exists.")
        try:
            cursor = connection.execute(
                "INSERT INTO users (username, email, password_hash, salt, role, privileges, active,"
                " email_verified, verification_token_hash, verification_expires, created_at)"
                " VALUES (?, ?, ?, ?, 'resident', '[]', 1, 0, ?, ?, ?)",
                (username, email, password_hash, salt, token_hash, expiry, datetime.now(timezone.utc).isoformat()),
            )
            connection.commit()
        except sqlite3.IntegrityError:
            connection.rollback()
            if connection.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone():
                raise HTTPException(status_code=409, detail="That username is already in use.")
            raise HTTPException(status_code=409, detail="An account with that email address already exists.")
        user_id = cursor.lastrowid
    link = _public_link(f"/?verify={token}")
    delivered = _deliver_email(
        email,
        "Confirm your ProofPath email",
        f"Open this confirmation link to finish setting up your account: {link}\n"
        "The link expires in 24 hours and can be used once.",
    )
    # Without a configured provider the preview link is returned once with the
    # signup response for development. Resend stays generic (no link).
    return {"id": user_id, "username": username, "email": email, "verification_required": True, "dev_preview_url": "" if delivered else link}


@app.post("/api/residents/verify")
def verify_resident(payload: VerifyRequest) -> dict:
    token = (payload.token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="That confirmation link is not valid. Request a new one.")
    digest = _verification_hash(token)
    now = datetime.now(timezone.utc).isoformat()
    with closing(connect_database()) as connection:
        row = connection.execute(
            "SELECT * FROM users WHERE verification_token_hash = ? AND role = 'resident' AND active = 1",
            (digest,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=400, detail="That confirmation link is not valid. Request a new one.")
        if not row["verification_expires"] or row["verification_expires"] < now:
            raise HTTPException(status_code=410, detail="That confirmation link has expired. Request a new one.")
        connection.execute(
            "UPDATE users SET email_verified = 1, verification_token_hash = '', verification_expires = '' WHERE id = ?",
            (row["id"],),
        )
        connection.commit()
    return {"verified": True, "email": row["email"]}


@app.post("/api/residents/verify/resend")
def resend_verification(payload: ResendRequest) -> dict:
    """Generic response that never reveals whether an email has an account."""
    email = normalize_email(payload.email)
    if email and EMAIL_PATTERN.match(email):
        token, token_hash, expiry = _new_verification()
        with closing(connect_database()) as connection:
            row = connection.execute(
                "SELECT id, email_verified FROM users WHERE email = ? AND role = 'resident' AND active = 1",
                (email,),
            ).fetchone()
            if row is not None and not row["email_verified"]:
                connection.execute(
                    "UPDATE users SET verification_token_hash = ?, verification_expires = ? WHERE id = ?",
                    (token_hash, expiry, row["id"]),
                )
                connection.commit()
                _deliver_email(
                    email,
                    "Confirm your ProofPath email",
                    f"Open this confirmation link to finish setting up your account: {_public_link(f'/?verify={token}')}\n"
                    "The link expires in 24 hours and can be used once.",
                )
    return {"sent": True, "detail": "If that address has a pending confirmation, a new link is on its way."}


RESET_GENERIC_COPY = "If an account matches that address, a password reset link will arrive shortly."


@app.post("/api/residents/password/request")
def request_password_reset(payload: PasswordResetRequest) -> dict:
    """Public password-recovery request. Always acts on resident accounts only;
    any extra caller-supplied fields (including a role) are ignored by the
    model. The response never reveals whether an email has an account."""
    email = normalize_email(payload.email)
    if email and EMAIL_PATTERN.match(email):
        token, token_hash, expiry = _new_password_reset()
        with closing(connect_database()) as connection:
            row = connection.execute(
                "SELECT id FROM users WHERE email = ? AND role = 'resident' AND active = 1",
                (email,),
            ).fetchone()
            if row is not None:
                connection.execute(
                    "UPDATE users SET password_reset_token_hash = ?, password_reset_expires = ? WHERE id = ?",
                    (token_hash, expiry, row["id"]),
                )
                connection.commit()
                _deliver_email(
                    email,
                    "Reset your ProofPath password",
                    f"Open this link to choose a new password: {_public_link(f'/?reset={token}')}\n"
                    "The link expires in 1 hour and can be used once.",
                )
    return {"sent": True, "detail": RESET_GENERIC_COPY}


@app.post("/api/residents/password/reset")
def confirm_password_reset(payload: PasswordResetConfirm) -> dict:
    """Consume a single-use reset token and set a new resident password.
    Role is hardcoded to resident; the token lookup cannot touch staff rows.
    Consuming the token bumps session_version so other sessions sign out."""
    token = (payload.token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="That reset link is not valid. Request a new one.")
    if len(payload.password or "") < 16:
        raise HTTPException(status_code=422, detail="Use a password with at least 16 characters.")
    digest = _verification_hash(token)
    now = datetime.now(timezone.utc).isoformat()
    with closing(connect_database()) as connection:
        row = connection.execute(
            "SELECT * FROM users WHERE password_reset_token_hash = ? AND role = 'resident' AND active = 1",
            (digest,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=400, detail="That reset link is not valid. Request a new one.")
        if not row["password_reset_expires"] or row["password_reset_expires"] < now:
            raise HTTPException(status_code=410, detail="That reset link has expired. Request a new one.")
        salt, password_hash = hash_password(payload.password)
        connection.execute(
            "UPDATE users SET salt = ?, password_hash = ?, password_reset_token_hash = '',"
            " password_reset_expires = '', session_version = session_version + 1 WHERE id = ?",
            (salt, password_hash, row["id"]),
        )
        connection.commit()
    return {"reset": True}


@app.get("/api/account")
def get_own_account(user: dict = Depends(current_user)) -> dict:
    username = user["username"] or ""
    needs_username = user["role"] == "resident" and not RESIDENT_USERNAME_PATTERN.match(username or "")
    return {
        "username": username,
        "email": user["email"],
        "display_name": user.get("display_name") or "",
        "email_verified": bool(user.get("email_verified")),
        "role": user["role"],
        "needs_username": needs_username,
    }


@app.patch("/api/account")
def update_own_account(update: AccountProfileUpdate, user: dict = Depends(current_user)) -> dict:
    """Save the signed-in user's profile. Usernames stay independent of email:
    legacy resident rows (username is the old email) may choose a username
    once via this endpoint; existing valid usernames are never invented or
    overwritten by migration. Email changes mark the address unverified and
    issue a fresh confirmation preview. Staff usernames are unchanged here."""
    assignments: list[str] = []
    values: list[object] = []
    display_name = update.display_name.strip() if update.display_name is not None else None
    if display_name is not None:
        if len(display_name) > 60:
            raise HTTPException(status_code=422, detail="Display name must be 60 characters or fewer.")
        assignments.append("display_name = ?")
        values.append(display_name)
    email = normalize_email(update.email) if update.email is not None else None
    if email is not None:
        validated_email(email)
        if not email:
            raise HTTPException(status_code=422, detail="Enter your email address.")
        assignments.append("email = ?")
        values.append(email)
    username = None
    if update.username is not None:
        if user["role"] != "resident":
            raise HTTPException(status_code=422, detail="Usernames can only be set on resident accounts.")
        username = validated_resident_username(update.username)
        assignments.append("username = ?")
        values.append(username)
    if not assignments:
        raise HTTPException(status_code=422, detail="Provide a display name, email, or username to update.")
    email_changed = email is not None and email != (user.get("email") or "")
    with closing(connect_database()) as connection:
        if email is not None:
            clash = connection.execute(
                "SELECT id FROM users WHERE email <> '' AND email = ? AND id != ?",
                (email, user["id"]),
            ).fetchone()
            if clash:
                raise HTTPException(status_code=409, detail="That email address is already in use.")
        if username is not None:
            clash = connection.execute(
                "SELECT id FROM users WHERE username = ? AND id != ?",
                (username, user["id"]),
            ).fetchone()
            if clash:
                raise HTTPException(status_code=409, detail="That username is already in use.")
        values.append(user["id"])
        try:
            connection.execute(f"UPDATE users SET {', '.join(assignments)} WHERE id = ?", values)
        except sqlite3.IntegrityError:
            connection.rollback()
            raise HTTPException(status_code=409, detail="That username or email address is already in use.")
        verification_required = False
        if email_changed:
            token, token_hash, expiry = _new_verification()
            connection.execute(
                "UPDATE users SET email_verified = 0, verification_token_hash = ?,"
                " verification_expires = ? WHERE id = ?",
                (token_hash, expiry, user["id"]),
            )
            connection.commit()
            _deliver_email(
                email,
                "Confirm your ProofPath email",
                f"Open this confirmation link to finish setting up your account: {_public_link(f'/?verify={token}')}\n"
                "The link expires in 24 hours and can be used once.",
            )
            verification_required = True
        else:
            connection.commit()
        row = connection.execute(
            "SELECT username, email, display_name, email_verified, role FROM users WHERE id = ?",
            (user["id"],),
        ).fetchone()
    needs_username = row["role"] == "resident" and not RESIDENT_USERNAME_PATTERN.match(row["username"] or "")
    return {
        "username": row["username"],
        "email": row["email"],
        "display_name": row["display_name"] or "",
        "email_verified": bool(row["email_verified"]),
        "role": row["role"],
        "verification_required": verification_required,
        "needs_username": needs_username,
    }


@app.get("/api/reports", response_model=list[Report])
def list_reports(
    q: str | None = None,
    status: str | None = None,
    limit: int | None = None,
    offset: int = 0,
    user: dict = Depends(current_user),
) -> list[Report]:
    _check_report_permission(user, "reports_view")
    clauses: list[str] = []
    values: list[object] = []
    if user["role"] == RESIDENT_ROLE:
        clauses.append("owner_id = ?")
        values.append(user["id"])
    if q and q.strip():
        clauses.append("(title LIKE ? OR category LIKE ? OR description LIKE ? OR location LIKE ?)")
        values.extend([f"%{q.strip()}%"] * 4)
    if status:
        if status not in REPORT_STATUSES:
            raise HTTPException(status_code=422, detail="Unknown report status.")
        clauses.append("status = ?")
        values.append(status)
    if offset < 0:
        raise HTTPException(status_code=422, detail="Offset must be zero or more.")
    query = "SELECT * FROM reports"
    if clauses:
        query += " WHERE " + " AND ".join(clauses)
    query += " ORDER BY created_at DESC"
    if limit is not None:
        if not 1 <= limit <= 500:
            raise HTTPException(status_code=422, detail="Limit must be between 1 and 500.")
        query += " LIMIT ? OFFSET ?"
        values.extend([limit, offset])
    elif offset:
        query += " LIMIT -1 OFFSET ?"
        values.append(offset)
    with closing(connect_database()) as connection:
        rows = connection.execute(query, values).fetchall()
    return [row_to_report(row) for row in rows]


@app.post("/api/reports", response_model=Report, status_code=201)
async def create_report(
    title: Annotated[str, Form(min_length=3, max_length=120)],
    category: Annotated[str, Form(min_length=1, max_length=60)],
    description: Annotated[str, Form(min_length=10, max_length=2000)],
    evidence: Annotated[UploadFile, File()],
    location: Annotated[str | None, Form(max_length=180)] = None,
    status: Annotated[Literal["Draft", "Submitted"], Form()] = "Draft",
    user: dict = Depends(current_user),
) -> Report:
    _check_report_permission(user, "reports_create")
    content_type = evidence.content_type or ""
    extension = ALLOWED_TYPES.get(content_type)
    if extension is None:
        raise HTTPException(
            status_code=415,
            detail="Upload a JPG, PNG, WebP, MP4, or MOV file.",
        )

    report_id = str(uuid.uuid4())
    evidence_name = f"{report_id}{extension}"
    evidence_path = UPLOAD_DIR / evidence_name
    size = 0

    try:
        with evidence_path.open("wb") as destination:
            while chunk := await evidence.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail="Evidence must be smaller than 20 MB.",
                    )
                destination.write(chunk)
    except Exception:
        evidence_path.unlink(missing_ok=True)
        raise
    finally:
        await evidence.close()

    try:
        with evidence_path.open("rb") as saved_evidence:
            header = saved_evidence.read(12)
        valid_signature = {
            "image/jpeg": header.startswith(b"\xff\xd8\xff"),
            "image/png": header.startswith(b"\x89PNG\r\n\x1a\n"),
            "image/webp": header.startswith(b"RIFF") and header[8:12] == b"WEBP",
            "video/mp4": header[4:8] == b"ftyp",
            "video/quicktime": header[4:8] == b"ftyp" and header[8:12] == b"qt  ",
        }[content_type]
        if not valid_signature:
            raise HTTPException(
                status_code=415,
                detail="The file content does not match its format.",
            )

        safe_title = re.sub(r"\s+", " ", title).strip()
        safe_category = category.strip()
        safe_description = description.strip()
        safe_location = re.sub(r"\s+", " ", location).strip() if location else None
        if len(safe_title) < 3 or not safe_category or len(safe_description) < 10:
            raise HTTPException(
                status_code=422,
                detail="Title, category, and description must contain meaningful text.",
            )
        created_at = datetime.now(timezone.utc).isoformat()
        with closing(connect_database()) as connection:
            public_code = _next_public_code(connection)
            connection.execute(
                """INSERT INTO reports (
                    id, title, category, description, location, status,
                    evidence_name, evidence_type, created_at, owner_id,
                    public_code, observed_date, resident_context, observations,
                    strip_metadata, blur_applied
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '[]', 0, 0)""",
                (
                    report_id,
                    safe_title,
                    safe_category,
                    safe_description,
                    safe_location or None,
                    status,
                    evidence_name,
                    content_type,
                    created_at,
                    user["id"],
                    public_code,
                ),
            )
            connection.commit()
            row = connection.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
        report = row_to_report(row)
    except Exception:
        evidence_path.unlink(missing_ok=True)
        raise

    return report


@app.get("/api/reports/{report_id}", response_model=Report)
def get_report(report_id: str, user: dict = Depends(current_user)) -> Report:
    _check_report_permission(user, "reports_view")
    with closing(connect_database()) as connection:
        row = _get_scoped_report(connection, report_id, user)
    return row_to_report(row)


@app.patch("/api/reports/{report_id}/status", response_model=Report)
def update_report_status(report_id: str, update: StatusUpdate, user: dict = Depends(current_user)) -> Report:
    _check_report_permission(user, "reports_status")
    with closing(connect_database()) as connection:
        row = _get_scoped_report(connection, report_id, user)
        current_status = row["status"]
        is_downgrade = (current_status == "Resolved" and update.status != "Resolved") or (
            update.status == "Draft" and current_status != "Draft"
        )
        if is_downgrade and not update.confirm_downgrade:
            raise HTTPException(
                status_code=409,
                detail="Moving a report back needs explicit confirmation. Confirm the downgrade to continue.",
            )
        connection.execute(
            "UPDATE reports SET status = ? WHERE id = ?",
            (update.status, report_id),
        )
        connection.commit()
        row = connection.execute(
            "SELECT * FROM reports WHERE id = ?", (report_id,)
        ).fetchone()
    return row_to_report(row)


@app.patch("/api/reports/{report_id}", response_model=Report)
def edit_report(report_id: str, update: ReportUpdate, user: dict = Depends(current_user)) -> Report:
    _check_report_permission(user, "reports_edit")
    title = re.sub(r"\s+", " ", update.title).strip()
    category = update.category.strip()
    description = update.description.strip()
    location = re.sub(r"\s+", " ", update.location).strip() if update.location else None
    if not 3 <= len(title) <= 120 or not 1 <= len(category) <= 60 or not 10 <= len(description) <= 2000 or (location and len(location) > 180):
        raise HTTPException(status_code=422, detail="Check title, category, description, and location lengths.")
    observed_date = _validated_observed_date(update.observed_date)
    resident_context = re.sub(r"\s+", " ", update.resident_context).strip() if update.resident_context else None
    if resident_context is not None and len(resident_context) > 2000:
        raise HTTPException(status_code=422, detail="Resident context must be 2000 characters or fewer.")
    observations_json = None
    if update.observations is not None:
        if len(update.observations) > 50:
            raise HTTPException(status_code=422, detail="A report holds at most 50 observations.")
        observations_json = json.dumps([obs.model_dump() for obs in update.observations])
    with closing(connect_database()) as connection:
        row = _get_scoped_report(connection, report_id, user)
        connection.execute(
            """UPDATE reports SET title = ?, category = ?, description = ?, location = ?,
                observed_date = COALESCE(?, observed_date), resident_context = COALESCE(?, resident_context),
                observations = COALESCE(?, observations) WHERE id = ?""",
            (title, category, description, location, observed_date,
             resident_context, observations_json, report_id),
        )
        connection.commit()
        row = connection.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
    return row_to_report(row)


def _strip_image_metadata(content_type: str, raw: bytes) -> bytes:
    """Re-encode an image without ancillary metadata; fall back to raw bytes."""
    if content_type not in AI_IMAGE_TYPES:
        return raw
    try:
        from PIL import Image
    except ImportError:
        return raw
    import io
    try:
        with Image.open(io.BytesIO(raw)) as image:
            canvas = Image.new(image.mode, image.size)
            canvas.putdata(list(image.getdata()))
            output = io.BytesIO()
            save_format = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}[content_type]
            canvas.save(output, format=save_format)
            return output.getvalue()
    except Exception:
        logger.warning("metadata strip fell back to original bytes")
        return raw


@app.post("/api/reports/{report_id}/evidence")
async def replace_evidence(
    report_id: str,
    evidence: Annotated[UploadFile, File()],
    strip_metadata: Annotated[bool, Form()] = False,
    blur_applied: Annotated[bool, Form()] = False,
    user: dict = Depends(current_user),
) -> dict:
    _check_report_permission(user, "reports_edit")
    content_type = evidence.content_type or ""
    extension = ALLOWED_TYPES.get(content_type)
    if extension is None:
        raise HTTPException(status_code=415, detail="Upload a JPG, PNG, WebP, MP4, or MOV file.")
    with closing(connect_database()) as connection:
        row = _get_scoped_report(connection, report_id, user)
        old_name = row["evidence_name"]
    try:
        raw = await evidence.read(MAX_UPLOAD_BYTES + 1)
    finally:
        await evidence.close()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Evidence must be smaller than 20 MB.")
    if not _image_signature_ok(content_type, raw[:12]) and raw[4:8] != b"ftyp":
        if content_type in ("video/mp4", "video/quicktime"):
            if raw[4:8] != b"ftyp":
                raise HTTPException(status_code=415, detail="The file content does not match its format.")
        else:
            raise HTTPException(status_code=415, detail="The file content does not match its format.")
    stored = _strip_image_metadata(content_type, raw) if strip_metadata else raw
    evidence_name = f"{report_id}{extension}"
    evidence_path = UPLOAD_DIR / evidence_name
    evidence_path.write_bytes(stored)
    if old_name != evidence_name:
        (UPLOAD_DIR / old_name).unlink(missing_ok=True)
    with closing(connect_database()) as connection:
        connection.execute(
            "UPDATE reports SET evidence_name = ?, evidence_type = ?, strip_metadata = ?, blur_applied = ? WHERE id = ?",
            (evidence_name, content_type, int(strip_metadata), int(blur_applied), report_id),
        )
        connection.commit()
    return {
        "filename": evidence_name,
        "content_type": content_type,
        "url": f"/api/evidence/{evidence_name}",
        "strip_metadata": strip_metadata,
        "blur_applied": blur_applied,
    }


@app.delete("/api/reports/{report_id}/evidence", status_code=204)
def remove_evidence(report_id: str, user: dict = Depends(current_user)) -> Response:
    _check_report_permission(user, "reports_edit")
    with closing(connect_database()) as connection:
        row = _get_scoped_report(connection, report_id, user)
    (UPLOAD_DIR / row["evidence_name"]).unlink(missing_ok=True)
    return Response(status_code=204)


def _pdf_safe(text: str) -> str:
    return text.encode("latin-1", errors="replace").decode("latin-1")


@app.get("/api/reports/{report_id}/pdf")
def download_report_pdf(report_id: str, user: dict = Depends(current_user)) -> Response:
    from fpdf import FPDF

    _check_report_permission(user, "reports_view")
    with closing(connect_database()) as connection:
        row = _get_scoped_report(connection, report_id, user)
    report = row_to_report(row)
    observations = report.observations
    confirmed = sum(1 for obs in observations if obs.selected)
    photo_count = 1 if (UPLOAD_DIR / report.evidence_name).is_file() else 0

    pdf = FPDF(format="A4", unit="mm")
    pdf.set_auto_page_break(True, margin=20)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(0, 10, _pdf_safe("ProofPath"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(36, 77, 60)
    pdf.set_line_width(0.8)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(4)
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 7, _pdf_safe(f"Community issue report - {report.public_code}"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "B", 15)
    pdf.multi_cell(0, 8, _pdf_safe(report.title))
    observed = report.observed_date or "date not recorded"
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 7, _pdf_safe(f"{report.category} - Observed {observed}"), new_x="LMARGIN", new_y="NEXT")
    if report.location:
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(0, 7, _pdf_safe(f"Location: {report.location}"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 7, "Description", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    pdf.multi_cell(0, 6, _pdf_safe(report.description))
    if report.resident_context:
        pdf.ln(2)
        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(0, 7, "Resident context", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "I", 11)
        pdf.multi_cell(0, 6, _pdf_safe(f'"{report.resident_context}"'))
    if observations:
        pdf.ln(2)
        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(0, 7, _pdf_safe(f"Confirmed observations ({confirmed})"), new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 11)
        for obs in observations:
            if obs.selected:
                pdf.multi_cell(0, 6, _pdf_safe(f"- {obs.title}: {obs.body}"))
    pdf.ln(2)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 7, _pdf_safe(f"{photo_count} photo - {confirmed} confirmed observations"), new_x="LMARGIN", new_y="NEXT")
    evidence_path = UPLOAD_DIR / report.evidence_name
    if evidence_path.is_file() and report.evidence_type in AI_IMAGE_TYPES:
        try:
            image_width = min(150, 190)
            x = (210 - image_width) / 2
            pdf.image(str(evidence_path), x=x, w=image_width)
            pdf.ln(2)
            pdf.set_font("Helvetica", "", 10)
            pdf.cell(0, 6, _pdf_safe(f"Original evidence - {report.evidence_name}"), align="C", new_x="LMARGIN", new_y="NEXT")
        except Exception:
            logger.warning("PDF skipped an unreadable evidence image")
            pdf.set_font("Helvetica", "I", 11)
            pdf.cell(0, 7, "Evidence image could not be embedded.", new_x="LMARGIN", new_y="NEXT")
    elif report.evidence_type in ("video/mp4", "video/quicktime"):
        pdf.set_font("Helvetica", "I", 11)
        pdf.cell(0, 7, "Video evidence is listed but not embedded in print.", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)
    pdf.set_font("Helvetica", "I", 10)
    pdf.multi_cell(0, 6, _pdf_safe(f"Prepared from resident-supplied information. Status: {report.status}."))
    pdf_bytes = bytes(pdf.output())
    filename = f"{report.public_code or 'report'}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/evidence/{evidence_name}")
def get_evidence(evidence_name: str, user: dict = Depends(current_user)) -> FileResponse:
    _check_report_permission(user, "reports_view")
    if not _valid_evidence_name(evidence_name):
        raise HTTPException(status_code=404, detail="Evidence not found.")
    if user["role"] == RESIDENT_ROLE:
        with closing(connect_database()) as connection:
            row = connection.execute(
                "SELECT id, owner_id FROM reports WHERE evidence_name = ?", (evidence_name,)
            ).fetchone()
        if _resident_blocked(row, user):
            raise HTTPException(status_code=404, detail="Evidence not found.")
    evidence_path = UPLOAD_DIR / evidence_name
    if not evidence_path.is_file():
        raise HTTPException(status_code=404, detail="Evidence not found.")
    return FileResponse(evidence_path, headers={"Cache-Control": "private, max-age=3600"})


@app.delete("/api/reports/{report_id}", status_code=204)
def delete_report(report_id: str, user: dict = Depends(current_user)) -> Response:
    _check_report_permission(user, "reports_delete")
    with closing(connect_database()) as connection:
        row = connection.execute("SELECT evidence_name, owner_id FROM reports WHERE id = ?", (report_id,)).fetchone()
        if _resident_blocked(row, user):
            raise HTTPException(status_code=404, detail="Report not found.")
        if row is None:
            raise HTTPException(status_code=404, detail="Report not found.")
        connection.execute("DELETE FROM reports WHERE id = ?", (report_id,))
        connection.commit()
    (UPLOAD_DIR / row["evidence_name"]).unlink(missing_ok=True)
    return Response(status_code=204)


def _row_to_job(row: sqlite3.Row) -> dict:
    job = dict(row)
    job["evidence_names"] = json.loads(job.pop("input_json"))
    job["result"] = json.loads(job.pop("result_json"))
    return job


async def _run_segment_job(job_id: str) -> None:
    with closing(connect_database()) as connection:
        row = connection.execute("SELECT * FROM ai_jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            return
        connection.execute(
            "UPDATE ai_jobs SET status = 'running', updated_at = ? WHERE id = ?", (datetime.now(timezone.utc).isoformat(), job_id)
        )
        connection.commit()
        evidence_names = json.loads(row["input_json"])
    results: list[dict] = []
    failures = 0
    for evidence_name in evidence_names:
        evidence_path = UPLOAD_DIR / evidence_name
        try:
            if not evidence_path.is_file():
                raise FileNotFoundError(evidence_name)
            image_bytes = evidence_path.read_bytes()
            suffix = evidence_path.suffix.lower()
            mime_type = {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}.get(suffix, "")
            if not mime_type or not _image_signature_ok(mime_type, image_bytes[:12]):
                raise ValueError("not a supported image")
            segmentation = await ai_service.segment_image(image_bytes, mime_type)
            results.append({"evidence_name": evidence_name, "status": "done", **segmentation})
        except ai_service.AIServiceNotConfigured:
            failures += 1
            results.append({"evidence_name": evidence_name, "status": "error", "error": "Segmentation is not configured."})
        except (ai_service.AIServiceError, ValueError, FileNotFoundError, OSError) as exc:
            failures += 1
            logger.warning("segment job %s item failed: %s", job_id, exc)
            results.append({"evidence_name": evidence_name, "status": "error", "error": "Could not segment this file."})
    final_status = "done" if failures == 0 else ("error" if failures == len(results) else "done")
    error = None if failures == 0 else f"{failures} of {len(results)} items failed."
    with closing(connect_database()) as connection:
        connection.execute(
            "UPDATE ai_jobs SET status = ?, result_json = ?, error = ?, updated_at = ? WHERE id = ?",
            (final_status, json.dumps({"items": results}), error, datetime.now(timezone.utc).isoformat(), job_id),
        )
        connection.commit()


@app.get("/api/ai/status")
def ai_status(_: dict = Depends(current_user)) -> dict:
    return ai_service.get_ai_status()


@app.post("/api/ai/segment")
async def ai_segment(
    evidence: Annotated[UploadFile, File()],
    user: dict = Depends(current_user),
) -> dict:
    _check_report_permission(user, "reports_create")
    content_type = evidence.content_type or ""
    if content_type not in AI_IMAGE_TYPES:
        raise HTTPException(status_code=415, detail="Segmentation supports JPG, PNG, and WebP photos.")
    try:
        image_bytes = await evidence.read(MAX_UPLOAD_BYTES + 1)
    finally:
        await evidence.close()
    if len(image_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Evidence must be smaller than 20 MB.")
    if not _image_signature_ok(content_type, image_bytes[:12]):
        raise HTTPException(status_code=415, detail="The file content does not match its format.")
    try:
        return await ai_service.segment_image(image_bytes, content_type)
    except ai_service.AIServiceNotConfigured:
        logger.warning("segmentation requested without PROOFPATH_MODAL_SAM_ENDPOINT")
        raise HTTPException(status_code=503, detail="Segmentation is temporarily unavailable. Please try again later.")
    except ValueError as exc:
        raise HTTPException(status_code=413, detail=str(exc))
    except ai_service.AIServiceError as exc:
        logger.warning("segmentation failed: %s", exc)
        raise HTTPException(status_code=502, detail="Segmentation is temporarily unavailable. Please try again later.")


@app.post("/api/ai/assist")
async def ai_assist(assist: AssistRequest, user: dict = Depends(current_user)) -> dict:
    _check_report_permission(user, "reports_create")
    observation = re.sub(r"\s+", " ", assist.observation).strip()
    if len(observation) < 10:
        raise HTTPException(status_code=422, detail="Describe the observation in at least 10 characters.")
    try:
        return await ai_service.assist_report(
            observation,
            assist.title.strip() if assist.title else None,
            assist.category.strip() if assist.category else None,
            assist.location.strip() if assist.location else None,
        )
    except ai_service.AIServiceError as exc:
        logger.warning("report assist failed: %s", exc)
        raise HTTPException(status_code=502, detail="Report help is temporarily unavailable. Please try again later.")


@app.post("/api/ai/awareness-graphic", status_code=201)
async def ai_awareness_graphic(graphic: GraphicRequest, user: dict = Depends(current_user)) -> dict:
    _check_report_permission(user, "reports_create")
    try:
        return await ai_service.generate_awareness_graphic(graphic.prompt, graphic.style)
    except ai_service.AIServiceNotConfigured:
        logger.warning("awareness graphic requested without PROOFPATH_IMAGE_ENDPOINT")
        raise HTTPException(status_code=503, detail="Image generation is temporarily unavailable. Please try again later.")
    except ai_service.AIServiceError as exc:
        logger.warning("awareness graphic failed: %s", exc)
        raise HTTPException(status_code=502, detail="Image generation is temporarily unavailable. Please try again later.")


@app.post("/api/ai/jobs", status_code=201)
def create_segment_job(job: SegmentJobCreate, background_tasks: BackgroundTasks, user: dict = Depends(current_user)) -> dict:
    _require_staff(user, "reports_create")
    for evidence_name in job.evidence_names:
        if not _valid_evidence_name(evidence_name) or not evidence_name.rsplit(".", 1)[-1] in ("jpg", "png", "webp"):
            raise HTTPException(status_code=422, detail=f"Not a segmentable photo: {evidence_name}")
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    with closing(connect_database()) as connection:
        connection.execute(
            "INSERT INTO ai_jobs (id, job_type, status, input_json, result_json, created_at, updated_at) VALUES (?, 'segment_evidence', 'queued', ?, '{}', ?, ?)",
            (job_id, json.dumps(job.evidence_names), now, now),
        )
        connection.commit()
        row = connection.execute("SELECT * FROM ai_jobs WHERE id = ?", (job_id,)).fetchone()
    background_tasks.add_task(_run_segment_job, job_id)
    return _row_to_job(row)


@app.get("/api/ai/jobs")
def list_ai_jobs(user: dict = Depends(current_user)) -> list[dict]:
    _require_staff(user, "reports_view")
    with closing(connect_database()) as connection:
        rows = connection.execute("SELECT * FROM ai_jobs ORDER BY created_at DESC LIMIT 50").fetchall()
    return [_row_to_job(row) for row in rows]


@app.get("/api/ai/jobs/{job_id}")
def get_ai_job(job_id: str, user: dict = Depends(current_user)) -> dict:
    _require_staff(user, "reports_view")
    with closing(connect_database()) as connection:
        row = connection.execute("SELECT * FROM ai_jobs WHERE id = ?", (job_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return _row_to_job(row)


@app.get("/api/health")
def health() -> dict:
    status = ai_service.get_ai_status()
    configured = any(cap.get("configured") for key, cap in status.items() if isinstance(cap, dict) and "configured" in cap)
    return {"status": "ok", "version": app.version, "ai_analysis": "configured" if configured else "not_configured", "ai": status}


@app.get("/")
def index() -> Response:
    # Public landing page (Homepage frame): guests see it without signing in,
    # signed-in users land on it and continue into the reporting flow.
    entry = FRONTEND_DIST / "index.html"
    if not entry.is_file():
        return Response("Frontend not built. Run `npm run build` in frontend/ and restart.", status_code=503, media_type="text/plain")
    return FileResponse(entry)


@app.get("/assets/{asset_path:path}")
def frontend_asset(asset_path: str) -> FileResponse:
    # Built JS/CSS/image bundles carry no secrets; served publicly so the
    # landing page loads for guests. Evidence stays behind /api/evidence.
    assets_root = (FRONTEND_DIST / "assets").resolve()
    asset = (assets_root / asset_path).resolve()
    try:
        asset.relative_to(assets_root)
    except ValueError:
        raise HTTPException(status_code=404, detail="Asset not found.")
    if not asset.is_file():
        raise HTTPException(status_code=404, detail="Asset not found.")
    return FileResponse(asset, headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.get("/static/styles.css")
def login_stylesheet() -> FileResponse:
    if not LOGIN_STYLESHEET.is_file():
        raise HTTPException(status_code=404, detail="Asset not found.")
    return FileResponse(LOGIN_STYLESHEET, media_type="text/css", headers={"Cache-Control": "public, max-age=3600"})


@app.get("/static/logo.png")
def brand_mark() -> FileResponse:
    if not BRAND_MARK_FILE.is_file():
        raise HTTPException(status_code=404, detail="Asset not found.")
    return FileResponse(BRAND_MARK_FILE, media_type="image/png", headers={"Cache-Control": "public, max-age=3600"})


@app.get("/static/signin.js")
def signin_script() -> FileResponse:
    if not SIGNIN_SCRIPT_FILE.is_file():
        raise HTTPException(status_code=404, detail="Asset not found.")
    return FileResponse(SIGNIN_SCRIPT_FILE, media_type="text/javascript", headers={"Cache-Control": "public, max-age=3600"})
