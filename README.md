<<<<<<< HEAD
# FEATS
=======
# FEATS

Fee, Event & Attendance Tracking System with a shared Node.js server and SQLite database. Students have personal records, officers manage collections and events, and approved administrators manage accounts, the school roster, and backups.

## Run

Install Node.js 24 or newer. Double-click `start.cmd` to start the server and open the browser, or run:

```powershell
cd D:\FEATS
npm.cmd start
```

Open **http://localhost:3000**. Keep the server running. No dependency installation is needed to run the app: QR and Excel browser libraries are included locally. Opening index.html directly or using Live Server does not start the API.

In VS Code, use **Start FEATS shared server** in Run and Debug. If FEATS is already running, the launcher reuses it. After server-code updates, stop the old server with Ctrl+C and restart; refresh the browser with Ctrl+Shift+R.

## Administrator setup and staff approval

On a new database, FEATS creates `data/admin-setup.json`. The server owner enters that local code when signing up the **first administrator**. It is never returned by a public API. Existing accounts are preserved during migration and existing staff stay active.

Subsequent Officer/Collector and Adviser/Admin signups are **pending**. An active administrator must verify their organization role and approve them in **Accounts & approvals**. A personal staff code identifies an account; it does not authorize staff access. Pending and disabled accounts cannot access the workspace or API. Disabling an account immediately revokes its sessions and preserves its historical records. Administrators can correct a student account's name, email, or Student ID after verifying school records and recording a reason. Corrections retain linked records and end the student's sessions; issued receipts retain their original snapshot.

Students can sign up with their name, email, Student ID, course, section, and year. All accounts share one organization workspace. Browser-only accounts from the original prototype are not automatically imported.

## School roster

Administrators import **CSV or Excel .xlsx**, validate the file, review a preview, then confirm the import. Excel uses the first visible worksheet. Maximum file size is 5 MB, with up to 10,000 rows. Use **Download CSV template** for these column names:

```csv
schoolId,name,course,section,year,email,enrollment
2024-0001,Example Student,BSIT,A,1st Year,,Enrolled
```

Courses: BITM, BSCE, BSIT, BSMRS. Year values: 1st Year through 5th Year. Enrollment: Enrolled or Inactive. Email is optional; when supplied, it must match the account email for verification. Student ID and normalized name must also match. Verified accounts receive the official course, section, and year; students cannot overwrite these verified fields. Import a corrected roster entry to update them. Imports upsert matching IDs, retain omitted entries, and reject invalid or duplicate rows atomically. Importing does not create login accounts.

## Monitoring, reports, and reminders

**Payment & attendance lists** includes every fee assignment, including students without payment tickets. Filter Unpaid, Requested, Pending, or Paid. Event lists distinguish Present, Not checked in, and optionally Not registered; missing check-in alone does not establish absence.

Staff record tables combine course, section, year, status, fee/event, search, and date filters where applicable. **Export visible CSV** exports the displayed rows. **Reports > Export CSV** opens a separate export filter form; date ranges use fee due dates, payment creation dates, and attendance dates. Students can export only their own records.

**Notifications** provides in-app fee reminders, payment decisions, upcoming registered events, and open check-ins. Staff receive payment review notices; administrators receive approval/recovery requests. Staff can post audience-specific in-app announcements. Read status is saved per account. No email or SMS is sent.

**Audit trail** records successful sign-ins and mutations with actor, server time, target, and safe change details. Passwords and one-time reset codes are excluded. The UI shows the latest 2,000 entries; backups retain the full audit history. Existing history starts at the upgrade; earlier actions cannot be reconstructed.

## Passwords and recovery

All users can change passwords from **Account settings** using their current password. Password changes and completed recoveries revoke all sessions for that account.

Use **Forgot password?** to request administrator assistance. An administrator verifies identity and issues a random one-time code, shown once and valid for 15 minutes. The account owner enters that code and their new password in the recovery dialog. This works without an email service.

If the only administrator loses access, the server owner can issue a recovery code from the server terminal:

```powershell
node recover-account.cjs "admin@example.com"
```

This requires filesystem access to the server database, is audited, and never prints an existing password. Give the code privately to the verified account owner.

## Backups and restore

FEATS automatically saves a logical snapshot at startup and once per UTC day while running (checked hourly). The latest 14 automatic snapshots are retained in `data/backups`; manual and pre-restore snapshots remain until the server owner removes them. Protect this folder and copy backups to separate storage.

Administrators can create/download snapshots or upload a backup JSON (up to 60 MB) in **Backup & restore** after re-entering their password. The server validates the schema, checksum, references, image formats, and presence of the current active administrator. Preview the counts and type RESTORE to confirm replacement. A mandatory pre-restore snapshot is saved before changes; restore runs transactionally, retains audit history, clears recovery codes, and revokes every session. Sign in with credentials from the restored snapshot. Session cookies are never backed up. A checksum detects corruption; it is not a digital signature or encryption.

## Network and integrations

Set `HOST=0.0.0.0` before starting to allow other devices on the same network. They open `http://<server-LAN-IP>:3000`. Use the same server address on every device. Camera scanning requires HTTPS or localhost; QR picture upload and pasted codes also work.

GCash/Maya transfers occur outside the app. Wallet screenshot review and officer approval are manual. Live payment-provider settlement, direct registrar integration, Google sign-in, outbound email/SMS, and public hosting require separate service configuration and are not included. For HTTPS hosting set `FEATS_SECURE_COOKIES=1` and protect server data/backups.

## Verify and maintain

```powershell
npm.cmd install
npm.cmd test
npm.cmd run test:browser
```

The browser suite uses installed Google Chrome on Windows and isolated temporary databases. It covers payment/attendance flows and management forms, including native Excel import, recovery, exports, and backup restore. Development dependencies are used to create workbook fixtures; the app runs from local vendored assets.

Local libraries: QRCode.js 1.0.0 (MIT), jsQR 1.4.0 (Apache-2.0), and ExcelJS 4.4.0 (MIT). License files are in `assets/vendor`. See [ExcelJS browser documentation](https://github.com/exceljs/exceljs#browser). Spreadsheet files and QR contents are processed locally; no third-party QR or spreadsheet service receives them.
>>>>>>> 4ab563b (New Project)
