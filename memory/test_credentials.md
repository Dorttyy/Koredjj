# Test credentials (Mello)

Backend restored 2026-09-21 on fresh fork (local Mongo, DB `linguaconnect`).

## Email/password accounts
| Purpose | Email | Password | Notes |
|---|---|---|---|
| QA1 | qa_mello_1@linguatest.com | Mello1234! | created via /api/auth/register; profile completed (en→es) |
| QA Test (2026-09-21) | qa_test_a3628ba9@linguatest.com | Test1234! | created during backend regression testing |
| QA Test (2026-09-21 auth fix) | qa_test_5e44a05c@linguatest.com | Test1234! | created during auth endpoint verification after .env restore |
|| QA Test (2026-09-21 reconnect) | qa_auth_961cc9f9@linguatest.com | Test1234! | created during backend auth testing after reconnect |
| QA UI Test (2026-09-21) | qa_ui_test_1jq48ck9@linguatest.com | TestPass123! | created during UI signup testing |
| Demo users (seed.py) | demo@demo.com and 8 others | Demo1234! | run `python backend/seed.py` (idempotent) |
| Admin console | admin@lingua.app | Admin1234! | web route /admin-x7k2p9 ; seeded at startup |

## Google sign-in (Emergent managed)
- No app-managed password. Flow: auth.emergentagent.com -> redirect back with `session_id`
  -> POST /api/auth/session {"session_id"} (alias /api/auth/google) -> returns app JWT under
  `token` and `session_token` + `user`.
- Users are linked by email: an existing email/password account signing in with Google reuses
  the same user_id (flag `is_google: true`); brand new Google users get a random unusable
  password_hash and 1000 starter coins.
- Any Google account is allowed (no domain allowlist).
