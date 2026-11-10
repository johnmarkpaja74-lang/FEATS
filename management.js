'use strict';
let bootstrapRequired=false;
let monitoringEvent='',includeUnregistered=false;
let rosterPreview=null,backupSelection=null,rosterVersion=0;
function staff(){return currentUser&&currentUser.role!=='student';}
function managementPages(){return {notifications:'Notifications'+((db.notifications||[]).filter(n=>!n.read).length?' ('+(db.notifications||[]).filter(n=>!n.read).length+')':''),...(staff()?{monitoring:'Payment & attendance lists',roster:'Student roster',audit:'Audit trail'}:{}),...(currentUser?.role==='admin'?{accounts:'Accounts & approvals',backups:'Backup & restore'}:{}),account:'Account settings'};}
function downloadFile(name,content,type='application/json'){
 const url=URL.createObjectURL(new Blob([content],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function csvText(rows){return '\ufeff'+rows.map(row=>row.map(value=>{let text=String(value??'');if(/^\s*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
function exportVisibleTable(block){
 const headers=[...block.querySelectorAll('thead th')],indexes=headers.map((cell,index)=>cell.textContent==='Action'?-1:index).filter(index=>index>=0);
 const rows=[indexes.map(index=>headers[index].textContent),...[...block.querySelectorAll('tbody>tr:not([data-empty]):not([data-no-match])')].filter(row=>!row.hidden).map(row=>indexes.map(index=>row.cells[index].textContent.trim()))];
 downloadFile('FEATS-'+page+'-filtered.csv',csvText(rows),'text/csv;charset=utf-8;');toast('Visible records exported.');
}
function exportOptions(){
 modal('Export records',`<p>Choose records and filters. Only records available to your account are exported. Date range uses fee due dates, payment creation dates, and attendance dates. Fee selection filters fee/payment records; event selection filters attendance.</p><form id="filteredExportForm"><div class="form-grid"><label>Record type<select name="type"><option value="all">All records</option><option value="Fee">Fee assignments</option><option value="Payment">Payments</option><option value="Attendance">Attendance</option></select></label><label>Status<select name="status"><option value="">All statuses</option>${['Unpaid','Requested','Pending','Paid','Rejected','Present'].map(value=>`<option>${value}</option>`).join('')}</select></label><label>Course<select name="course"><option value="">All courses</option>${Object.keys(courses).map(value=>`<option>${value}</option>`).join('')}<option>Not selected</option></select></label><label>Section<select name="section"><option value="">All sections</option>${[...new Set(db.users.filter(u=>u.role==='student').map(u=>u.section||'Not set'))].sort().map(value=>`<option>${esc(value)}</option>`).join('')}</select></label><label>Year<select name="year"><option value="">All year levels</option>${yearLevels.map(value=>`<option>${value}</option>`).join('')}<option>Not set</option></select></label><label>Fee<select name="feeId"><option value="">All fees</option>${visibleFees().map(f=>`<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}</select></label><label>Event<select name="eventId"><option value="">All events</option>${visibleEvents().map(e=>`<option value="${esc(e.id)}">${esc(e.title)}</option>`).join('')}</select></label><label>From<input type="date" name="from"></label><label>Through<input type="date" name="through"></label></div><button class="primary full">Download CSV</button></form>`);
}
function buildExportRows(filters){
 const records=[],identity=id=>db.users.find(u=>u.id===id)||{};
 visibleFees().forEach(f=>f.studentIds.filter(id=>!student()||id===currentUser.id).forEach(studentId=>records.push({type:'Fee',studentId,feeId:f.id,description:f.name,amount:f.amount,status:feeStatus(f,studentId),date:f.dueDate})));
 visiblePayments().forEach(p=>records.push({type:'Payment',studentId:p.studentId,feeId:p.feeId,description:p.feeName,amount:p.amount,status:p.status,reference:p.reference,date:p.createdAt}));
 visibleAttendance().forEach(a=>records.push({type:'Attendance',studentId:a.studentId,eventId:a.eventId,description:a.eventTitle,amount:'',status:'Present',date:a.recordedAt}));
 const filtered=records.filter(record=>{
  const u=identity(record.studentId),day=String(record.date||'').slice(0,10);
  return (!filters.type||filters.type==='all'||record.type===filters.type)&&(!filters.status||record.status===filters.status)&&(!filters.course||(u.course||'Not selected')===filters.course)&&(!filters.section||(u.section||'Not set')===filters.section)&&(!filters.year||(u.year||'Not set')===filters.year)&&(!filters.feeId||record.type==='Attendance'||record.feeId===filters.feeId)&&(!filters.eventId||record.type!=='Attendance'||record.eventId===filters.eventId)&&(!filters.from||day>=filters.from)&&(!filters.through||day<=filters.through);
 });
 return [['Record type','Name','Student ID','Course','Section','Year','Description','Amount PHP','Status','Reference','Date'],...filtered.map(record=>{const u=identity(record.studentId);return [record.type,u.name,u.schoolId,u.course,u.section,u.year,record.description,record.amount,record.status,record.reference||'',record.date];})];
}
function monitoringView(){
 if(!staff())return '';
 const fees=visibleFees().flatMap(f=>f.studentIds.map(id=>`<tr data-record-date="${esc(f.dueDate)}">${studentIdCells(id)}<td>${esc(f.name)}</td><td>${money(f.amount)}</td><td>${date(f.dueDate)}</td><td>${badge(feeStatus(f,id))}</td></tr>`));
 const events=visibleEvents();if(!events.some(e=>e.id===monitoringEvent))monitoringEvent=events[0]?.id||'';
 const event=events.find(e=>e.id===monitoringEvent);
 const attendance=event?db.users.filter(u=>u.role==='student').filter(u=>includeUnregistered||db.registrations.some(r=>r.studentId===u.id&&r.eventId===event.id)).map(u=>{
  const registered=db.registrations.some(r=>r.studentId===u.id&&r.eventId===event.id),record=db.attendance.find(a=>a.studentId===u.id&&a.eventId===event.id),status=record?'Present':registered?'Not checked in':'Not registered';
  return `<tr data-record-date="${esc(record?.recordedAt?.slice(0,10)||event.date)}">${studentIdCells(u.id)}<td>${esc(event.title)}</td><td>${record?date(record.recordedAt):'Not recorded'}</td><td>${badge(status)}</td></tr>`;
 }):[];
 return heading('STUDENT MONITORING','Who has paid? Who attended?','Filter by course, section, year, and status. Lists include student accounts; imported students without accounts appear in Student roster.')+`<section class="card"><h2>Fee assignments and unpaid balances</h2><p>Every assigned student is listed, including those without payment tickets. Choose Unpaid, Pending, Requested, or Paid below.</p>${table(['Name','Student ID','Course','Section','Year','Fee','Amount','Due','Status'],fees)}</section><section class="card"><h2>Event participation</h2><div class="form-grid"><label>Event<select id="monitoringEvent">${events.map(e=>`<option value="${esc(e.id)}" ${monitoringEvent===e.id?'selected':''}>${esc(e.title)}</option>`).join('')}</select></label><label class="inline-check"><input id="includeUnregistered" type="checkbox" ${includeUnregistered?'checked':''}>Include students without registration</label></div><p>Not checked in means registered with no attendance record. It does not by itself confirm an absence.</p>${table(['Name','Student ID','Course','Section','Year','Event','Checked in','Status'],attendance)}</section>`;
}
function rosterView(){
 const rows=(db.roster||[]).map(row=>{const account=db.users.find(u=>u.schoolId===row.schoolId&&u.role==='student');return `<tr><td>${esc(row.name)}</td><td>${esc(row.schoolId)}</td><td>${esc(row.course)}</td><td>${esc(row.section)}</td><td>${esc(row.year)}</td><td>${esc(row.enrollment)}</td><td>${account?esc(account.enrollmentStatus):'No account'}</td></tr>`;});
 return heading('OFFICIAL SCHOOL RECORDS','Student roster','Verified profiles use the official name, Student ID, course, section, year, and optional school email.',currentUser.role==='admin'?action('import-roster','Import roster','','primary')+action('roster-template','Download CSV template'):'')+`<section class="card"><p>Import an authorized school roster as CSV or an Excel .xlsx workbook. Imports update matching Student IDs and keep entries omitted from the file. Mark a row Inactive to end its enrollment. Accounts are created through signup.</p>${table(['Name','Student ID','Course','Section','Year','Enrollment','Account verification'],rows)}</section>`;
}
function parseCSV(source){
 if(source.charCodeAt(0)===0xfeff)source=source.slice(1);
 const rows=[];let row=[],cell='',quoted=false,afterQuote=false;
 for(let i=0;i<source.length;i++){
  const ch=source[i];
  if(quoted){if(ch==='"'){if(source[i+1]==='"'){cell+='"';i++;}else{quoted=false;afterQuote=true;}}else cell+=ch;continue;}
  if(ch==='"'){if(cell||afterQuote)throw Error('Invalid CSV quoting.');quoted=true;continue;}
  if(ch===','||ch==='\r'||ch==='\n'){
   row.push(cell);cell='';afterQuote=false;
   if(ch!==','){if(ch==='\r'&&source[i+1]==='\n')i++;if(row.some(v=>v.trim()))rows.push(row);row=[];}
  }else{if(afterQuote&&!/\s/.test(ch))throw Error('Invalid CSV text after closing quote.');if(!afterQuote)cell+=ch;}
 }
 if(quoted)throw Error('CSV contains an unclosed quote.');
 row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
 const headers=rows.shift()?.map(value=>value.trim());
 if(!headers||['schoolId','name','course','section','year'].some(key=>!headers.includes(key))||new Set(headers).size!==headers.length)throw Error('Use the template columns: schoolId,name,course,section,year,email,enrollment.');
 return rows.map((values,index)=>{if(values.length!==headers.length)throw Error('CSV column count differs at row '+(index+2)+'.');return Object.fromEntries(headers.map((key,i)=>[key,values[i].trim()]));});
}
let excelLoader;
async function parseRosterFile(file){
 if(!file.name.toLowerCase().endsWith('.xlsx')){
  if(!file.name.toLowerCase().endsWith('.csv'))throw Error('Choose a CSV or .xlsx Excel workbook.');
  return parseCSV(await file.text());
 }
 if(!window.ExcelJS){
  if(!excelLoader)excelLoader=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/assets/vendor/exceljs.min.js';script.onload=resolve;script.onerror=()=>{excelLoader=null;reject(Error('Excel support did not load. Refresh and try again.'));};document.head.append(script);});
  await excelLoader;
 }
 const workbook=new ExcelJS.Workbook();try{await workbook.xlsx.load(await file.arrayBuffer());}catch{throw Error('This Excel workbook could not be read. Save it as a valid .xlsx file and try again.');}
 const sheet=workbook.worksheets.find(item=>item.state!=='hidden'&&item.state!=='veryHidden');
 if(!sheet||sheet.rowCount>10001||sheet.columnCount>20)throw Error('Use one visible roster sheet with a header and up to 10,000 student rows and 20 columns.');
 const matrix=[];
 for(let index=1;index<=sheet.rowCount;index++){
  const values=[];for(let column=1;column<=sheet.columnCount;column++){
   const cell=sheet.getRow(index).getCell(column);if(cell.value&&typeof cell.value==='object'&&!Array.isArray(cell.value.richText))throw Error('Use plain text cells without formulas, dates, or hyperlinks at row '+index+'.');
   values.push(cell.text.trim());
  }
  if(values.some(Boolean))matrix.push(values);
 }
 const csv=matrix.map(row=>row.map(value=>'"'+value.replaceAll('"','""')+'"').join(',')).join('\n');
 return parseCSV(csv);
}
function importRosterModal(){
 rosterPreview=null;rosterVersion++;
 modal('Import official student roster',`<p>Choose an authorized CSV or Excel .xlsx roster. Excel imports use the first visible worksheet. Validate and review it before saving. Use the template for column names and year levels.</p><form id="rosterImportForm"><label>Roster CSV / Excel<input name="file" id="rosterFile" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required></label><button class="primary full">Validate and preview</button></form><div id="rosterPreview"></div>`);
}
function accountsView(){
 const rows=db.users.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(roleNames[u.role])}</td><td>${badge(u.status||'active')}</td><td>${date(u.createdAt)}</td><td>${u.role==='student'?action('correct-student','Correct student details',u.id):''}${u.id===currentUser.id?'Your account':u.status==='active'?action('account-status','Disable',u.id):action('account-status',u.status==='pending'?'Approve':'Enable',u.id,'primary')}</td></tr>`);
 const recoveries=(db.recoveryRequests||[]).filter(r=>['requested','issued'].includes(r.status)).map(r=>`<tr><td>${esc(userName(r.userId))}</td><td>${date(r.createdAt)}</td><td>${esc(r.status)}${r.status==='issued'?' (expires '+new Date(r.expiresAt).toLocaleTimeString()+')':''}</td><td>${action('issue-reset','Verify identity & issue code',r.id)}</td></tr>`);
 return heading('ACCOUNT ADMINISTRATION','Accounts & approvals','Approve staff only after verifying their organization role. Disabling an account immediately ends its sessions.')+`<section class="card"><h2>Account directory</h2>${table(['Name','Email','Role','Account status','Created','Action'],rows)}</section><section class="card"><h2>Password recovery requests</h2><p>Contact the account owner and verify their identity before issuing a code. Codes expire after 15 minutes and can be used once.</p>${table(['Name','Requested','Request status','Action'],recoveries)}</section>`;
}
function auditView(){return heading('TRACEABLE CHANGES','Audit trail','Successful sign-ins and record changes include the actor, action, target, and server time. Showing the latest 2,000 entries; backups retain the full history.')+`<section class="card">${table(['Time','Actor','Action','Target','Details'],(db.auditLog||[]).map(entry=>`<tr><td>${esc(new Date(entry.at).toLocaleString())}</td><td>${esc(entry.actorName)}</td><td>${esc(entry.action)}</td><td>${esc(entry.target)}</td><td>${esc(entry.detail||'')}</td></tr>`))}</section>`;}
function accountView(){return heading('YOUR ACCOUNT','Account settings','Change your password using your current password. Password changes end all existing sessions.')+`<section class="card"><p>${esc(currentUser.name)} | ${esc(currentUser.email)} | ${esc(roleNames[currentUser.role])}</p><p>Enrollment: ${esc(currentUser.enrollmentStatus||'Not applicable')}</p><form id="changePasswordForm"><label>Current password<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="200"></label><div class="form-grid"><label>New password<input name="newPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="200"></label><label>Confirm new password<input name="confirm" type="password" autocomplete="new-password" required minlength="8" maxlength="200"></label></div><button class="primary">Change password and sign out</button></form></section>`;}
function notificationsView(){return heading('STAY INFORMED','Notifications','In-app reminders for fees, payment decisions, event schedules, and open attendance. No email or SMS is sent.',action('read-notifications','Mark all as read'))+`<section class="card">${(db.notifications||[]).map(note=>`<article class="notification-item ${note.read?'is-read':''}"><h3>${esc(note.title)} ${note.read?'':'<span class="badge">New</span>'}</h3><p>${esc(note.message)}</p><small>${date(note.at)}</small><div class="actions">${action('navigate','Open '+(pageNames()[note.page]||'records'),note.page)}${note.read?'':action('read-notification','Mark as read',note.id)}</div></article>`).join('')||empty('No notifications right now.')}</section>${staff()?`<section class="card"><h2>Post an announcement</h2><form id="announcementForm"><label>Title<input name="title" required maxlength="120"></label><label>Message<textarea name="message" required maxlength="1000"></textarea></label><label>Audience<select name="audience"><option value="all">Everyone</option><option value="student">Students</option><option value="officer">Officers</option><option value="admin">Administrators</option></select></label><button class="primary">Publish in-app announcement</button></form></section>`:''}`;}
function backupsView(){return heading('RECORD RECOVERY','Backup & restore','Automatic daily snapshots are kept for 14 days. Manual and pre-restore snapshots are retained. Backups contain private account and organization records.')+`<section class="card"><h2>Create or restore a backup</h2><p>Backups stay in data/backups on the server. Download copies to separate storage. Restores replace records, retain the audit history, and end every session.</p><div class="actions">${action('create-backup','Create & download backup','','primary')}${action('upload-backup','Validate a backup file')}</div><p id="backupWarning" role="status"></p><div id="backupList">Loading snapshots...</div></section>`;}
async function loadBackupList(){
 const generation=sessionGeneration;
 try{const response=await api('backups');if(generation!==sessionGeneration||page!=='backups')return;
  $('backupWarning').textContent=response.warning||'';
  $('backupList').innerHTML=table(['Snapshot','Size','Action'],response.backups.map(item=>`<tr><td>${esc(item.name)}</td><td>${Math.ceil(item.bytes/1024)} KB</td><td><div class="actions">${action('download-backup','Download',item.name)}${action('restore-backup','Validate & restore',item.name)}</div></td></tr>`));refreshRecordSearch();
 }catch(error){if($('backupList'))$('backupList').textContent=error.message;}
}
function backupPasswordModal(mode,name){
 backupSelection=null;
 modal(mode==='create'?'Create backup':mode==='download'?'Download backup':'Validate backup before restore',`<form id="backupForm" data-mode="${mode}" data-name="${esc(name||'')}">${mode==='upload'?'<label>FEATS backup JSON<input id="backupFile" name="file" type="file" accept=".json,application/json" required></label>':''}<label>Your current administrator password<input name="password" type="password" autocomplete="current-password" required maxlength="200"></label><button class="primary full">${mode==='create'?'Create and download':mode==='download'?'Download':'Validate and review'}</button></form><div id="backupValidation"></div>`);
}
function recoveryModal(){modal('Recover your account',`<p>Request recovery, then contact your organization administrator to verify your identity and receive a one-time code. This system does not send recovery emails.</p><form id="requestRecoveryForm"><label>Email, Student ID, or staff code<input name="identifier" required maxlength="150" autocomplete="username"></label><button class="primary full">Request administrator assistance</button></form><p id="recoveryRequestStatus" role="status"></p><hr><h3>Already have a reset code?</h3><form id="resetPasswordForm"><label>One-time reset code<input name="code" required maxlength="100" autocomplete="off"></label><label>New password<input name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="200"></label><label>Confirm password<input name="confirm" type="password" autocomplete="new-password" required minlength="8" maxlength="200"></label><button class="primary full">Reset password</button></form>`);}
function syncBootstrapField(){
 const field=document.getElementById('setupCodeField');if(!field)return;
 const show=bootstrapRequired&&authMode==='signup'&&selectedRole()==='admin';field.hidden=!show;$('authSetupCode').disabled=!show;$('authSetupCode').required=show;
}
function lockVerifiedProfile(){
 if(currentUser?.enrollmentStatus!=='Verified')return;
 const form=$('profileCourseForm');if(!form)return;
 for(const name of ['course','section','year']){const field=form.elements.namedItem(name);if(field){field.value=currentUser[name]||'';field.disabled=true;}}
 const button=form.querySelector('button');if(button){button.disabled=true;button.textContent='Verified through school roster';}
}
function afterManagementRender(){
 lockVerifiedProfile();
 const button=$('notificationsButton');if(button){const unread=(db.notifications||[]).filter(n=>!n.read).length;button.textContent='Notifications'+(unread?' ('+unread+')':'');}
 if(page==='backups')loadBackupList();
}
document.getElementById('modal').addEventListener('close',()=>{backupSelection=null;rosterPreview=null;});
document.addEventListener('click',async event=>{
 const forgot=event.target.closest('#forgotPassword');if(forgot){recoveryModal();return;}
 const exportButton=event.target.closest('[data-export-table]');if(exportButton){exportVisibleTable(exportButton.closest('.records-block'));return;}
 const button=event.target.closest('[data-action]');if(!button||!currentUser)return;
 const key=button.dataset.action,id=button.dataset.id;
 try{
  if(key==='import-roster')importRosterModal();
  if(key==='roster-template')downloadFile('FEATS-roster-template.csv',csvText([['schoolId','name','course','section','year','email','enrollment'],['2024-0001','Example Student','BSIT','A','1st Year','','Enrolled']]),'text/csv;charset=utf-8;');
  if(key==='confirm-roster'&&rosterPreview){const response=await saveAction('importRoster',{rows:rosterPreview},{message:'Official roster imported.'});if(response)rosterPreview=null;}
  if(key==='account-status'){
   const account=db.users.find(u=>u.id===id);if(!account)return;
   const status=account.status==='active'?'disabled':'active';
   modal(status==='active'?'Approve / enable account':'Disable account',`<p>${esc(account.name)} | ${esc(roleNames[account.role])} | ${esc(account.email)}</p><p>${status==='active'?'Confirm that this person is authorized for this role.':'This ends existing sessions and prevents login. Historical records are retained.'}</p><button id="confirmAccountStatus" class="primary full">Confirm ${status==='active'?'approval':'disable'}</button>`);
   $('confirmAccountStatus').onclick=()=>saveAction('accountStatus',{id,status},{message:'Account '+status+'.'});
  }
  if(key==='correct-student'){
   const account=db.users.find(u=>u.id===id);if(!account)return;
   modal('Correct student account identity',`<p>Use verified school records. Historical transactions remain linked to this account; existing receipts retain their original issue details. The student is signed out after a correction.</p><form id="correctStudentForm" data-id="${esc(id)}"><label>Full name<input name="name" required maxlength="80" value="${esc(account.name)}"></label><label>Email<input name="email" type="email" required maxlength="150" value="${esc(account.email)}"></label><label>Student ID<input name="schoolId" required pattern="[0-9]{4} *- *[0-9]{4}" value="${esc(account.schoolId)}"></label><label>Correction reason<textarea name="note" required maxlength="500"></textarea></label><button class="primary full">Save verified correction</button></form>`);
  }
  if(key==='issue-reset')modal('Verify identity before issuing a code',`<form id="issueResetForm" data-id="${esc(id)}"><label>How did you verify the account owner?<textarea name="reason" required maxlength="500"></textarea></label><button class="primary full">Issue one-time reset code</button></form>`);
  if(key==='read-notification')await saveAction('readNotifications',{ids:[id]});
  if(key==='read-notifications')await saveAction('readNotifications',{ids:(db.notifications||[]).filter(n=>!n.read).map(n=>n.id)});
  if(key==='create-backup')backupPasswordModal('create');
  if(key==='download-backup')backupPasswordModal('download',id);
  if(key==='restore-backup')backupPasswordModal('restore',id);
  if(key==='upload-backup')backupPasswordModal('upload');
 }catch(error){toast(error.message);}
});
document.addEventListener('change',event=>{
 if(event.target.id==='rosterFile'){rosterVersion++;rosterPreview=null;if($('rosterPreview'))$('rosterPreview').innerHTML='';}
 if(event.target.id==='backupFile'){backupSelection=null;if($('backupValidation'))$('backupValidation').innerHTML='';}
 if(event.target.id==='monitoringEvent'){monitoringEvent=event.target.value;render();}
 if(event.target.id==='includeUnregistered'){includeUnregistered=event.target.checked;render();}
});
document.addEventListener('submit',async event=>{
 const form=event.target,ids=['correctStudentForm','filteredExportForm','rosterImportForm','changePasswordForm','issueResetForm','announcementForm','backupForm','restoreBackupForm','requestRecoveryForm','resetPasswordForm'];
 if(!ids.includes(form.id))return;event.preventDefault();
 const submit=form.querySelector('button[type=submit],button:not([type])');if(submit)submit.disabled=true;
 try{
  const data=Object.fromEntries(new FormData(form)),generation=sessionGeneration,version=rosterVersion;
  if(form.id==='correctStudentForm')await saveAction('correctStudent',{id:form.dataset.id,...data},{message:'Student identity corrected; their sessions have ended.'});
  if(form.id==='filteredExportForm'){
   if(data.from&&data.through&&data.from>data.through)throw Error('From date must be on or before Through date.');
   const rows=buildExportRows(data);downloadFile('FEATS-filtered-records.csv',csvText(rows),'text/csv;charset=utf-8;');toast((rows.length-1)+' records exported.');$('modal').close();
  }
  if(form.id==='rosterImportForm'){
   if(data.file.size>5*1024*1024)throw Error('Choose a CSV or Excel file smaller than 5 MB.');
   const rows=await parseRosterFile(data.file),response=await api('roster/preview',{rows});if(!form.isConnected||generation!==sessionGeneration||version!==rosterVersion)return;rosterPreview=response.rows;
   $('rosterPreview').innerHTML=`<p>${response.rows.length} validated rows; ${response.existing} existing entries will be updated. The remaining entries will be added.</p><div class="table-wrap"><table><thead><tr><th>Student ID</th><th>Name</th><th>Course</th><th>Section</th><th>Year</th></tr></thead><tbody>${response.rows.slice(0,20).map(row=>`<tr><td>${esc(row.schoolId)}</td><td>${esc(row.name)}</td><td>${esc(row.course)}</td><td>${esc(row.section)}</td><td>${esc(row.year)}</td></tr>`).join('')}</tbody></table></div><p>Preview shows up to 20 rows. All ${response.rows.length} validated rows will be imported.</p>${action('confirm-roster','Confirm import','','primary')}`;
  }
  if(form.id==='changePasswordForm'){
   if(data.newPassword!==data.confirm)throw Error('Passwords do not match.');
   const response=await saveAction('changePassword',data);if(response){showSignedOut();toast('Password changed. Sign in with your new password.');}
  }
  if(form.id==='issueResetForm'){
   const response=await saveAction('issueReset',{id:form.dataset.id,reason:data.reason});
   if(response)modal('One-time recovery code',`<p>Give this code privately to the verified account owner. It expires at ${esc(new Date(response.result.expiresAt).toLocaleString())} and cannot be viewed again.</p><label>Reset code<input readonly value="${esc(response.result.code)}"></label>`);
  }
  if(form.id==='announcementForm')await saveAction('announce',data,{message:'Announcement published.'});
  if(form.id==='requestRecoveryForm'){$('recoveryRequestStatus').textContent=(await api('recovery/request',data)).message;}
  if(form.id==='resetPasswordForm'){
   if(data.password!==data.confirm)throw Error('Passwords do not match.');
   await api('recovery/reset',data);$('modal').close();toast('Password reset. Sign in with your new password.');
  }
  if(form.id==='backupForm'){
   const mode=form.dataset.mode;
   let payload={password:data.password,...(form.dataset.name?{name:form.dataset.name}:{})};
   if(mode==='upload'){if(data.file.size>60*1024*1024)throw Error('Choose a backup smaller than 60 MB.');try{payload.backup=JSON.parse(await data.file.text());}catch{throw Error('Choose a valid FEATS backup JSON file.');}}
   if(mode==='create'||mode==='download'){
    const response=await api('backups/'+mode,payload);downloadFile(response.name,JSON.stringify(response.backup));$('modal').close();if(page==='backups')loadBackupList();toast('Backup downloaded. Store it privately.');
   }else{
    const response=await api('backups/validate',payload);if(!form.isConnected||generation!==sessionGeneration)return;backupSelection=payload;
    $('backupValidation').innerHTML=`<p>Validated snapshot from ${esc(new Date(response.createdAt).toLocaleString())}.</p><p>${Object.entries(response.counts).map(([key,value])=>esc(key)+': '+value).join(' | ')}</p><p>Restoring replaces current records and signs everyone out. A safety snapshot is saved first.</p><form id="restoreBackupForm"><label>Type RESTORE to confirm<input name="confirm" required pattern="RESTORE" autocomplete="off"></label><button class="danger full">Restore validated snapshot</button></form>`;
    form.querySelector('[name=password]').value='';
   }
  }
  if(form.id==='restoreBackupForm'){
   if(!backupSelection)throw Error('Validate the backup again.');
   await api('backups/restore',{...backupSelection,confirm:data.confirm});backupSelection=null;showSignedOut();toast('Backup restored. Sign in again.');
  }
 }catch(error){toast(error.message);}
 finally{if(submit)submit.disabled=false;}
});
