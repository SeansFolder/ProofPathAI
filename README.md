# ProofPathAI

ProofPath AI is a multimodal AI-powered community reporting platform designed to help residents document, organize, and report problems within their communities.

**See it. Document it. Improve your community.**

ProofPath AI is a FastAPI app for documenting community issues with photos or videos. Reports and evidence are stored in SQLite and on disk. It has individual super admin and admin accounts with report-level privileges, plus optional AI services for image segmentation and report assistance.

## Technology stack

Frontend:

- React – Component-based user interface (dashboard, report wizard, admin UI).
- Vite – Frontend build tooling and development server.
- JavaScript/JSX – User interactions, image uploads, and API communication.
- CSS3 – Responsive interface and styling.
- Responsive web design – Support desktop, tablet, and mobile browsers.

Backend:

- Python – Main application programming language.
- FastAPI – REST API and application backend.
- Uvicorn – ASGI server.
- Pydantic – Data validation.
- SQLite – Database for reports, report statuses, accounts, and AI jobs.

Artificial intelligence (all optional, configured via endpoints):

- Meta SAM 3.1 – Main computer vision component. Identifies and segments relevant objects in uploaded photos, subject to the model's supported capabilities. Produces segmentation masks visualized as overlays, helping users see which parts of an image are relevant to a report.
- Meta Muse Spark – Assists with reasoning and report generation. Converts verified observations and user-provided details into structured report descriptions, identifies missing information, asks follow-up questions, and helps organize information into report categories.
- Meta Muse Image (optional) – Can generate supporting visual materials, such as community awareness graphics. Not required for the core reporting workflow.

Cloud infrastructure:

- Modal – Hosts and runs compatible open-weight AI models through deployed endpoints. Provides GPU resources for computer vision inference, handles image-processing workloads, supports background and batch processing, and scales computing resources according to workload.

Development and deployment:

- Visual Studio Code – Development environment.
- Git and GitHub – Version control and source-code management.
- Python virtual environment – Dependency isolation.
- Modal – Cloud AI infrastructure.
- Cloud hosting – Deployment of the web application and backend.

## Run locally

Requires Python 3.12 or newer. Configure the initial super admin credentials and a random session secret before starting:

```powershell
$env:PROOFPATH_SUPERADMIN_USERNAME = "superadmin"
$env:PROOFPATH_SUPERADMIN_PASSWORD = "use-a-unique-passphrase-at-least-16-characters"
$env:PROOFPATH_SESSION_SECRET = (python -c "import secrets; print(secrets.token_urlsafe(48))")
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
cd frontend
npm install
npm run build
cd ..
uvicorn main:app --reload
```

For frontend development, keep the backend running and start the Vite dev server in a second terminal (`cd frontend`, then `npm run dev`). Open <http://127.0.0.1:5173>; API and auth requests proxy to the backend on port 8000. Re-run `npm run build` before relying on the backend-served copy at port 8000.

Open <http://127.0.0.1:8000>. API health is available at <http://127.0.0.1:8000/api/health>. The first startup creates the configured super admin in the database. This account is seeded only when no super admin exists; later environment changes do not overwrite its database password. Sign in using its username and password, then create admin accounts from the **Admin accounts** panel. Sessions expire after 12 hours. Login is throttled after ten incorrect attempts in 15 minutes per process and client IP.

Admins receive their own username and password. A super admin can grant or remove these report privileges: view reports and evidence, create reports, edit report details, change status, and delete reports and evidence. Super admins always have all report privileges and exclusively manage admin accounts. Disabling an admin immediately invalidates their existing sessions. Existing reports are kept in the shared report workspace; privileges control what each admin can do there.

Run the test suite with:

```powershell
.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
python -m pytest
```

## Deploy with Docker

For automated validation, GitHub runs **ProofPath checks** on pushes and pull requests: frontend navigation tests and production build, plus the backend API suite. The [handoff test checklist](docs/TEST_CHECKLIST.md) tracks manual acceptance checks and the two known frontend navigation edge cases. Backend integration assumptions are documented in [the backend handoff](frontend/BACKEND_HANDOFF.md).

Copy `.env.example` to `.env`, replace the sample values with unique secrets, then run:

```sh
docker compose up --build -d
```

