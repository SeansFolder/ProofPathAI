from __future__ import annotations

import re
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

logging.basicConfig(level=os.environ.get("PROOFPATH_LOG_LEVEL", "INFO"))
logger = logging.getLogger("proofpath")

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("PROOFPATH_DATA_DIR", str(BASE_DIR / "data"))).resolve()
UPLOAD_DIR = DATA_DIR / "uploads"
DATABASE_PATH = DATA_DIR / "proofpath.db"
FRONTEND_DIR = BASE_DIR / "frontend"
FRONTEND_DIST = FRONTEND_DIR / "dist"
LOGIN_STYLESHEET = FRONTEND_DIR / "src" / "index.css"
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
                role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin')),
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
        connection.execute("CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_jobs(status)")
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


class NewAdmin(BaseModel):
    username: str
    password: str
    privileges: list[str]


class AdminUpdate(BaseModel):
    privileges: list[str] | None = None
    active: bool | None = None
    password: str | None = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


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


class StatusUpdate(BaseModel):
    status: Literal["Draft", "Submitted", "Resolved"]


class ReportUpdate(BaseModel):
    title: str
    category: str
    description: str
    location: str | None = None


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
        raise HTTPException(status_code=503, detail="Configure PROOFPATH_SESSION_SECRET with at least 32 characters.")
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


initialize_database()


