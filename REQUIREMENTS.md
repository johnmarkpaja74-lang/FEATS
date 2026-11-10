# FEATS requirements coverage

| Feature | Implementation |
| --- | --- |
| Shared role workspaces | Node.js API, SQLite, session cookies, ownership and role checks, automatic polling. |
| Staff approval | Local code for first-admin setup; subsequent staff pending; admin approval/disable; immediate session revocation. |
| Student roster | CSV and native .xlsx, preview and atomic upsert, name/ID/email verification, authoritative profile fields, enrollment status. |
| Payments | Assigned fees, unique tickets, private screenshot upload, manual verification/rejection, printable receipts, preserved history. |
| Events and attendance | Event publishing/covers, registration, persistent personal QR, officer identity review, event-code check-in, duplicate protection. |
| Unpaid/missing attendance | All fee assignments, status filters, registered but not checked in, optional unregistered students, group and date filters. |
| Audit trail | Successful sign-ins and record mutations; actor/time/target/safe details; full history in backups; latest 2,000 entries in UI. |
| Account management | Staff approval, account disable/enable, current-password change, administrator-assisted one-time recovery, server-owner recovery CLI. |
| Backup and restore | Startup/daily automatic snapshots, 14-auto-snapshot retention, manual download/upload, password reauthentication, validation/preview/confirmation, safety snapshot, transactional restore, session invalidation. |
| Reports | Authorized full or filtered CSV; visible-table CSV; course/section/year/status/fee/event/date filters; printing. |
| Notifications | In-app due/overdue fees, payment decisions/reviews, upcoming events, open attendance, approval/recovery requests, announcements, persisted read status. |
| Verification | Server integration tests plus management security tests and Chrome browser form/flow/responsiveness tests. |

## External integrations

Payment-provider settlement, live registrar integration, Google sign-in, outbound email/SMS, and public deployment remain separate integrations. The implemented recovery and reminders work in-app without those services. CSV/Excel verification relies on an authorized school roster supplied by the administrator.
