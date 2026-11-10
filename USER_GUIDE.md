# FEATS user guide

## Open the shared workspace

Double-click `start.cmd` and keep the server terminal open, or run `npm.cmd start`. Open http://localhost:3000. All users must connect to the same server. After an update, restart the server and press Ctrl+Shift+R in the browser.

## Sign up and approvals

Students enter their name, email, Student ID, course, section, and year. Staff choose a personal staff code. Subsequent staff accounts wait for administrator approval before login.

For the first administrator on a new database, the server owner uses the code in `data/admin-setup.json`. This is a local setup step. Existing accounts remain available after upgrade. Administrators approve pending staff in **Accounts & approvals** after checking their organization role. Disable/enable actions preserve historical records; disabling ends the account's sessions immediately. Administrators can correct a student account's name, email, or Student ID after verifying school records and recording a reason. Corrections retain linked records and end the student's sessions; issued receipts retain their original snapshot.

## Student workspace

- **My profile:** view/download your personal attendance QR. Update unverified student details. Verified details are managed through the official roster; contact an administrator for corrections.
- **My fees:** request a ticket or submit payment details for an assigned fee. GCash/Maya submissions require a payment screenshot. Cash requires a cash note.
- **My transactions:** follow Requested, Pending, Paid, or Rejected tickets. Only officer verification marks a ticket Paid. Paid tickets have printable receipts. A rejected ticket can be replaced by a new submission.
- **Events:** register before checking in. Actual payments happen outside FEATS.
- **My attendance:** show your personal QR to an officer, or scan/upload/paste an open event QR and confirm attendance. Duplicate attendance is blocked.
- **My records:** personal fee, payment, and attendance history; filtered exports and printing.

## Officer / collector workspace

1. Create fees and assign students in **Fee management**. Existing ticket amounts are locked.
2. Configure official receiving details through **Transactions > Manage payment channels**.
3. Review screenshots/actual transfers or cash before verifying payments. Enter a verification note or rejection reason. Verification issues the student's receipt.
4. Create/edit/publish events and open or close check-in from **Events**.
5. In **Attendance**, scan/upload a student's QR, select an open event, review identity, then confirm. Course/year scan restrictions are separate from record-list filters.
6. Use **Payment & attendance lists** to see every fee assignment, including students without tickets. Select Unpaid or another status. For events, view registered students without check-in and optionally include unregistered accounts. Not checked in is not itself proof of absence.
7. View the imported **Student roster**, **Audit trail**, and consolidated **Reports**.

## Administrator workspace

Administrators monitor records and manage **Accounts & approvals**, **Student roster**, and **Backup & restore**. Officers retain responsibility for fee/payment/event changes.

### Import the school roster

Use **Student roster > Download CSV template**, then fill the official rows. Both CSV and Excel .xlsx are supported. Excel reads the first visible worksheet; older .xls files should be saved as .xlsx or CSV. Use text cells, without formulas, dates, or hyperlinks. File limit: 5 MB; row limit: 10,000.

Required columns: `schoolId,name,course,section,year`. Optional columns: `email,enrollment`.

- Course: BITM, BSCE, BSIT, or BSMRS.
- Year: 1st Year, 2nd Year, 3rd Year, 4th Year, or 5th Year.
- Enrollment: Enrolled (default) or Inactive.

Choose the file, validate, review the preview, and confirm. Invalid or duplicate IDs stop the entire import. Matching Student IDs are updated; omitted entries are retained. Imported rows do not create accounts. Verification requires the Student ID and normalized name to match, plus email if supplied. Verified course/section/year are authoritative. Import a corrected row to change verified details. Students without accounts appear as No account in the roster.

### Review recovery requests

The owner requests help with **Forgot password?**. In **Accounts & approvals**, verify their identity, record how you checked it, and issue a one-time code. Give the code privately to that person. It is shown once, expires after 15 minutes, and cannot be reused. The person enters the code and a new password in the recovery dialog. No recovery email is sent.

If the only administrator is locked out, the server owner can stop FEATS, run `node recover-account.cjs "admin@example.com"` on the server computer, then restart FEATS. This produces an audited one-time code. Use it within 15 minutes through Forgot password?.

### Backup and restore

Automatic snapshots are stored in `data/backups` at startup and daily while running; the latest 14 automatic snapshots are retained. Manual and pre-restore snapshots are retained separately. Download copies to a separate drive/storage location.

In **Backup & restore**, re-enter your current password to create/download or validate a snapshot. Backups contain private account and organization data. Validation checks the checksum, schema, references, and current active administrator. Review counts, then type RESTORE to replace records. The server first saves a safety snapshot. A restore is transactional, preserves audit history, clears recovery requests, and signs everyone out. Use passwords contained in the restored snapshot when signing back in. Upload limit: 60 MB. A checksum detects corruption, not authenticity.

## Filters and exports

Staff tables combine course, section, year, status, fee/event, search, and date filters when applicable. Dates mean fee due date, payment creation date, or attendance date. All groups are included by default; Not set / Not selected finds missing profile details. Select Paid for verified payments. Matching totals exclude Requested, Pending, and Rejected tickets from paid amounts.

**Clear search & group filters** clears that table's controls. The transaction page's separate status selector must also be set to All statuses to restore all tickets. Filters persist across navigation and background refresh, and reset on sign-in.

**Export visible CSV** exports matching displayed table rows. **Reports > Export CSV** opens a separate filter form for account-authorized records. Use course, section, year, record type, status, fee, event, and date range. Open CSV files in Excel. Printing uses the current view.

## Notifications and account settings

**Notifications** contains in-app fee due/overdue reminders, payment decisions, upcoming registered events, and open check-ins. Officers receive pending-payment notices; administrators receive account approval and recovery requests. Staff can publish announcements to everyone or a chosen role. Mark individual messages or all current messages as read; read state is saved on the server. No email/SMS is sent.

**Account settings** lets any user change their password with the current password. A successful change ends all sessions for that account. Sign in with the new password.

## Updates and connection

Records refresh about every three seconds and when returning to the tab. **Refresh records** checks immediately. Open modal forms preserve input during background updates. Close a dialog to display updated records. Camera scanning requires localhost or HTTPS and permission; image upload/manual QR entry also work.

Keep the shared server running. A missing connection prevents saving changes. Live wallet settlement, direct registrar integration, outbound email/SMS, Google login, and public hosting are separate integrations.