def row_to_report(row: sqlite3.Row) -> Report:
    return Report(**dict(row))


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
    configured = len(SESSION_SECRET) >= 32 and has_super_admin()
    message = "" if configured else "For the first startup, set a valid PROOFPATH_SUPERADMIN_USERNAME, PROOFPATH_SUPERADMIN_PASSWORD (16+ characters), and PROOFPATH_SESSION_SECRET (32+ characters)."
    error = request.query_params.get("error")
    error_message = "Sign-in details did not match. Try again." if error == "invalid" else "Too many sign-in attempts. Wait 15 minutes and try again." if error == "throttled" else ""
    error_notice = f'<p class="auth-alert" role="alert">{error_message}</p>' if error_message else ""
    setup_notice = f'<p class="auth-alert auth-setup" role="status">{message}</p>' if not configured else ""
    return HTMLResponse(f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="theme-color" content="#f4f5ef"><title>Sign in · ProofPath</title><link rel="stylesheet" href="/static/styles.css"></head>
<body class="auth-body"><main class="auth-layout"><a class="brand auth-brand" href="/login" aria-label="ProofPath sign in"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span><span>proofpath<span class="brand-ai">AI</span></span></a>
<section class="auth-card"><p class="eyebrow">COMMUNITY REPORTING</p><h1>Welcome back.</h1><p class="auth-copy">Sign in to review reports and keep community evidence organized.</p>
{error_notice}{setup_notice}
<form method="post" action="/login" class="auth-form"><label for="login-username">Username</label><input id="login-username" name="username" autocomplete="username" required {'disabled' if not configured else ''}><label for="login-password">Password</label><input id="login-password" name="password" type="password" autocomplete="current-password" required {'disabled' if not configured else ''}><button type="submit" class="submit-button" {'disabled' if not configured else ''}>Sign in <span aria-hidden="true">→</span></button></form>
<p class="auth-footnote">Access is managed by your ProofPath super admin.</p></section><p class="auth-footer">ProofPath AI <span>·</span> Community reporting, made clearer</p></main></body></html>''')


@app.post("/login")
async def login(request: Request) -> Response:
    if len(SESSION_SECRET) < 32:
        raise HTTPException(status_code=503, detail="Access is not configured with a strong session secret.")
    client_ip = request.client.host if request.client else "unknown"
    recent_failures = [stamp for stamp in LOGIN_FAILURES.get(client_ip, []) if stamp > time.time() - 900]
    LOGIN_FAILURES[client_ip] = recent_failures
    if len(recent_failures) >= 10:
        return RedirectResponse("/login?error=throttled", status_code=303)
    form = await request.form()
    username = str(form.get("username", "")).strip().lower()
    password = str(form.get("password", ""))
    with closing(connect_database()) as connection:
        user = connection.execute("SELECT * FROM users WHERE username = ? AND active = 1", (username,)).fetchone()
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


@app.get("/api/session")
def get_session(user: dict = Depends(current_user)) -> dict:
    return {"id": user["id"], "username": user["username"], "role": user["role"], "privileges": sorted(PERMISSIONS) if user["role"] == "super_admin" else user["privileges"]}


@app.get("/api/admins")
def list_admins(_: dict = Depends(require_super_admin)) -> list[dict]:
    with closing(connect_database()) as connection:
        rows = connection.execute("SELECT id, username, privileges, active, created_at FROM users WHERE role = 'admin' ORDER BY username COLLATE NOCASE").fetchall()
    return [{**dict(row), "privileges": json.loads(row["privileges"]), "active": bool(row["active"])} for row in rows]


@app.post("/api/admins", status_code=201)
def create_admin(admin: NewAdmin, _: dict = Depends(require_super_admin)) -> dict:
    username = admin.username.strip().lower()
    privileges = sorted(set(admin.privileges))
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{2,31}", username):
        raise HTTPException(status_code=422, detail="Username must be 3–32 characters using letters, numbers, dots, underscores, or hyphens.")
    if len(admin.password) < 16:
        raise HTTPException(status_code=422, detail="Use a password with at least 16 characters.")
    if not set(privileges).issubset(PERMISSIONS):
        raise HTTPException(status_code=422, detail="One or more privileges are not recognized.")
    salt, password_hash = hash_password(admin.password)
    with closing(connect_database()) as connection:
        try:
            cursor = connection.execute(
                "INSERT INTO users (username, password_hash, salt, role, privileges, active, created_at) VALUES (?, ?, ?, 'admin', ?, 1, ?)",
                (username, password_hash, salt, json.dumps(privileges), datetime.now(timezone.utc).isoformat()),
            )
            connection.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="That username is already in use.")
    return {"id": cursor.lastrowid, "username": username, "privileges": privileges, "active": True}


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
    if not assignments:
        raise HTTPException(status_code=422, detail="Provide privileges, active, or password to update.")
    values.append(admin_id)
    with closing(connect_database()) as connection:
        cursor = connection.execute(f"UPDATE users SET {', '.join(assignments)} WHERE id = ? AND role = 'admin'", values)
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Admin account not found.")
        connection.commit()
        row = connection.execute("SELECT id, username, privileges, active, created_at FROM users WHERE id = ?", (admin_id,)).fetchone()
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


@app.get("/api/reports", response_model=list[Report])
def list_reports(
    q: str | None = None,
    status: str | None = None,
    limit: int | None = None,
    offset: int = 0,
    _: dict = Depends(require_permission("reports_view")),
) -> list[Report]:
    clauses: list[str] = []
    values: list[object] = []
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
    _: dict = Depends(require_permission("reports_create")),
) -> Report:
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
        report = Report(
            id=report_id,
            title=safe_title,
            category=safe_category,
            description=safe_description,
            location=safe_location or None,
            status=status,
            evidence_name=evidence_name,
            evidence_type=content_type,
            created_at=created_at,
        )

        with closing(connect_database()) as connection:
            connection.execute(
                """INSERT INTO reports (
                    id, title, category, description, location, status,
                    evidence_name, evidence_type, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
                ),
            )
            connection.commit()
    except Exception:
        evidence_path.unlink(missing_ok=True)
        raise

    return report


@app.patch("/api/reports/{report_id}/status", response_model=Report)
def update_report_status(report_id: str, update: StatusUpdate, _: dict = Depends(require_permission("reports_status"))) -> Report:
    with closing(connect_database()) as connection:
        cursor = connection.execute(
            "UPDATE reports SET status = ? WHERE id = ?",
            (update.status, report_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Report not found.")
        connection.commit()
        row = connection.execute(
            "SELECT * FROM reports WHERE id = ?", (report_id,)
        ).fetchone()
    return row_to_report(row)


@app.patch("/api/reports/{report_id}", response_model=Report)
def edit_report(report_id: str, update: ReportUpdate, _: dict = Depends(require_permission("reports_edit"))) -> Report:
    title = re.sub(r"\s+", " ", update.title).strip()
    category = update.category.strip()
    description = update.description.strip()
    location = re.sub(r"\s+", " ", update.location).strip() if update.location else None
    if not 3 <= len(title) <= 120 or not 1 <= len(category) <= 60 or not 10 <= len(description) <= 2000 or (location and len(location) > 180):
        raise HTTPException(status_code=422, detail="Check title, category, description, and location lengths.")
    with closing(connect_database()) as connection:
        cursor = connection.execute(
            "UPDATE reports SET title = ?, category = ?, description = ?, location = ? WHERE id = ?",
            (title, category, description, location, report_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Report not found.")
        connection.commit()
        row = connection.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
    return row_to_report(row)


@app.get("/api/evidence/{evidence_name}")
def get_evidence(evidence_name: str, _: dict = Depends(require_permission("reports_view"))) -> FileResponse:
    if not _valid_evidence_name(evidence_name):
        raise HTTPException(status_code=404, detail="Evidence not found.")
    evidence_path = UPLOAD_DIR / evidence_name
    if not evidence_path.is_file():
        raise HTTPException(status_code=404, detail="Evidence not found.")
    return FileResponse(evidence_path, headers={"Cache-Control": "private, max-age=3600"})


@app.delete("/api/reports/{report_id}", status_code=204)
def delete_report(report_id: str, _: dict = Depends(require_permission("reports_delete"))) -> Response:
    with closing(connect_database()) as connection:
        row = connection.execute("SELECT evidence_name FROM reports WHERE id = ?", (report_id,)).fetchone()
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
    _: dict = Depends(require_permission("reports_create")),
) -> dict:
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
        raise HTTPException(status_code=503, detail="Segmentation is not configured. Set PROOFPATH_MODAL_SAM_ENDPOINT.")
    except ValueError as exc:
        raise HTTPException(status_code=413, detail=str(exc))
    except ai_service.AIServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/ai/assist")
async def ai_assist(assist: AssistRequest, _: dict = Depends(require_permission("reports_create"))) -> dict:
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
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/ai/awareness-graphic", status_code=201)
async def ai_awareness_graphic(graphic: GraphicRequest, _: dict = Depends(require_permission("reports_create"))) -> dict:
    try:
        return await ai_service.generate_awareness_graphic(graphic.prompt, graphic.style)
    except ai_service.AIServiceNotConfigured:
        raise HTTPException(status_code=503, detail="Image generation is not configured. Set PROOFPATH_IMAGE_ENDPOINT.")
    except ai_service.AIServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/ai/jobs", status_code=201)
def create_segment_job(job: SegmentJobCreate, background_tasks: BackgroundTasks, _: dict = Depends(require_permission("reports_create"))) -> dict:
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
def list_ai_jobs(_: dict = Depends(require_permission("reports_view"))) -> list[dict]:
    with closing(connect_database()) as connection:
        rows = connection.execute("SELECT * FROM ai_jobs ORDER BY created_at DESC LIMIT 50").fetchall()
    return [_row_to_job(row) for row in rows]


@app.get("/api/ai/jobs/{job_id}")
def get_ai_job(job_id: str, _: dict = Depends(require_permission("reports_view"))) -> dict:
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
def index(request: Request) -> Response:
    try:
        current_user(request)
    except HTTPException:
        return RedirectResponse("/login", status_code=303)
    entry = FRONTEND_DIST / "index.html"
    if not entry.is_file():
        return Response("Frontend not built. Run `npm run build` in frontend/ and restart.", status_code=503, media_type="text/plain")
    return FileResponse(entry)


@app.get("/assets/{asset_path:path}")
def frontend_asset(asset_path: str, request: Request) -> FileResponse:
    current_user(request)
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