The compose service listens on host loopback at port 8000 and stores its data in the named `proofpath-data` volume. The Docker build compiles the React frontend automatically (multi-stage build), so no separate `npm run build` is needed. Put it behind an HTTPS reverse proxy before allowing remote access. The compose configuration marks session cookies secure, so sign-in requires HTTPS. Keep `.env` private and do not commit it.

For another host, run `uvicorn main:app --host 0.0.0.0 --port $PORT`, set `PROOFPATH_SUPERADMIN_USERNAME`, `PROOFPATH_SUPERADMIN_PASSWORD` (16+ characters), `PROOFPATH_SESSION_SECRET` (32+ random characters), and `PROOFPATH_DATA_DIR` to a persistent writable disk. Set `PROOFPATH_COOKIE_SECURE=1` when requests use HTTPS. Run a single app instance: SQLite and local evidence files are not shared across replicas.

## AI services and Modal

All AI capabilities are disabled unless their endpoint is configured. When disabled, the app works fully as a manual reporting tool: segmentation returns `503`, image generation returns `503`, and report help falls back to a labeled local checklist (never presented as model output).

Set these only after reviewing the provider's current availability, supported deployment, terms, licensing, and data handling:

- `PROOFPATH_MODAL_SAM_ENDPOINT` (+ `PROOFPATH_MODAL_TOKEN`) – Segmentation endpoint. Receives `{"image_base64", "mime_type", "prompt"?}` and returns `{"masks": [{"label", "score", "bbox": [x, y, w, h] normalized 0–1, "polygon"?}], "width"?, "height"?}`. Run a compatible open-weight vision model, including SAM 3.1 if the required model deployment and licensing are supported.
- `PROOFPATH_SPARK_ENDPOINT` (+ `PROOFPATH_SPARK_API_KEY`, `PROOFPATH_SPARK_MODEL`) – Reasoning endpoint using an OpenAI-style chat completions contract. Receives `{"model", "messages"}` and returns `{"choices": [{"message": {"content": "<json>"}}]}` with `structured_description`, `suggested_category`, `missing_info`, and `followup_questions`.
- `PROOFPATH_IMAGE_ENDPOINT` (+ `PROOFPATH_IMAGE_API_KEY`) – Optional image endpoint using an OpenAI-style generations contract for awareness graphics.

How Modal is used:

1. Computer Vision Inference: Run compatible open-weight vision models behind the segmentation endpoint.
2. GPU Processing: Allocate GPU resources for image segmentation and other intensive operations.
3. Image Processing: Prepare uploaded images and generate visual evidence overlays.
4. Background Jobs: `POST /api/ai/jobs` queues batch segmentation of saved photo evidence and processes it without blocking the main application; poll `GET /api/ai/jobs/{id}` for results.
5. Batch Processing: A single job accepts up to 20 photos.

Any model output is an unverified suggestion, never an official finding, and should use only user-provided facts and verified observations. Users review and approve every word before saving.

## Backups and restore

Create an archive outside the live data directory:

```sh
python backup.py ./backups/proofpath-$(date +%F).zip
```

On Windows PowerShell, use `python backup.py .\backups\proofpath-backup.zip`. The archive is not encrypted and contains the database and uploaded evidence, so store it as sensitive data, restrict access, and keep an off-host copy in protected storage. Restore by stopping the app, extracting `proofpath.db` and the `uploads/` folder into `PROOFPATH_DATA_DIR`, and then restarting it. Verify that both the database and every referenced evidence file were restored.

## Privacy and report workflow

- Search report title, category, description, and location, and filter by status.
- Edit report details, change status, search/filter the list, or permanently delete a report and its evidence.
- For photos, users may re-encode to remove metadata and manually blur marked regions. Video metadata is not modified. AI segmentation sends the selected photo to the configured endpoint only when the user requests outlines.
- Define and communicate a retention period before collecting real or sensitive evidence. Backups also retain deleted evidence until those archives expire; delete old backup archives according to the same policy.
- “Submitted” and “Resolved” are local labels only. The app does not contact an agency or verify an official outcome.

## Security limits

Admins have individual accounts and per-action report privileges, but reports are in one shared workspace rather than owned by a particular admin. There is no email verification, recovery flow, audit log, malware scanning, or formal privacy/retention management. Super admin credentials are created from environment variables only on first initialization; keep a secure record of them. Do not expose this prototype to the public internet or use sensitive reports until HTTPS, storage policy, account recovery, and operational backup/restore procedures are in place. Use unique passwords and keep secrets out of source control.
