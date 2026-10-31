# Frontend handoff test checklist

Use this checklist when reviewing a commit or pull request. Record the commit SHA, browser, test environment, and evidence when marking an item complete. Leave untested or failing items unchecked.

This is a work-in-progress handoff. The current navigation helper tests and build do not cover every browser flow. Two known navigation issues are listed below and must remain open until their full reproduction paths pass.

## Automated GitHub checks

The **ProofPath checks** workflow runs on pushes, pull requests, and manual dispatches. Its separate jobs are:

- **Frontend tests and build:** `npm ci`, `npm test`, and `npm run build`, using Node.js 22.
- **Backend API tests:** install `requirements-dev.txt`, build the frontend required by the public-homepage integration test, and run `python -m pytest -q`, using Python 3.13 and temporary test data.

Passing these jobs is evidence for these automated checks only. Backend verification policy and real email/AI services require separate integration review.

Run locally:

```sh
cd frontend
npm ci
npm test
npm run build
cd ..
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

Use a disposable test environment with no production `.env` or live database for the backend suite. Use mocked/local email and AI services for manual checks.

## Resident entry and account flow

- [ ] Signed-out homepage Create a report opens signup before any evidence upload.
- [ ] Category-card entry retains the chosen category after authentication.
- [ ] Signup contains Username, Email address, and Password with the 16-character minimum explained before submission.
- [ ] Empty/invalid signup fields have inline messages and focus moves to the first invalid field.
- [ ] Sign-in accepts email or username and uses a generic incorrect-credentials message.
- [ ] Signup/sign-in values survive Privacy & help; passwords are never persisted.
- [ ] Help labels match the actual destination: Back to sign in, Back to create account, or Back to verification.
- [ ] A valid verification link makes one request in development StrictMode.
- [ ] Successful verification survives Help and return without another token request.
- [ ] Invalid/expired verification links show useful recovery actions.
- [ ] Password recovery/reset and expired-link behavior work against the agreed backend contract.
- [ ] After successful authentication, the pending report action resumes Upload evidence.

## Evidence, reports, and PDF

- [ ] Upload file type/size errors are clear and preserve recoverable form work.
- [ ] Analysis loading, failure, and manual fallback states are understandable.
- [ ] Observations, details, review, and saved-report screens preserve user edits.
- [ ] Refresh/session expiry preserves the draft for its owner and never restores it into another account.
- [ ] Reopened report details include Download PDF and use the existing view/ownership permissions.
- [ ] PDF delivery, preview, and download use the expected document and correct photo/video labels.
- [ ] Native Back/Forward between details, delivery, and preview restores the expected report.
- [ ] Delivery refresh restores the selected report or shows clear recovery actions.
- [ ] Report-list failures are distinct from a genuine empty workspace.
- [ ] Missing/forbidden reports show safe Retry/Back actions instead of indefinite loading.

## Known failing navigation acceptance paths

These were reproduced with an isolated mock backend during the frontend review; they are not backend-policy blockers.

- [ ] **Verified-screen refresh with a pending report:** signed-out Create a report -> signup -> verification success -> refresh. Keep the verified/authentication context and pending report destination; do not restart signup.
- [ ] **Mixed Back navigation after refresh:** list -> details -> delivery -> refresh -> browser Back/Forward -> Back to report details -> Back to reports. The last action must reach the report list, not return to delivery.
- [ ] Add component/browser regression coverage for both paths, beyond tests of the pure navigation helpers.

## Staff, account actions, and presentation

- [ ] Footer Staff sign in opens the staff login page.
- [ ] Admin full-access, view-only, and no-access states show only appropriate actions.
- [ ] Super Admin create/manage/disable/password-reset flows respect existing permissions and confirmations.
- [ ] Destructive/sensitive-action dialogs have correct focus, keyboard containment, cancellation, and error feedback.
- [ ] Sign-out clears account/draft context; native Back does not reveal protected reports.
- [ ] Footer SVG stays sharp at normal size and high display density without duplicating the wordmark.
- [ ] Desktop and narrow layouts have no clipped controls or unwanted horizontal scrolling.

## Backend coordination

Review `frontend/BACKEND_HANDOFF.md` with the backend owner for verification enforcement, response contracts, PDF generation, and email delivery. Passing a frontend mock check does not prove these integrations work on the live server.
