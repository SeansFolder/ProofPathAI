# Backend handoff — frontend assumptions that need a backend owner

Frontend-only change set; nothing below was changed in `main.py`. Each item
names the affected endpoint and the behavior the frontend expects. Items
marked UNVERIFIED were read in backend code but never exercised against a
running server — confirm before relying on them.

## 1. Verification enforcement (dependency)

- Affected endpoints: `POST /api/session` (`login_json`), form `POST /login`,
  and the `current_user` dependency used by every authenticated route.
- Expected by the frontend: nothing. The frontend does NOT gate upload, AI,
  or report access on `email_verified`; guests are kept out of upload/AI
  flows client-side only (signed-out "Create a report" routes to resident
  signup; `Wizard` skips AI analysis when `signedIn` is false).
- Backend behavior read in code (UNVERIFIED at runtime): neither login path
  nor `current_user` checks `email_verified`, so an unverified resident can
  sign in and use the API. If policy requires verified-only access, enforce
  it backend-side (login and/or `current_user` returning 401/403 for
  unverified residents) and tell the frontend which status code and `detail`
  string to key off. The frontend must not fake this enforcement.

## 2. Auth / error responses the frontend keys off

- `POST /api/session` — 401 with the generic "incorrect" message on bad
  credentials; 429 when throttled; 503 when the session secret is short.
  `api.js` redirects to `/login` on 401 except where `loginRedirect: false`
  is passed (session check, wizard AI calls, report save).
- `POST /api/residents` (signup) — creates resident-only accounts; the
  frontend assumes any role sent is ignored and that the response carries
  `email`, `verification_required`, and `dev_preview_url`.
- `POST /api/residents/verify` + `POST /api/residents/verify/resend` — the
  frontend assumes single-use token consumption, distinct invalid/expired
  errors, and generic resend copy that reveals nothing about the address.
- Password rule: the backend rejects `< 16` chars with 422 on signup, admin
  create/update, and password change. The 16-char threshold/copy is backend
  handoff material — never change it frontend-only.
- Staff login is the server-rendered `GET /login` page; the homepage links
  to it with a plain anchor ("Staff sign in").

## 3. PDF limitations

- Affected endpoint: `GET /api/reports/{id}/pdf` (fpdf-generated, auto page
  break enabled — output can exceed one page).
- The frontend removed the hardcoded "PDF · 1 page" label for this reason
  and derives photo/video captions from the report's evidence metadata. If an
  accurate page count is ever needed, it must come from the backend (a
  response header or field), not from frontend counting.
- `PdfPreview` refetches the same PDF bytes as the download, so preview and
  download always share one document; the printable layout is a fallback only.

## 4. Email limitations

- With no email service configured, signup surfaces `dev_preview_url` as a
  development-only verification link, and the resend path stays generic.
  Real delivery (SMTP config, link expiry copy) is backend-owned; the
  frontend assumes nothing about delivery success.
