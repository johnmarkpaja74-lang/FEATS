'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const stamp=()=>new Date().toISOString();
const id=prefix=>prefix+'-'+crypto.randomUUID();
function error(message,status=400){const e=Error(message);e.status=status;throw e;}
function admin(user){if(user.role!=='admin')error('Administrator access is required.',403);}
function text(value,label,max=200){if(typeof value!=='string'||!value.trim()||value.trim().length>max)error('Enter a valid '+label+'.');return value.trim();}
function normalizeName(value){return value.trim().replace(/\s+/g,' ').toLowerCase();}
function migrate(state){
 let changed=false;
 for(const field of ['roster','auditLog','recoveryRequests','announcements'])if(!Array.isArray(state[field])){state[field]=[];changed=true;}
 for(const user of state.users){if(!user.status){user.status='active';changed=true;}if(!Array.isArray(user.readNotifications)){user.readNotifications=[];changed=true;}}
 return changed;
}
function audit(state,user,action,target='',detail=''){
 state.auditLog.push({id:id('audit'),at:stamp(),actorId:user?.id||'',actorName:user?.name||'System',action,target:String(target||''),detail});
}
function enrollment(state,user){
 const entry=state.roster.find(row=>row.schoolId===user.schoolId);
 const verified=entry?.enrollment==='Enrolled'&&normalizeName(entry.name)===normalizeName(user.name)&&(!entry.email||entry.email===user.email);
 user.enrollmentStatus=verified?'Verified':entry?.enrollment==='Inactive'?'Inactive':'Unverified';
 if(verified)Object.assign(user,{course:entry.course,section:entry.section,year:entry.year});
 return user;
}
function rosterRows(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>10000)error('Import between 1 and 10,000 roster rows.');
 const seen=new Set();
 return rows.map((row,index)=>{
  if(!row||typeof row!=='object'||Array.isArray(row))error('Invalid roster row '+(index+2)+'.');
  const label=' at row '+(index+2),schoolId=text(row.schoolId,'Student ID'+label,20).replace(/\s+/g,'');
  if(!/^\d{4}-\d{4}$/.test(schoolId)||Number(schoolId.slice(0,4))<1900||Number(schoolId.slice(0,4))>new Date().getFullYear())error('Invalid Student ID'+label+'.');
  if(seen.has(schoolId))error('Duplicate Student ID '+schoolId+label+'.');seen.add(schoolId);
  const name=text(row.name,'name'+label,80),course=text(row.course,'course'+label,10),section=text(row.section,'section'+label,30),year=text(row.year,'year'+label,20);
  if(!['BITM','BSCE','BSIT','BSMRS'].includes(course))error('Invalid course'+label+'.');
  if(!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,29}$/.test(section))error('Invalid section'+label+'.');
  if(!['1st Year','2nd Year','3rd Year','4th Year','5th Year'].includes(year))error('Invalid year level'+label+'.');
  const email=String(row.email||'').trim().toLowerCase(),enrollment=row.enrollment||'Enrolled';
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))error('Invalid email'+label+'.');
  if(!['Enrolled','Inactive'].includes(enrollment))error('Enrollment must be Enrolled or Inactive'+label+'.');
  return {schoolId,name,course,section,year,email,enrollment};
 });
}
function notifications(state,user){
 const items=[],today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'});
 const add=(key,title,message,page,at)=>items.push({id:key,title,message,page,at:at||today,read:user.readNotifications.includes(key)});
 if(user.role==='student'){
  for(const fee of state.fees.filter(f=>f.studentIds.includes(user.id))){
   if(state.payments.some(p=>p.feeId===fee.id&&p.studentId===user.id&&p.status==='Paid'))continue;
   const days=Math.ceil((Date.parse(fee.dueDate)-Date.parse(today))/86400000);
   if(days<=7)add('due-'+fee.id+'-'+fee.dueDate,days<0?'Overdue fee':'Fee due soon',fee.name+' is due '+fee.dueDate+'.','fees',fee.dueDate);
  }
  for(const payment of state.payments.filter(p=>p.studentId===user.id&&['Paid','Rejected'].includes(p.status)))add('payment-'+payment.id+'-'+payment.status,'Payment '+payment.status.toLowerCase(),payment.feeName+(payment.note?': '+payment.note:'.'),'payments',payment.verifiedAt);
  for(const reg of state.registrations.filter(r=>r.studentId===user.id)){
   const event=state.events.find(e=>e.id===reg.eventId&&e.published);if(!event)continue;
   const days=Math.ceil((Date.parse(event.date)-Date.parse(today))/86400000);
   if(days>=0&&days<=7)add('event-'+event.id+'-'+event.date,'Upcoming event',event.title+' on '+event.date+' at '+event.time+'.','events',event.date);
   if(event.checkInOpen&&!state.attendance.some(a=>a.studentId===user.id&&a.eventId===event.id))add('checkin-'+event.token,'Attendance is open',event.title+': check in now.','attendance');
  }
 }else{
  for(const payment of state.payments.filter(p=>p.status==='Pending'))add('pending-'+payment.id,'Payment awaiting review',payment.feeName+' from '+(state.users.find(u=>u.id===payment.studentId)?.name||'student')+'.','payments',payment.submittedAt);
  if(user.role==='admin'){
   for(const account of state.users.filter(u=>u.status==='pending'))add('approval-'+account.id,'Staff approval requested',account.name+' requested '+account.role+' access.','accounts',account.createdAt);
   for(const request of state.recoveryRequests.filter(r=>r.status==='requested'))add('recovery-'+request.id,'Account recovery requested','Review the identity of '+(state.users.find(u=>u.id===request.userId)?.name||'the account owner')+'.','accounts',request.createdAt);
  }
 }
 for(const note of state.announcements.filter(n=>n.audience==='all'||n.audience===user.role))add(note.id,note.title,note.message,'notifications',note.at);
 return items.sort((a,b)=>String(b.at).localeCompare(String(a.at)));
}
function publicManagement(state,user){
 return {notifications:notifications(state,user),...(user.role!=='student'?{roster:state.roster,auditLog:state.auditLog.slice(-2000).reverse()}:{}),...(user.role==='admin'?{recoveryRequests:state.recoveryRequests.map(({resetHash,...r})=>r)}:{})};
}
function act(state,user,type,p,helpers){
 const {passwordRecord,matches,revoke}=helpers;
 if(type==='importRoster'){
  admin(user);const rows=rosterRows(p.rows);
  for(const row of rows){const existing=state.roster.find(r=>r.schoolId===row.schoolId);Object.assign(existing||{},row);if(!existing)state.roster.push(row);row.importedAt=stamp();row.importedBy=user.id;if(existing)Object.assign(existing,{importedAt:row.importedAt,importedBy:user.id});}
  state.users.filter(u=>u.role==='student').forEach(u=>enrollment(state,u));
  return {handled:true,result:{imported:rows.length}};
 }
 if(type==='accountStatus'){
  admin(user);const account=state.users.find(u=>u.id===p.id);if(!account)error('Account not found.',404);
  if(!['active','disabled'].includes(p.status))error('Choose active or disabled.');
  if(account.id===user.id)error('You cannot change your own account status.');
  if(account.role==='admin'&&p.status!=='active'&&state.users.filter(u=>u.role==='admin'&&u.status==='active').length<=1)error('Keep at least one active administrator.');
  account.status=p.status;account.approvedBy=user.id;account.approvedAt=stamp();revoke(account.id);
  return {handled:true,result:{id:account.id,status:account.status}};
 }
 if(type==='correctStudent'){
  admin(user);const account=state.users.find(u=>u.id===p.id&&u.role==='student');if(!account)error('Student account not found.',404);
  const name=text(p.name,'name',80),email=text(p.email,'email',150).toLowerCase(),schoolId=text(p.schoolId,'Student ID',20).replace(/\s+/g,'');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^\d{4}-\d{4}$/.test(schoolId)||Number(schoolId.slice(0,4))<1900||Number(schoolId.slice(0,4))>new Date().getFullYear())error('Enter a valid email and Student ID.');
  if(state.users.some(u=>u.id!==account.id&&(u.email===email||u.schoolId===schoolId||u.staffCode===schoolId)))error('Email or Student ID is already registered.',409);
  const reason=text(p.note,'correction reason',500);
  Object.assign(account,{name,email,schoolId});enrollment(state,account);revoke(account.id);
  return {handled:true,result:{id:account.id,corrected:true}};
 }
 if(type==='changePassword'){
  if(!matches(p.currentPassword,user.password))error('Current password is incorrect.',403);
  user.password=passwordRecord(p.newPassword);revoke(user.id);
  state.recoveryRequests=state.recoveryRequests.filter(r=>r.userId!==user.id);
  return {handled:true,result:{signedOut:true}};
 }
 if(type==='issueReset'){
  admin(user);const request=state.recoveryRequests.find(r=>r.id===p.id);if(!request)error('Recovery request not found.',404);
  const account=state.users.find(u=>u.id===request.userId&&u.status==='active');if(!account)error('The account must be active.');
  if(account.id===user.id)error('Ask another administrator to verify your identity.');
  text(p.reason,'identity verification note',500);
  const code=crypto.randomBytes(24).toString('base64url');
  state.recoveryRequests.filter(r=>r.userId===account.id).forEach(r=>{r.status='superseded';delete r.resetHash;});
  Object.assign(request,{status:'issued',resetHash:hash(code),expiresAt:Date.now()+15*60*1000,issuedBy:user.id,verificationNote:p.reason.trim()});
  return {handled:true,result:{code,expiresAt:request.expiresAt}};
 }
 if(type==='readNotifications'){
  const available=new Set(notifications(state,user).map(n=>n.id));
  if(!Array.isArray(p.ids)||p.ids.length>10000||p.ids.some(key=>typeof key!=='string'||!available.has(key)))error('Choose valid notifications.');
  user.readNotifications=[...new Set([...user.readNotifications,...p.ids])].slice(-10000);
  return {handled:true,result:{ok:true}};
 }
 if(type==='announce'){
  if(!['admin','officer'].includes(user.role))error('Staff access is required.',403);
  if(!['all','student','officer','admin'].includes(p.audience))error('Choose a valid audience.');
  state.announcements.push({id:id('notice'),title:text(p.title,'title',120),message:text(p.message,'message',1000),audience:p.audience,at:stamp(),createdBy:user.id});
  return {handled:true,result:{ok:true}};
 }
 return {handled:false};
}
function createBackups(dataDir,readState){
 const directory=path.join(dataDir,'backups');fs.mkdirSync(directory,{recursive:true});
 const envelope=state=>{const payload=JSON.stringify(state);return {format:'FEATS-backup',version:1,createdAt:stamp(),checksum:hash(payload),state};};
 const list=()=>fs.readdirSync(directory).filter(name=>/^feats-(auto|manual|before-restore)-[\dTZ.-]+\.json$/.test(name)).map(name=>({name,bytes:fs.statSync(path.join(directory,name)).size})).sort((a,b)=>b.name.localeCompare(a.name));
 function write(kind='manual'){
  const name='feats-'+kind+'-'+stamp().replace(/:/g,'-')+'.json',content=envelope(readState()),target=path.join(directory,name);
  fs.writeFileSync(target+'.tmp',JSON.stringify(content),{mode:0o600});fs.renameSync(target+'.tmp',target);
  const auto=list().filter(item=>item.name.startsWith('feats-auto-')).sort((a,b)=>b.name.localeCompare(a.name));
  for(const item of auto.slice(14))fs.unlinkSync(path.join(directory,item.name));
  return {name,backup:content};
 }
 function auto(){const today=stamp().slice(0,10);if(!list().some(item=>item.name.startsWith('feats-auto-'+today)))write('auto');}
 function load(name){if(!list().some(item=>item.name===name))error('Backup not found.',404);return JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));}
 function validate(backup){
  if(!backup||typeof backup.createdAt!=='string'||Number.isNaN(Date.parse(backup.createdAt))||backup.format!=='FEATS-backup'||backup.version!==1||!backup.state||backup.checksum!==hash(JSON.stringify(backup.state)))error('Invalid backup format or checksum.');
  const state=backup.state,arrays=['users','fees','payments','events','registrations','attendance','roster','auditLog','recoveryRequests','announcements'];
  if(arrays.some(key=>!Array.isArray(state[key]))||!Number.isSafeInteger(state.revision)||!state.paymentChannels||typeof state.paymentChannels!=='object'||Array.isArray(state.paymentChannels))error('Incomplete backup.');
  if(arrays.some(key=>state[key].some(row=>!row||typeof row!=='object'||Array.isArray(row))))error('Invalid backup records.');
  const unique=(rows,key)=>rows.every(row=>row&&typeof row==='object'&&typeof row[key]==='string'&&row[key])&&new Set(rows.map(row=>row[key])).size===rows.length;
  if(!unique(state.users,'id')||!unique(state.users,'email')||state.users.some(u=>!['student','officer','admin'].includes(u.role)||!['active','pending','disabled'].includes(u.status)||typeof u.name!=='string'||!u.name.trim()||!Array.isArray(u.readNotifications)||!u.password||!/^[a-f0-9]{32}$/.test(u.password.salt)||!/^[a-f0-9]{128}$/.test(u.password.hash)))error('Invalid account data in backup.');
  const identifiers=state.users.map(u=>u.schoolId||u.staffCode).filter(Boolean);if(new Set(identifiers).size!==identifiers.length||state.users.some(u=>u.role==='student'&&(!/^\d{4}-\d{4}$/.test(u.schoolId)||!/^STUDENT-[0-9a-f-]{36}$/i.test(u.attendanceToken))))error('Invalid student identity in backup.');
  if(!state.users.some(u=>u.role==='admin'&&u.status==='active'))error('Backup needs an active administrator.');
  const users=new Set(state.users.filter(u=>u.role==='student').map(u=>u.id)),fees=new Set(state.fees.map(f=>f.id)),events=new Set(state.events.map(e=>e.id));
  if(!unique(state.fees,'id')||!unique(state.events,'id')||!unique(state.payments,'id')||!unique(state.attendance,'id'))error('Duplicate record IDs in backup.');
  const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value));
  if(state.fees.some(f=>typeof f.name!=='string'||!Number.isFinite(f.amount)||f.amount<1||!validDay(f.dueDate)||!Array.isArray(f.studentIds)||f.studentIds.some(key=>!users.has(key))))error('Invalid fee data in backup.');
  if(state.events.some(e=>typeof e.title!=='string'||typeof e.description!=='string'||typeof e.venue!=='string'||!validDay(e.date)||typeof e.time!=='string'||typeof e.token!=='string'||typeof e.published!=='boolean'||typeof e.checkInOpen!=='boolean'))error('Invalid event data in backup.');
  if(state.payments.some(p=>!users.has(p.studentId)||typeof p.feeName!=='string'||typeof p.reference!=='string'||!Number.isFinite(p.amount)||p.amount<0||!['Requested','Pending','Paid','Rejected'].includes(p.status)||typeof p.method!=='string'))error('Invalid payment data in backup.');
  if(state.registrations.some(r=>!users.has(r.studentId)||!events.has(r.eventId))||state.attendance.some(a=>!users.has(a.studentId)||!events.has(a.eventId)||typeof a.recordedAt!=='string'))error('Invalid attendance data in backup.');
  if(state.roster.length)rosterRows(state.roster);
  if(state.auditLog.some(r=>typeof r.id!=='string'||typeof r.action!=='string'||typeof r.at!=='string')||state.announcements.some(n=>typeof n.id!=='string'||typeof n.title!=='string'||typeof n.message!=='string'||!['all','student','officer','admin'].includes(n.audience))||state.recoveryRequests.some(r=>typeof r.id!=='string'||typeof r.userId!=='string'))error('Invalid management data in backup.');
  return state;
 }
 return {list,write,auto,load,validate,envelope};
}
function describe(payload){
 const details={};for(const key of ['name','schoolId','title','amount','dueDate','date','time','venue','status','note','course','section','year','audience'])if(['string','number','boolean'].includes(typeof payload[key]))details[key]=payload[key];
 if(Array.isArray(payload.studentIds))details.assignedStudents=payload.studentIds.length;
 return Object.keys(details).length?JSON.stringify(details).slice(0,1500):'';
}
module.exports={describe,migrate,audit,enrollment,rosterRows,notifications,publicManagement,act,createBackups,hash,error};
