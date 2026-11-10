'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const ROOT=__dirname;
const management=require('./management.cjs');
const ROLES=['student','officer','admin'];
const METHODS=['GCash','Maya','Cash'];
const COURSES=['BITM','BSCE','BSIT','BSMRS'];
const YEARS=['1st Year','2nd Year','3rd Year','4th Year','5th Year'];
const EVENT_COVERS=['/assets/events/assembly.svg','/assets/events/leadership.svg','/assets/events/community.svg','/assets/events/campus.svg'];
const MAX_COVER_BYTES=600*1024;
const uid=p=>p+'-'+crypto.randomUUID();
const now=()=>new Date().toISOString();
class RequestError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const fail=(message,status=400)=>{throw new RequestError(message,status);};
function str(value,label,max=200,optional=false){if(optional&&(value===undefined||value===null||value===''))return '';if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail('Enter a valid '+label+'.');return value.trim();}
function validDate(value){str(value,'date',10);if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail('Enter a valid date.');return value;}
function validCourse(value){if(!COURSES.includes(value))fail('Choose a valid course: BITM, BSCE, BSIT, or BSMRS.');return value;}
function validYear(value,optional=false){if(optional&&(value===undefined||value===null||value===''))return '';if(typeof value!=='string'||!YEARS.includes(value))fail('Choose a valid year level.');return value;}
function validSection(value,optional=false){if(optional&&(value===undefined||value===null||value===''))return '';if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,29}$/.test(value.trim()))fail('Enter a valid section.');return value.trim();}
function validCover(value){
 if(value===undefined||value===null||value==='')return '';
 if(EVENT_COVERS.includes(value))return value;
 if(typeof value!=='string'||value.length>Math.ceil(MAX_COVER_BYTES/3)*4+30)fail('Choose a JPEG, PNG, or WebP cover image up to 600 KB.');
 const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 if(!match||match[2].length%4!==0)fail('Choose a valid JPEG, PNG, or WebP cover image.');
 const bytes=Buffer.from(match[2],'base64');
 const isImage=match[1]==='jpeg'?bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff:match[1]==='png'?bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!isImage||bytes.toString('base64')!==match[2]||bytes.length>MAX_COVER_BYTES)fail('Choose a valid JPEG, PNG, or WebP cover image up to 600 KB.');
 return value;
}
function passwordRecord(password){if(typeof password!=='string'||password.length<8||password.length>200)fail('Password must contain 8 to 200 characters.');const salt=crypto.randomBytes(16).toString('hex');return {salt,hash:crypto.scryptSync(password,salt,64).toString('hex')};}
function matches(password,record){if(typeof password!=='string'||password.length>200)return false;const candidate=crypto.scryptSync(password,record.salt,64);return crypto.timingSafeEqual(candidate,Buffer.from(record.hash,'hex'));}
function normalizeStaffCode(value){
 const code=str(value,'staff code',32).toUpperCase();
 if(!/^[A-Z0-9][A-Z0-9_-]{3,31}$/.test(code))fail('Choose a staff code with 4–32 letters, numbers, hyphens, or underscores.');
 return code;
}
function initialState(){return {revision:0,users:[],fees:[],payments:[],events:[{id:'EVT-001',title:'Student Organization General Assembly',date:'2026-10-03',time:'09:00',venue:'University Activity Center',description:'Meet your community and hear what is ahead.',requirements:'Bring your student ID.',published:true,checkInOpen:false,token:uid('QR')},{id:'EVT-002',title:'Leadership & Financial Literacy',date:'2026-10-10',time:'13:00',venue:'AVR Building',description:'Learn to lead with purpose and manage funds responsibly.',requirements:'Student ID and a notebook.',published:true,checkInOpen:false,token:uid('QR')},{id:'EVT-003',title:'Campus Community Day',date:'2026-10-18',time:'08:00',venue:'University Grounds',description:'Connect through organization booths and community activities.',requirements:'Wear your organization shirt.',published:true,checkInOpen:false,token:uid('QR')}],registrations:[],attendance:[],paymentChannels:{}};}
function safeUser(u,includeQr=false){const {password,attendanceToken,readNotifications,...publicUser}=u;return includeQr&&attendanceToken?{...publicUser,attendanceToken}:publicUser;}
function publicPayment(payment){const {proofImage,...record}=payment;return proofImage?{...record,hasProof:true}:record;}
function validProof(value,required){
 if(!value){if(required)fail('Attach a payment screenshot before submitting for verification.');return '';}
 if(typeof value!=='string'||!value.startsWith('data:image/'))fail('Upload a JPG, PNG, or WebP payment screenshot.');
 try{return validCover(value);}catch{fail('Upload a valid JPG, PNG, or WebP payment screenshot up to 600 KB.');}
}
function qrStudent(state,token){
 const code=str(token,'student QR code',100);
 const account=state.users.find(u=>u.role==='student'&&u.attendanceToken===code);
 if(!account)fail('Student QR code was not recognized.',404);return account;
}
function recordAttendance(state,user,event,studentId){
 if(!event.published||!event.checkInOpen)fail('Check-in is closed for this event.');
 if(!state.registrations.some(r=>r.eventId===event.id&&r.studentId===studentId))fail('Register for this event before checking in.');
 if(state.attendance.some(a=>a.eventId===event.id&&a.studentId===studentId))fail('Attendance is already recorded.',409);
 const record={id:uid('attendance'),studentId,eventId:event.id,eventTitle:event.title,recordedAt:now(),recordedBy:user.id};
 state.attendance.unshift(record);return record;
}
function workspace(state,user){
 const student=user.role==='student';
 const payments=state.payments.filter(p=>!student||p.studentId===user.id);
 const staffIds=new Set(payments.map(p=>p.verifiedBy).filter(Boolean));
 return {revision:state.revision,user:safeUser(user,true),
 users:student?[safeUser(user),...state.users.filter(u=>staffIds.has(u.id)&&u.id!==user.id).map(u=>({id:u.id,name:u.name,role:u.role}))]:state.users.map(u=>safeUser(u)),
 fees:state.fees.filter(f=>!student||f.studentIds.includes(user.id)).map(f=>student?{...f,studentIds:[user.id]}:f),
 payments:payments.map(publicPayment),attendance:state.attendance.filter(a=>!student||a.studentId===user.id),
 registrations:state.registrations.filter(r=>!student||r.studentId===user.id),
 events:state.events.filter(e=>!student||e.published).map(e=>{const {capacity,...details}=e;return {...details,token:e.checkInOpen?e.token:'',registrationCount:state.registrations.filter(r=>r.eventId===e.id).length};}),
 ...management.publicManagement(state,user),
 paymentChannels:Object.fromEntries(Object.entries(state.paymentChannels).filter(([method])=>METHODS.includes(method)))};
}
function requireRole(user,role){if(user.role!==role)fail('Your role cannot perform this action.',403);}
function findRecord(list,id,label){const value=list.find(item=>item.id===id);if(!value)fail(label+' not found.',404);return value;}
function activePayment(state,feeId,studentId){return state.payments.some(p=>p.feeId===feeId&&p.studentId===studentId&&['Requested','Pending','Paid'].includes(p.status));}
function channelSnapshot(state,method){return state.paymentChannels[method]?.enabled?{...state.paymentChannels[method]}:null;}
function applyAction(state,user,type,p){
 if(!p||typeof p!=='object'||Array.isArray(p))fail('Invalid action payload.');
 let result=null;
 if(type==='updateCourse'){
  requireRole(user,'student');if(user.enrollmentStatus==='Verified'&&(p.course!==user.course||(p.section!==undefined&&p.section!==user.section)||(p.year!==undefined&&p.year!==user.year)))fail('Your verified details are managed through the official roster. Contact your administrator.');user.course=validCourse(p.course);if(p.section!==undefined)user.section=validSection(p.section,true);if(p.year!==undefined)user.year=validYear(p.year,true);result=safeUser(user,true);
 }else if(type==='saveFee'){
  requireRole(user,'officer');const existing=p.id?findRecord(state.fees,p.id,'Fee'):null;
  const name=str(p.name,'fee name',100),amount=Number(p.amount),dueDate=validDate(p.dueDate);
  if(!Number.isFinite(amount)||amount<1||amount>1000000||Math.abs(Math.round(amount*100)-amount*100)>0.000001)fail('Enter a valid amount with up to two decimal places.');
  if(!Array.isArray(p.studentIds)||!p.studentIds.length||p.studentIds.length>10000)fail('Choose at least one student.');
  let studentIds=[...new Set(p.studentIds)];if(studentIds.some(id=>!state.users.some(u=>u.id===id&&u.role==='student')))fail('Invalid student assignment.');
  const locked=existing&&state.payments.some(t=>t.feeId===existing.id);if(locked&&amount!==existing.amount)fail('The amount is locked because payment tickets exist.');
  if(locked)studentIds=[...new Set([...existing.studentIds,...studentIds])];
  if(existing){Object.assign(existing,{name,amount,dueDate,studentIds});result=existing;}else{result={id:uid('fee'),name,amount,dueDate,studentIds};state.fees.push(result);}
 }else if(type==='createPayment'){
  requireRole(user,'student');const fee=findRecord(state.fees,p.feeId,'Fee');if(!fee.studentIds.includes(user.id))fail('This fee is not assigned to you.',403);
  if(activePayment(state,fee.id,user.id))fail('An active or paid ticket already exists for this fee.',409);
  if(!METHODS.includes(p.method))fail('Invalid payment method.');const requestOnly=p.requestOnly===true;
  const externalReference=str(p.externalReference,'payment reference',120,requestOnly||p.method!=='Cash');
  const proofImage=requestOnly?'':validProof(p.proofImage,p.method!=='Cash');
  const payment={id:uid('payment'),studentId:user.id,feeId:fee.id,feeName:fee.name,amount:fee.amount,method:p.method,...(proofImage?{proofImage}:{}),destination:channelSnapshot(state,p.method),externalReference:requestOnly?'':externalReference,reference:uid('FEATS').toUpperCase(),status:requestOnly?'Requested':'Pending',createdAt:now()};
  if(!requestOnly)payment.submittedAt=now();state.payments.unshift(payment);result=payment;
 }else if(type==='submitPayment'){
  requireRole(user,'student');const payment=findRecord(state.payments,p.id,'Ticket');if(payment.studentId!==user.id)fail('This ticket belongs to another student.',403);if(payment.status!=='Requested')fail('Only requested tickets can be submitted.',409);
  if(!METHODS.includes(p.method))fail('Invalid payment method.');const reference=str(p.externalReference,'payment reference',120,p.method!=='Cash'),proofImage=validProof(p.proofImage,p.method!=='Cash');
  const destination=p.method===payment.method?payment.destination||channelSnapshot(state,p.method):channelSnapshot(state,p.method);
  Object.assign(payment,{method:p.method,destination,...(proofImage?{proofImage}:{}),externalReference:reference,status:'Pending',submittedAt:now()});result=payment;
 }else if(type==='verifyPayment'){
  requireRole(user,'officer');const payment=findRecord(state.payments,p.id,'Ticket');if(payment.status!=='Pending')fail('Only pending payments can be reviewed.',409);if(!['Paid','Rejected'].includes(p.status))fail('Invalid verification status.');
  Object.assign(payment,{status:p.status,note:str(p.note,'verification note',500),verifiedBy:user.id,verifiedAt:now()});
  if(p.status==='Paid'){
   const account=findRecord(state.users,payment.studentId,'Student');
   payment.receipt={number:uid('RCT').toUpperCase(),issuedAt:payment.verifiedAt,issuedBy:user.id,officerName:user.name,studentName:account.name,schoolId:account.schoolId||'',course:account.course||'',feeName:payment.feeName,amount:payment.amount,method:payment.method,transactionReference:payment.reference,externalReference:payment.externalReference||'',note:payment.note};
  }
  result=payment;
 }else if(type==='saveEvent'){
  requireRole(user,'officer');const event=p.id?findRecord(state.events,p.id,'Event'):null;
  const details={title:str(p.title,'event title',120),date:validDate(p.date),time:str(p.time,'event time',5),venue:str(p.venue,'venue',150),description:str(p.description,'description',1000),requirements:str(p.requirements,'requirements',300,true),published:p.published};
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(details.time)||typeof details.published!=='boolean')fail('Invalid event schedule or visibility.');
  if(p.coverImage!==undefined||!event)details.coverImage=validCover(p.coverImage);
  if(event){Object.assign(event,details);delete event.capacity;if(!event.published)event.checkInOpen=false;result=event;}else{result={id:uid('EVT'),...details,token:uid('QR'),checkInOpen:false};state.events.push(result);}
 }else if(type==='register'){
  requireRole(user,'student');const event=findRecord(state.events,p.eventId,'Event');if(!event.published)fail('This event is not published.',403);
  const records=state.registrations.filter(r=>r.eventId===event.id);if(records.some(r=>r.studentId===user.id))fail('You are already registered.',409);
  state.registrations.push({eventId:event.id,studentId:user.id,createdAt:now()});
 }else if(type==='toggleCheckIn'){
  requireRole(user,'officer');const event=findRecord(state.events,p.eventId,'Event');if(!event.published)fail('Publish the event before opening check-in.');event.checkInOpen=!event.checkInOpen;if(event.checkInOpen)event.token=uid('QR');
 }else if(type==='checkIn'){
  if(!['student','officer'].includes(user.role))fail('Your account has monitoring access only.',403);
  const studentId=user.role==='student'?user.id:p.studentId;if(!state.users.some(u=>u.id===studentId&&u.role==='student'))fail('Choose a student.');
  const code=str(p.code,'event check-in code',200),event=state.events.find(e=>e.token===code&&e.published&&e.checkInOpen);if(!event)fail('Invalid code or check-in is closed.');
  result=recordAttendance(state,user,event,studentId);
 }else if(type==='checkInStudent'){
  requireRole(user,'officer');const account=qrStudent(state,p.token),event=findRecord(state.events,p.eventId,'Event');
  result=recordAttendance(state,user,event,account.id);
 }else if(type==='saveChannels'){
  requireRole(user,'officer');if(!p.channels||typeof p.channels!=='object')fail('Invalid payment channels.');const channels={};
  for(const method of METHODS){const c=p.channels[method]||{},enabled=c.enabled===true;channels[method]={enabled,name:str(c.name,'receiving account name',100,!enabled),account:str(c.account,'account number or location',120,!enabled),instructions:str(c.instructions,'payment instructions',500,true),updatedBy:user.id,updatedAt:now()};}state.paymentChannels=channels;
 }else fail('Unknown action.',404);
 return result;
}
function createServer(options={}){
 const dataDir=path.resolve(options.dataDir||process.env.FEATS_DATA_DIR||path.join(ROOT,'data'));fs.mkdirSync(dataDir,{recursive:true});
 const database=new DatabaseSync(path.join(dataDir,'feats.sqlite'));database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL);');
 database.prepare('INSERT OR IGNORE INTO workspace(id,json) VALUES(1,?)').run(JSON.stringify(initialState()));
 const readState=()=>JSON.parse(database.prepare('SELECT json FROM workspace WHERE id=1').get().json);
 const saveState=state=>{state.revision++;database.prepare('UPDATE workspace SET json=? WHERE id=1').run(JSON.stringify(state));};
 // Give existing students a stable personal QR without replacing their records.
 const migration=readState();let changed=management.migrate(migration);for(const account of migration.users){if(account.role==='student'&&!account.attendanceToken){account.attendanceToken=uid('STUDENT');changed=true;}}if(changed)saveState(migration);
 const backups=management.createBackups(dataDir,readState);
 let backupError='';
 const automaticBackup=()=>{try{backups.auto();backupError='';}catch(error){backupError='Automatic backup failed. Check server disk permissions and free space.';console.error(backupError);}};
 automaticBackup();
 const backupTimer=setInterval(automaticBackup,60*60*1000);backupTimer.unref();
 const setupFile=path.join(dataDir,'admin-setup.json');
 if(!readState().users.some(u=>u.role==='admin'&&u.status==='active')&&!fs.existsSync(setupFile))fs.writeFileSync(setupFile,JSON.stringify({code:crypto.randomBytes(24).toString('base64url')}),{mode:0o600});
 const revoke=userId=>database.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
 const hashToken=token=>crypto.createHash('sha256').update(token).digest('hex');
 const cookieToken=req=>{const value=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('feats_session='));return value?.slice('feats_session='.length)||'';};
 function sessionUser(req,state){const token=cookieToken(req);if(!token)return null;const session=database.prepare('SELECT user_id,expires FROM sessions WHERE token=?').get(hashToken(token));if(!session||session.expires<Date.now())return null;return state.users.find(u=>u.id===session.user_id&&u.status==='active')||null;}
 function issueSession(req,res,user){const old=cookieToken(req);if(old)database.prepare('DELETE FROM sessions WHERE token=?').run(hashToken(old));const token=crypto.randomBytes(32).toString('hex');database.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').run(hashToken(token),user.id,Date.now()+12*60*60*1000);const secure=options.secureCookies||process.env.FEATS_SECURE_COOKIES==='1';res.setHeader('Set-Cookie',`feats_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure?'; Secure':''}`);}
 function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
 async function body(req,maxBytes=1024*1024){
  if(!(req.headers['content-type']||'').startsWith('application/json'))fail('JSON request body required.',415);
  const text=await new Promise((resolve,reject)=>{const chunks=[];let size=0,oversized=false;
   req.on('data',chunk=>{if(oversized)return;const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>maxBytes){oversized=true;chunks.length=0;reject(new RequestError('Request is too large.',413));return;}chunks.push(bytes);});
   req.on('end',()=>{if(!oversized)resolve(Buffer.concat(chunks,size).toString('utf8'));});req.on('error',reject);req.on('aborted',()=>reject(new RequestError('Incomplete request body.')));
  });
  try{const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))fail('Invalid JSON object.');return value;}catch(error){if(error instanceof RequestError)throw error;fail('Invalid JSON.');}
 }
 const limits=new Map();function authLimit(req){const ip=req.socket.remoteAddress||'unknown',time=Date.now();let limit=limits.get(ip);if(!limit||time-limit.start>60000)limit={start:time,count:0};if(++limit.count>40)fail('Too many attempts. Please wait a minute.',429);limits.set(ip,limit);if(limits.size>1000)for(const [key,item] of limits)if(time-item.start>60000)limits.delete(key);}
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
  try{
   const url=new URL(req.url,'http://localhost'),route=url.pathname;
   if(req.method==='POST'){
    if(req.headers['sec-fetch-site']==='cross-site')fail('Cross-site requests are not accepted.',403);
    const origin=req.headers.origin;
    if(origin){let parsed;try{parsed=new URL(origin);}catch{fail('Invalid origin.',403);}if(parsed.host!==req.headers.host||!['http:','https:'].includes(parsed.protocol))fail('Cross-origin requests are not accepted.',403);}
   }
   if(route==='/api/health'&&req.method==='GET')return json(res,200,{ok:true,staffSignup:'personal-code',studentCourses:true,eventCovers:true,unlimitedRegistrations:true,studentQr:true,paymentProof:true,issuedReceipts:true,managementVersion:1,approvalRequired:true,bootstrapRequired:!readState().users.some(u=>u.role==='admin'&&u.status==='active')});
   if(route==='/api/session'&&req.method==='GET'){const user=sessionUser(req,readState());return json(res,200,{user:user?safeUser(user,true):null});}
   if(route==='/api/signup'&&req.method==='POST'){
    authLimit(req);const p=await body(req),role=p.role;if(!ROLES.includes(role))fail('Choose a valid role.');
    const name=str(p.name,'name',80),email=str(p.email,'email',150).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Enter a valid email address.');
    const staffCode=role==='student'?undefined:normalizeStaffCode(p.staffCode);
    let schoolId,course,section,yearLevel;if(role==='student'){schoolId=str(p.schoolId,'Student ID',20).replace(/\s+/g,'');const year=Number(schoolId.slice(0,4));if(!/^\d{4}-\d{4}$/.test(schoolId)||year<1900||year>new Date().getFullYear())fail('Enter a valid Student ID: xxxx - xxxx.');course=validCourse(p.course);section=validSection(p.section,true);yearLevel=validYear(p.year,true);}
    const password=passwordRecord(p.password);database.exec('BEGIN IMMEDIATE');let user;
    try{
     const state=readState();
     if(state.users.some(u=>u.email===email))fail('This email is already registered. Log in or use a different email for a new account.',409);
     const identifier=staffCode||schoolId;
     if(state.users.some(u=>u.schoolId===identifier||u.staffCode===identifier))fail((staffCode?'Staff code':'Student ID')+' is already registered. Choose a unique code or log in to your account.',409);
     const firstAdmin=role==='admin'&&!state.users.some(u=>u.role==='admin'&&u.status==='active');
     if(firstAdmin){let setup;try{setup=JSON.parse(fs.readFileSync(setupFile,'utf8'));}catch{}if(!setup||typeof p.setupCode!=='string'||management.hash(p.setupCode)!==management.hash(setup.code))fail('Enter the administrator setup code from data/admin-setup.json on the server computer.',403);}
     user={id:uid(role),name,email,role,password,status:role==='student'||firstAdmin?'active':'pending',readNotifications:[],...(schoolId?{schoolId,course,section,year:yearLevel,attendanceToken:uid('STUDENT'),enrollmentStatus:'Unverified'}:{staffCode}),createdAt:now()};if(role==='student'){management.enrollment(state,user);if(state.roster.some(row=>row.schoolId===schoolId)&&user.enrollmentStatus!=='Verified')fail('Student details do not match an active official roster entry. Contact your administrator.',403);}state.users.push(user);management.audit(state,user,'signup',user.id,user.status==='pending'?'Awaiting administrator approval':'Account created');saveState(state);database.exec('COMMIT');
    }catch(error){database.exec('ROLLBACK');throw error;}
    if(user.status==='active')issueSession(req,res,user);return json(res,201,{user:safeUser(user,true)});
   }
   if(route==='/api/login'&&req.method==='POST'){
    authLimit(req);const p=await body(req),identifier=str(p.identifier,'email, Student ID, or staff code',150);const state=readState(),user=state.users.find(u=>u.email===identifier.toLowerCase()||u.schoolId===identifier.replace(/\s+/g,'')||u.staffCode===identifier.toUpperCase());
    if(!user||!matches(p.password,user.password))fail('Incorrect email / ID / staff code or password.',401);if(p.role!==user.role)fail('Select the correct account role.',403);if(user.status!=='active')fail(user.status==='pending'?'Your staff account is waiting for administrator approval.':'This account is disabled. Contact your administrator.',403);management.audit(state,user,'login',user.id);saveState(state);issueSession(req,res,user);return json(res,200,{user:safeUser(user,true)});
   }
   if(route==='/api/recovery/request'&&req.method==='POST'){
    authLimit(req);const p=await body(req),identifier=str(p.identifier,'account email or ID',150),state=readState();
    const account=state.users.find(u=>u.email===identifier.toLowerCase()||u.schoolId===identifier.replace(/\s+/g,'')||u.staffCode===identifier.toUpperCase());
    if(account&&account.status==='active'){
     const existing=state.recoveryRequests.find(r=>r.userId===account.id&&['requested','issued'].includes(r.status));
     if(!existing){state.recoveryRequests.push({id:uid('recovery'),userId:account.id,status:'requested',createdAt:now()});management.audit(state,null,'requestRecovery',account.id);saveState(state);}
    }
    return json(res,200,{message:'If this account is active, an administrator can review your request. Contact them to verify your identity and receive a reset code.'});
   }
   if(route==='/api/recovery/reset'&&req.method==='POST'){
    authLimit(req);const p=await body(req);str(p.code,'reset code',100);const replacement=passwordRecord(p.password),state=readState();
    const request=state.recoveryRequests.find(r=>r.status==='issued'&&r.expiresAt>Date.now()&&r.resetHash===hashToken(p.code));
    const account=request&&state.users.find(u=>u.id===request.userId&&u.status==='active');if(!account)fail('This reset code is invalid or expired.',400);
    account.password=replacement;request.status='used';delete request.resetHash;revoke(account.id);management.audit(state,account,'resetPassword',account.id);saveState(state);
    return json(res,200,{ok:true});
   }
   if(route==='/api/roster/preview'&&req.method==='POST'){
    const p=await body(req,5*1024*1024),state=readState(),user=sessionUser(req,state);if(!user)fail('Please log in.',401);requireRole(user,'admin');
    const rows=management.rosterRows(p.rows);return json(res,200,{rows,existing:rows.filter(row=>state.roster.some(old=>old.schoolId===row.schoolId)).length});
   }
   if(route==='/api/backups'&&req.method==='GET'){
    const state=readState(),user=sessionUser(req,state);if(!user)fail('Please log in.',401);requireRole(user,'admin');return json(res,200,{backups:backups.list(),warning:backupError});
   }
   if(route.startsWith('/api/backups/')&&req.method==='POST'){
    authLimit(req);const p=await body(req,64*1024*1024),state=readState(),user=sessionUser(req,state);if(!user)fail('Please log in.',401);requireRole(user,'admin');
    if(!matches(p.password,user.password))fail('Re-enter your current password.',403);
    if(route==='/api/backups/create'){
     const result=backups.write('manual');management.audit(state,user,'createBackup',result.name);saveState(state);return json(res,200,result);
    }
    if(route==='/api/backups/download'){const backup=backups.load(p.name);management.audit(state,user,'downloadBackup',p.name);saveState(state);return json(res,200,{name:p.name,backup});}
    if(route==='/api/backups/validate'||route==='/api/backups/restore'){
     const backup=p.backup||backups.load(p.name),restored=backups.validate(backup);for(const event of restored.events)if(event.coverImage)validCover(event.coverImage);for(const payment of restored.payments)if(payment.proofImage)validProof(payment.proofImage,false);
     if(!restored.users.some(u=>u.id===user.id&&u.role==='admin'&&u.status==='active'))fail('This backup must contain your active administrator account.');
     const counts={users:restored.users.length,fees:restored.fees.length,payments:restored.payments.length,events:restored.events.length,attendance:restored.attendance.length};
     if(route.endsWith('/validate'))return json(res,200,{counts,createdAt:backup.createdAt});
     if(p.confirm!=='RESTORE')fail('Type RESTORE to confirm replacement of the current records.');
     const safety=backups.write('before-restore');
     restored.auditLog=[...new Map([...restored.auditLog,...state.auditLog].map(entry=>[entry.id,entry])).values()].sort((a,b)=>a.at.localeCompare(b.at));
     restored.recoveryRequests=[];restored.revision=Math.max(state.revision,restored.revision);
     management.audit(restored,user,'restoreBackup',safety.name,'Pre-restore snapshot saved; all sessions revoked');
     database.exec('BEGIN IMMEDIATE');try{saveState(restored);database.exec('DELETE FROM sessions');database.exec('COMMIT');}catch(error){database.exec('ROLLBACK');throw error;}
     return json(res,200,{ok:true,safetyBackup:safety.name});
    }
    fail('Endpoint not found.',404);
   }
   if(route==='/api/logout'&&req.method==='POST'){await body(req);const token=cookieToken(req);if(token)database.prepare('DELETE FROM sessions WHERE token=?').run(hashToken(token));res.setHeader('Set-Cookie','feats_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true});}
   if(route==='/api/workspace'&&req.method==='GET'){const state=readState(),user=sessionUser(req,state);if(!user)fail('Please log in.',401);return json(res,200,workspace(state,user));}
   if(route==='/api/student-qr'&&req.method==='POST'){
    const p=await body(req),state=readState(),user=sessionUser(req,state);if(!user)fail('Please log in.',401);requireRole(user,'officer');
    return json(res,200,{student:safeUser(qrStudent(state,p.token))});
   }
   const proofRoute=/^\/api\/payments\/([^/]+)\/proof$/.exec(route);
   if(proofRoute&&req.method==='GET'){
    const state=readState(),user=sessionUser(req,state);if(!user)fail('Please log in.',401);
    const payment=findRecord(state.payments,proofRoute[1],'Payment');
    if(user.role==='student'&&payment.studentId!==user.id)fail('This payment belongs to another student.',403);
    if(!payment.proofImage)fail('No screenshot attached.',404);
    const [header,encoded]=payment.proofImage.split(',');
    res.writeHead(200,{'Content-Type':header.slice(5).split(';')[0],'Cache-Control':'no-store','Content-Disposition':'inline'});return res.end(Buffer.from(encoded,'base64'));
   }
   if((route==='/api/actions'||route==='/api/roster/import')&&req.method==='POST'){
    const p=await body(req,route==='/api/roster/import'?5*1024*1024:1024*1024);if(route==='/api/roster/import'&&p.type!=='importRoster')fail('Invalid roster action.');database.exec('BEGIN IMMEDIATE');let response;
    try{const state=readState(),user=sessionUser(req,state);if(!user)fail('Please log in.',401);if(p.userId&&p.userId!==user.id)fail('This browser is signed in to another account. Refresh records before saving.',409);if(!p.payload||typeof p.payload!=='object'||Array.isArray(p.payload))fail('Invalid action payload.');if(p.type==='changePassword')authLimit(req);const handled=management.act(state,user,p.type,p.payload,{passwordRecord,matches,revoke});const result=handled.handled?handled.result:applyAction(state,user,p.type,p.payload);if(p.type!=='readNotifications')management.audit(state,user,p.type,p.payload.id||p.payload.eventId||p.payload.feeId||result?.id||'',p.type==='issueReset'?'Identity verified; one-time reset code issued':p.type==='importRoster'?'Imported '+result.imported+' roster entries':management.describe(p.payload));saveState(state);response={workspace:workspace(state,user),result:result?.proofImage?publicPayment(result):result};database.exec('COMMIT');}catch(error){database.exec('ROLLBACK');throw error;}
    return json(res,200,response);
   }
   if(route.startsWith('/api/'))fail('Endpoint not found.',404);
   if(req.method!=='GET'&&req.method!=='HEAD')fail('Method not allowed.',405);
   const assets={'/assets/vendor/exceljs.min.js':['assets/vendor/exceljs.min.js','text/javascript'],'/assets/vendor/qrcode.min.js':['assets/vendor/qrcode.min.js','text/javascript'],'/assets/vendor/jsQR.js':['assets/vendor/jsQR.js','text/javascript'],'/':['index.html','text/html'],'/index.html':['index.html','text/html'],'/style.css':['style.css','text/css'],'/script.js':['script.js','text/javascript'],'/management.js':['management.js','text/javascript'],'/feats-logo.png':['feats-logo.png','image/png'],'/assets/payments/gcash.png':['assets/payments/gcash.png','image/png'],'/assets/payments/maya.png':['assets/payments/maya.png','image/png'],...Object.fromEntries(EVENT_COVERS.map(cover=>[cover,[cover.slice(1),'image/svg+xml']]))};const asset=assets[route];if(!asset)fail('Not found.',404);
   res.writeHead(200,{'Content-Type':asset[1]+(asset[1].startsWith('text/')?'; charset=utf-8':''),'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:fs.readFileSync(path.join(ROOT,asset[0])));
  }catch(error){if(!res.headersSent)json(res,error.status||500,{error:error.status?error.message:'The server could not complete the request.'});else res.end();if(!error.status)console.error('Request failed:',error.name,error.code||'internal error');}
 });
 server.on('close',()=>{clearInterval(backupTimer);database.close();});server.feats={dataDir};return server;
}
module.exports={createServer};
if(require.main===module){
 if(process.argv.includes('--show-setup-codes'))console.log('Staff codes are now chosen per account on the Sign up page. No generated access code is needed.');
 else{const server=createServer(),port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';server.listen(port,host,()=>{console.log(`FEATS shared server: http://${host}:${port}`);console.log('Sign up as Student, Officer, or Adviser. Staff choose their own unique code and password.');});}
}
