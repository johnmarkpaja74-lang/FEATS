'use strict';
// Shared server enforces sessions, role permissions, and record ownership.
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(n);
const date=v=>v?new Date(v.length===10?v+'T00:00:00':v).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}):'—';
const roleNames={student:'Student',officer:'Officer / Authorized Collector',admin:'Adviser / Administrator'};
const courses={BITM:'Bachelor of Industrial Technology and Management',BSCE:'Bachelor of Science Civil Engineering',BSIT:'Bachelor of Science Information Technology',BSMRS:'Bachelor Science on Mathematics and Research Statistics'};
const yearLevels=['1st Year','2nd Year','3rd Year','4th Year','5th Year'];
const paymentMethods=['GCash','Maya','Cash'];
const courseOptions=selected=>'<option value="">Select your course</option>'+Object.entries(courses).map(([code,name])=>`<option value="${code}" ${selected===code?'selected':''}>${code} - ${name}</option>`).join('');
const emptyWorkspace=()=>({users:[],fees:[],payments:[],events:[],registrations:[],attendance:[],notifications:[],roster:[],auditLog:[],recoveryRequests:[],paymentChannels:{},revision:-1});
let db=emptyWorkspace();
let currentUser=null,page='dashboard',authMode='login',stream=null,scanTimer=null,scannerGeneration=0,toastTimer=null;
let syncBusy=false,mutationBusy=false,sessionGeneration=0;
async function api(path,body){
 let response;
 try{response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}catch{setConnection(false);throw Error('Cannot reach the shared server. Run npm start and open http://localhost:3000.');}
 const data=await response.json().catch(()=>({error:'Invalid server response.'}));
 if(!response.ok){const error=Error(data.error||'The request could not be completed.');error.status=response.status;throw error;}
 setConnection(true);$('serverNotice').hidden=true;return data;
}
function setConnection(online){const el=$('connectionStatus');if(el){el.textContent=online?'● Connected to shared server':'● Server unavailable';el.classList.toggle('offline',!online);}}
function applyWorkspace(next){db=next;if(currentUser&&next.user?.id===currentUser.id)currentUser=next.user;}
async function saveAction(type,payload,{message='',ticket=false,receipt=false}={}){
 if(mutationBusy)return null;mutationBusy=true;
 const generation=sessionGeneration;
 const buttons=[...document.querySelectorAll('#modal button,#content button[data-action]')].map(button=>({button,disabled:button.disabled}));buttons.forEach(({button})=>button.disabled=true);
 try{const data=await api(type==='importRoster'?'roster/import':'actions',{type,payload,userId:currentUser.id});if(generation!==sessionGeneration)return null;applyWorkspace(data.workspace);$('modal').close();render();if(ticket){const payment=data.result?.payment||data.result;if(payment?.id)ticketModal(payment.id);}if(receipt&&data.result?.status==='Paid')receiptModal(data.result.id);if(message)toast(message);return data;}
 catch(error){if(error.status===401)showSignedOut();toast(error.message);return null;}
 finally{mutationBusy=false;buttons.forEach(({button,disabled})=>button.disabled=disabled);}
}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
function authorized(role){if(!currentUser||currentUser.role!==role){toast('This action is not available for your account.');return false;}return true;}
const student=()=>currentUser?.role==='student',officer=()=>currentUser?.role==='officer';
const userName=id=>db.users.find(u=>u.id===id)?.name||'Unknown student';
const visiblePayments=()=>db.payments.filter(p=>!student()||p.studentId===currentUser.id);
const visibleAttendance=()=>db.attendance.filter(a=>!student()||a.studentId===currentUser.id);
const visibleFees=()=>db.fees.filter(f=>!student()||f.studentIds.includes(currentUser.id));
const visibleEvents=()=>db.events.filter(e=>!student()||e.published);
function feeStatus(fee,id){const records=db.payments.filter(p=>p.feeId===fee.id&&p.studentId===id);return records.some(p=>p.status==='Paid')?'Paid':records.some(p=>p.status==='Pending')?'Pending':records.some(p=>p.status==='Requested')?'Requested':'Unpaid';}
const badge=s=>`<span class="badge ${esc(s.toLowerCase())}">${esc(s)}</span>`;
const empty=m=>`<div class="empty"><span class="empty-icon">${icon('reports')}</span><strong>${m}</strong><span>Records will appear here as activity is recorded.</span></div>`;
const action=(name,text,id='',cls='')=>`<button class="${cls}" data-action="${name}" data-id="${esc(id)}">${text}</button>`;
function heading(k,t,d,b=''){return `<div class="heading"><div><span class="eyebrow">${k}</span><h1>${t}</h1><p>${d}</p></div><div class="actions">${b}</div></div>`;}
const recordQueries=new Map();
const recordFilters=new Map();
let paymentStatus='';
const normalizeSearch=value=>value.toLowerCase().replace(/\s*-\s*/g,'-').replace(/\s+/g,' ').trim();
function studentIdCells(id){const account=db.users.find(u=>u.id===id);return `<td>${esc(account?.name||'Unknown student')}</td><td class="student-id-cell">${esc(account?.schoolId||'Not provided')}</td><td title="${esc(courses[account?.course]||'')}">${esc(account?.course||'Not selected')}</td><td>${esc(account?.section||'Not set')}</td><td>${esc(account?.year||'Not set')}</td>`;}
function studentIdentity(id){const account=db.users.find(u=>u.id===id);return `${esc(account?.name||'Unknown student')}<small class="student-id">${esc(account?.schoolId||'School ID not provided')} · ${esc(account?.course||'Course not selected')} · ${esc(account?.section||'Section not set')} · ${esc(account?.year||'Year not set')}</small>`;}
function recordGroupFilters(headers,key){
 if(student()||!['Course','Section','Year'].every(name=>headers.includes(name)))return '';
 const selected=recordFilters.get(key)||{};
 const roster=db.users.filter(user=>user.role==='student');
 const definitions=[['course','Course',Object.keys(courses),'Not selected'],['section','Section',[],'Not set'],['year','Year',yearLevels,'Not set']];
 if(headers.includes('Status'))definitions.push(['status','Status',headers.includes('Event')?['Present','Not checked in','Not registered']:['Unpaid','Requested','Pending','Paid','Rejected'],'']);
 if(headers.includes('Fee'))definitions.push(['fee','Fee',visibleFees().map(f=>f.name),'']);
 if(headers.includes('Event'))definitions.push(['event','Event',visibleEvents().map(e=>e.title),'']);
 const controls=definitions.map(([field,label,defaults,missing])=>{
  const values=[...new Set([...defaults,...(['course','section','year'].includes(field)?roster.map(user=>user[field]||missing):[]),...(selected[field]?[selected[field]]:[])])].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  return `<label>${label}<select data-record-filter="${field}" data-column="${headers.indexOf(label)}" aria-label="Filter records by ${label.toLowerCase()}"><option value="">All ${field==='year'?'year levels':field==='course'?'courses':field==='section'?'sections':field==='status'?'statuses':field==='fee'?'fees':'events'}</option>${values.map(value=>`<option value="${esc(value)}" ${selected[field]===value?'selected':''}>${esc(value)}</option>`).join('')}</select></label>`;
 }).join('');
 const dateControls=headers.some(name=>['Due','Due date','Reference / date','Event'].includes(name))?`<label>From date<input type="date" data-record-date="from" value="${esc(selected.from||'')}"></label><label>Through date<input type="date" data-record-date="through" value="${esc(selected.through||'')}"></label>`:'';
 return `<div class="record-group-filters" aria-label="Student group filters">${controls}${dateControls}<button type="button" data-clear-record-filters>Clear search &amp; group filters</button></div><p class="record-group-summary" role="status"></p>`;
}
function table(headers,rows){
 const key=page+'-'+headers.join('-');
 const ownId=student()?db.users.find(u=>u.id===currentUser.id)?.schoolId||'':'';
 return `<section class="records-block" data-record-key="${esc(key)}"><div class="records-tools"><label class="records-search"><span>${icon('search')}</span><input type="search" data-record-search aria-label="Search ${esc(headers.join(', '))} records by School ID or keyword" placeholder="${student()?'Search Student ID, name, or record…':'Search Student ID, name, or record…'}" value="${esc(recordQueries.get(key)||'')}"></label><span class="records-count" aria-live="polite">${rows.length} records</span><button type="button" data-export-table>Export visible CSV</button></div>${recordGroupFilters(headers,key)}<div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable records"><table><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(row=>row.replace('<tr',`<tr data-own-id="${esc(ownId)}"`)).join(''):`<tr data-empty><td colspan="${headers.length}">${empty('No records to show yet.')}</td></tr>`}<tr data-no-match hidden><td colspan="${headers.length}"><div class="empty"><strong>No matching records.</strong><span>Try another search or choose All courses, sections, and year levels.</span></div></td></tr></tbody></table></div><small class="records-scroll-hint">Scroll inside the table to see more records or columns.</small></section>`;
}
function applyRecordSearch(block){
 const input=block.querySelector('[data-record-search]');if(!input)return;
 const query=normalizeSearch(input.value);recordQueries.set(block.dataset.recordKey,input.value);
 const filters=[...block.querySelectorAll('[data-record-filter]')];
 const dates=[...block.querySelectorAll('input[data-record-date]')];
 recordFilters.set(block.dataset.recordKey,Object.fromEntries([...filters.map(select=>[select.dataset.recordFilter,select.value]),...dates.map(input=>[input.dataset.recordDate,input.value])]));
 const rows=[...block.querySelectorAll('tbody>tr:not([data-empty]):not([data-no-match])')];let shown=0;
 for(const row of rows){const match=dates.every(input=>!input.value||(input.dataset.recordDate==='from'?row.dataset.recordDate>=input.value:row.dataset.recordDate<=input.value))&&filters.every(select=>!select.value||row.cells[Number(select.dataset.column)]?.textContent.trim()===select.value)&&query.split(' ').every(term=>normalizeSearch([...row.cells].map(cell=>cell.textContent).join(' ')+' '+(row.dataset.ownId||'')+' '+(row.dataset.search||'')).includes(term));row.hidden=!match;if(match)shown++;}
 block.querySelector('.records-count').textContent=`${shown} of ${rows.length} records`;
 block.querySelector('[data-no-match]').hidden=!rows.length||shown>0;
 const summary=block.querySelector('.record-group-summary');
 if(summary){
  const visible=rows.filter(row=>!row.hidden),headers=[...block.querySelectorAll('thead th')].map(cell=>cell.textContent);
  const idColumn=headers.indexOf('Student ID'),students=new Set(visible.map(row=>row.cells[idColumn].textContent)).size;
  if(headers.includes('Method')){
   const paid=visible.filter(row=>row.dataset.status==='Paid');
   summary.textContent=`Matching records: ${students} student(s) | ${paid.length} verified payment(s) | ${money(paid.reduce((total,row)=>total+Number(row.dataset.amount||0),0))} paid. Requested, pending, and rejected tickets are excluded from the paid total.`;
  }else if(headers.includes('Event')){const present=visible.filter(row=>row.cells[headers.indexOf('Status')]?.textContent.trim()==='Present');summary.textContent=`Matching attendance: ${present.length} check-in(s) from ${new Set(present.map(row=>row.cells[idColumn].textContent)).size} student(s). ${visible.length} matching record(s) in the list.`;}
  else summary.textContent=`${headers.includes('Fee')?'Matching fee assignments':'Matching students'}: ${visible.length} record(s) for ${students} student(s).`;
 }
}
function refreshRecordSearch(){document.querySelectorAll('.records-block').forEach(applyRecordSearch);}
const iconPaths = {
 search:'M21 21l-5-5 M18 10a8 8 0 1 0-16 0 8 8 0 0 0 16 0',
 dashboard:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
 wallet:'M20 8V5H5a2 2 0 0 0 0 4h16v11H5a2 2 0 0 1-2-2V7 M21 12h-6v5h6 M17 14.5h.01',
 receipt:'M6 3l2 2 2-2 2 2 2-2 2 2 2-2v18l-2-2-2 2-2-2-2 2-2-2-2 2V3 M9 9h6 M9 13h6 M9 17h3',
 calendar:'M4 5h16v16H4z M8 3v4 M16 3v4 M4 11h16 M8 15h2 M14 15h2',
 qr:'M3 3h6v6H3z M15 3h6v6h-6z M3 15h6v6H3z M15 15h2v2h4v4h-6v-2 M21 12v2 M12 3v3 M12 12h3 M3 12h4 M12 18v3',
 reports:'M4 3v18h17 M8 16v-5 M13 16V7 M18 16v-8',
 student:'M2 9l10-6 10 6-10 6-10-6 M6 12v6c4 3 8 3 12 0v-6 M22 9v8',
 users:'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M2 21v-3a7 7 0 0 1 14 0v3 M17 4a4 4 0 0 1 0 7 M20 21v-3a6 6 0 0 0-2-4',
 shield:'M12 3l8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3 M8 12l3 3 5-6',
 arrow:'M4 12h16 M14 6l6 6-6 6',back:'M20 12H4 M10 6l-6 6 6 6',check:'M5 12l4 4L19 6',
 mail:'M3 5h18v14H3z M3 6l9 7 9-7',lock:'M5 10h14v11H5z M8 10V7a4 4 0 0 1 8 0v3 M12 14v3',
 eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0',
 logout:'M9 4H4v16h5 M9 12h12 M16 7l5 5-5 5',menu:'M4 6h16 M4 12h16 M4 18h16',close:'M6 6l12 12 M18 6L6 18',clock:'M12 8v5l3 2 M22 12a10 10 0 1 0-20 0 10 10 0 0 0 20 0',pin:'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0 M15 10a3 3 0 1 0-6 0 3 3 0 0 0 6 0'
};
function icon(name){return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${iconPaths[name]||iconPaths.dashboard}"/></svg>`;}
function hydrateIcons(){document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));}
function selectedRole(){return document.querySelector('[name="accountRole"]:checked').value;}
function updateRoleHint(){
 const role=selectedRole(),hints={student:'Access your personal fees, events, and attendance.',officer:'Manage fees, verify payments, and organize events.',admin:'Monitor records and access consolidated reports.'};
 $('roleHint').textContent=hints[role];$('authError').textContent='';
 const needsId=authMode==='signup'&&role==='student';$('schoolIdField').hidden=!needsId;$('authSchoolId').required=needsId;$('authSchoolId').disabled=!needsId;
 $('courseField').hidden=!needsId;$('authCourse').required=needsId;$('authCourse').disabled=!needsId;$('studentDetailsField').hidden=!needsId;$('authSection').disabled=!needsId;$('authYear').disabled=!needsId;
 const staff=authMode==='signup'&&role!=='student',input=$('authStaffCode');
 if(input.dataset.role!==role||!staff)input.value='';input.dataset.role=role;
 $('staffCodeField').hidden=!staff;input.required=staff;input.disabled=!staff;
 const label=role==='officer'?'Officer':'Adviser';$('staffCodeLabel').textContent='Choose your '+label.toLowerCase()+' code';input.placeholder=role==='officer'?'e.g. OFC-1001':'e.g. ADV-1001';
 $('staffCodeHelp').textContent='Create a unique code: 4–32 letters, numbers, - or _. Use it with your password to log in.';
 syncBootstrapField();if(authMode==='login'){$('identityLabel').textContent=role==='student'?'Email or Student ID':'Email or staff code';$('authEmail').placeholder=role==='student'?'Email or xxxx - xxxx':'Email or your staff code';}
}
function openAuth(mode='login',role='student'){$('landing').hidden=true;$('auth').hidden=false;document.querySelector(`[name="accountRole"][value="${role}"]`).checked=true;setAuthMode(mode);window.scrollTo(0,0);}
const passwordVisibilityControls=[['authPassword','togglePassword','password'],['authConfirm','toggleConfirmPassword','confirm password']];
const passwordVisibilityBindings=new Map();
const passwordFieldResizeObserver=new ResizeObserver(entries=>{for(const entry of entries){const binding=passwordVisibilityBindings.get(entry.target);if(binding)syncPasswordVisibility(entry.target,binding.button,binding.label);}});
function syncPasswordVisibility(input,button,label){
 const hasValue=input.value.length>0;if(!hasValue)input.type='password';
 const visible=input.type==='text';button.hidden=!hasValue;button.setAttribute('aria-pressed',String(visible));button.setAttribute('aria-label',(visible?'Hide ':'Show ')+label);
 if(button.classList.contains('password-visibility-toggle')){
  button.style.top=(input.offsetTop+input.offsetHeight/2)+'px';
  const binding=passwordVisibilityBindings.get(input);
  if(binding){input.style.paddingRight=hasValue?'44px':binding.originalPaddingRight;}
 }
}
function bindPasswordVisibility(input,button,label){
 if(passwordVisibilityBindings.has(input))return;
 passwordVisibilityBindings.set(input,{button,label,originalPaddingRight:input.style.paddingRight});
 const sync=()=>syncPasswordVisibility(input,button,label);
 for(const event of ['input','change','focus'])input.addEventListener(event,sync);
 button.addEventListener('click',event=>{event.preventDefault();if(input.value.length)input.type=input.type==='password'?'text':'password';sync();});
 passwordFieldResizeObserver.observe(input);sync();
}
function enhancePasswordFields(root=document){
 for(const [inputId,buttonId,label] of passwordVisibilityControls){const input=$(inputId),button=$(buttonId);if(input&&button)bindPasswordVisibility(input,button,label);}
 const fields=[...(root.matches?.('input[type="password"]')?[root]:[]),...root.querySelectorAll('input[type="password"]')];
 for(const input of fields){
  if(passwordVisibilityBindings.has(input))continue;
  const host=input.closest('label')||input.parentElement;
  host.classList.add('password-visibility-host');
  const label=(input.labels?.[0]?.firstChild?.textContent||input.getAttribute('aria-label')||input.placeholder||'password').trim();
  const button=document.createElement('button');button.type='button';button.hidden=true;button.className='password-visibility-toggle';button.innerHTML=icon('eye');host.append(button);
  bindPasswordVisibility(input,button,label);
 }
 for(const [input] of passwordVisibilityBindings)if(!input.isConnected){passwordFieldResizeObserver.unobserve(input);passwordVisibilityBindings.delete(input);}
}
function resetPasswordVisibility(root=document){for(const [input,binding] of passwordVisibilityBindings)if(root.contains(input)){input.type='password';syncPasswordVisibility(input,binding.button,binding.label);}}
function showLanding(){$('auth').hidden=true;$('landing').hidden=false;$('authForm').reset();resetPasswordVisibility();window.scrollTo(0,0);}
function setAuthMode(mode){resetPasswordVisibility();authMode=mode;const signup=mode==='signup';$('authEmail').type=signup?'email':'text';$('authEmail').placeholder=signup?'you@school.edu.ph':'Email or xxxx - xxxx';$('identityLabel').textContent=signup?'Email address':'Email or School ID';$('nameField').hidden=$('confirmField').hidden=$('signupNote').hidden=!signup;$('authName').required=$('authConfirm').required=signup;$('authName').disabled=$('authConfirm').disabled=!signup;$('authEmail').autocomplete=signup?'email':'username';$('authTitle').textContent=signup?'Create your account':'Welcome back!';$('authSubtitle').textContent=signup?'Choose your role and get started with FEATS.':'Choose your role and log in to your workspace.';$('roleLegend').textContent=signup?'Create an account as':'Log in as';$('authSubmit').innerHTML=(signup?'Create account':'Log in')+' '+icon('arrow');$('authPassword').autocomplete=signup?'new-password':'current-password';for(const [id,active] of [['loginTab',!signup],['signupTab',signup]]){$(id).classList.toggle('active',active);$(id).setAttribute('aria-pressed',String(active));}$('authError').textContent='';updateRoleHint();}
// Format checks identify a student record; they do not verify enrollment.
function validateSchoolId(value){
 const schoolId=value.trim().replace(/\s+/g,'');
 if(!/^[0-9]{4}-[0-9]{4}$/.test(schoolId))throw Error('Enter your School ID as xxxx - xxxx (4 digits - 4 digits).');
 const year=Number(schoolId.slice(0,4));
 if(year<1900||year>new Date().getFullYear())throw Error('The School ID year must be between 1900 and the current year.');
 
 return schoolId;
}
$('authForm').addEventListener('submit',async e=>{
 e.preventDefault();$('authError').textContent='';$('authSubmit').disabled=true;
 try{
  const email=$('authEmail').value.trim(),password=$('authPassword').value,role=selectedRole();let data;
  if(authMode==='signup'){
   if(password!==$('authConfirm').value)throw Error('Passwords do not match.');
   const schoolId=role==='student'?validateSchoolId($('authSchoolId').value):undefined;
   const staffCode=role==='student'?undefined:$('authStaffCode').value.trim().toUpperCase();
   if(role!=='student'){
    if(!/^[A-Z0-9][A-Z0-9_-]{3,31}$/.test(staffCode))throw Error('Choose a staff code with 4–32 letters, numbers, hyphens, or underscores.');
    const health=await api('health');if(health.staffSignup!=='personal-code')throw Error('Restart the FEATS server to enable your own staff codes: press Ctrl+C in its terminal, then run npm.cmd start.');
   }
   const course=role==='student'?$('authCourse').value:undefined,section=role==='student'?$('authSection').value.trim():undefined,year=role==='student'?$('authYear').value:undefined;
   if(role==='student'&&!Object.hasOwn(courses,course))throw Error('Select your course from the list.');
   data=await api('signup',{name:$('authName').value.trim(),email,password,role,schoolId,staffCode,course,section,year,setupCode:$('authSetupCode').value});
  }else data=await api('login',{identifier:email,password,role});
  if(data.user.status==='pending'){setAuthMode('login');$('authForm').reset();$('authError').textContent='Account submitted. An administrator must approve your staff access before you can log in.';return;}if(data.user.role==='admin')bootstrapRequired=false;applyWorkspace(await api('workspace'));signIn(db.user);$('authForm').reset();
 }catch(error){$('authError').textContent=error.message;}finally{$('authSubmit').disabled=false;}
});
enhancePasswordFields();
document.addEventListener('reset',event=>{const form=event.target;queueMicrotask(()=>resetPasswordVisibility(form));});
window.addEventListener('pageshow',()=>resetPasswordVisibility());
new MutationObserver(records=>{
 if(records.some(record=>[...record.addedNodes].some(node=>node.nodeType===1&&(node.matches('input[type="password"]')||node.querySelector('input[type="password"]'))))||[...passwordVisibilityBindings.keys()].some(input=>!input.isConnected))enhancePasswordFields();
 for(const [input,binding] of passwordVisibilityBindings)if(input.isConnected)syncPasswordVisibility(input,binding.button,binding.label);
}).observe(document.body,{childList:true,subtree:true});
resetPasswordVisibility();

document.querySelectorAll('[data-auth]').forEach(b=>b.onclick=()=>setAuthMode(b.dataset.auth));
function signIn(user){recordQueries.clear();recordFilters.clear();paymentStatus='';$('landing').hidden=true;currentUser=user;sessionGeneration++;$('auth').hidden=true;$('app').hidden=false;$('roleLabel').textContent=roleNames[user.role];$('roleDescription').textContent=student()?(user.schoolId?'School ID: '+user.schoolId+' · Enrollment unverified':'Your records. Your campus journey.'):officer()?'Manage your organization’s daily activity.':'Monitor records and consolidated reports.';$('userName').textContent=user.name;$('avatar').textContent=user.name.split(' ').map(n=>n[0]).slice(0,2).join('').toUpperCase();navigate('dashboard');checkHash();}
function showSignedOut(){sessionGeneration++;stopScanner();$('modal').close();currentUser=null;db=emptyWorkspace();$('app').hidden=true;$('content').innerHTML='';$('auth').hidden=false;$('landing').hidden=true;closeNavigation();$('authForm').reset();setAuthMode('login');}
$('signOut').onclick=async()=>{try{await api('logout',{});showSignedOut();}catch(error){toast(error.message);}};
$('menuButton').onclick=()=>{const open=$('sidebar').classList.toggle('open');$('menuButton').setAttribute('aria-expanded',String(open));};
const pageNames=()=>({...student()?{profile:'My profile'}:{},dashboard:'Dashboard',fees:student()?'My fees':'Fee management',payments:student()?'My transactions':'Transactions',events:'Events',attendance:student()?'My attendance':'Attendance',reports:student()?'My records':'Reports',...managementPages()});
function updateWorkspaceProfile(){
 $('editCourse').hidden=!student();
 if(student()){$('roleDescription').textContent='Student ID: '+currentUser.schoolId+' · '+(currentUser.course||'Course not selected')+' · '+(currentUser.section||'Section not set')+' · '+(currentUser.year||'Year not set');$('editCourse').textContent=currentUser.course?'Update profile':'Complete profile';}
}
$('editCourse').onclick=()=>{
 if(!authorized('student'))return;
 modal('Your student details',`<p>Choose your course, section, and year level. These details identify you in transactions and QR attendance.</p><form id="courseForm"><label>Course<select name="course" required>${courseOptions(currentUser.course)}</select></label><div class="form-grid"><label>Section<input name="section" maxlength="30" value="${esc(currentUser.section||'')}" placeholder="e.g. A"></label><label>Year level<select name="year"><option value="">Select year</option>${yearLevels.map(y=>`<option ${currentUser.year===y?'selected':''}>${y}</option>`).join('')}</select></label></div><button class="primary full">Save student details</button></form>`);
 $('courseForm').onsubmit=event=>{event.preventDefault();const data=new FormData(event.target);saveAction('updateCourse',{course:data.get('course'),section:data.get('section'),year:data.get('year')},{message:'Student details updated.'});};
};
function navigate(next){if(!currentUser||!Object.hasOwn(pageNames(),next))return;stopScanner();page=next;$('sidebar').classList.remove('open');$('menuButton').setAttribute('aria-expanded','false');render();}
function render(){if(!currentUser)return;updateWorkspaceProfile();$('content').dataset.page=page;const icons={profile:icon('student'),dashboard:icon('dashboard'),fees:icon('wallet'),payments:icon('receipt'),events:icon('calendar'),attendance:icon('qr'),reports:icon('reports')};$('navigation').innerHTML=Object.entries(pageNames()).map(([key,title])=>`<button data-page="${key}" class="${page===key?'active':''}"><span aria-hidden="true">${icons[key]||icon('reports')}</span>${title}</button>`).join('');$('breadcrumb').textContent='Workspace / '+pageNames()[page];$('content').innerHTML=({profile:profileView,dashboard:dashboardView,fees:feesView,payments:paymentsView,events:eventsView,attendance:attendanceView,reports:reportsView,monitoring:monitoringView,roster:rosterView,accounts:accountsView,audit:auditView,account:accountView,notifications:notificationsView,backups:backupsView}[page])();hydrateStudentFeatures();refreshRecordSearch();if($('paymentFilter'))$('paymentFilter').value=paymentStatus;afterManagementRender();}
function totals(){const assignments=visibleFees().flatMap(f=>f.studentIds.filter(id=>!student()||id===currentUser.id).map(id=>({fee:f,status:feeStatus(f,id)})));return {assigned:assignments.reduce((s,a)=>s+a.fee.amount,0),outstanding:assignments.filter(a=>a.status!=='Paid').reduce((s,a)=>s+a.fee.amount,0),collected:visiblePayments().filter(p=>p.status==='Paid').reduce((s,p)=>s+p.amount,0),pending:visiblePayments().filter(p=>p.status==='Pending').length};}
function statsView(){const t=totals();return `<div class="stats">${[[student()?'Outstanding balance':'Outstanding collections',money(t.outstanding),'Across assigned fees'],['Verified payments',money(t.collected),'Confirmed by a collector'],['Pending verification',t.pending,'Tickets awaiting review'],['Attendance records',visibleAttendance().length,student()?'Your participation history':'Across all students']].map(([label,value,note],index)=>`<div class="stat"><div class="stat-label"><span>${label}</span><span class="stat-symbol">${icon(['wallet','receipt','clock','qr'][index])}</span></div><strong>${value}</strong><small>${note}</small></div>`).join('')}</div>`;}
function dashboardView(){const upcoming=visibleEvents().filter(e=>new Date(e.date+'T'+e.time)>=new Date()).sort((a,b)=>a.date.localeCompare(b.date));return heading('DASHBOARD',`Welcome back, ${esc(currentUser.name.split(' ')[0])}.`,new Date().toLocaleDateString('en-PH',{weekday:'long',month:'long',day:'numeric',year:'numeric'}))+`<div class="hero"><div><span class="eyebrow">${student()?'STAY INFORMED. STAY INVOLVED.':officer()?'KEEP YOUR ORGANIZATION MOVING.':'TRANSPARENCY STARTS HERE.'}</span><h2>${student()?'Stay informed. Stay involved. Stay connected.':officer()?'Every contribution, accounted for.':'The whole picture, in one workspace.'}</h2><p>${student()?'Your fees, events, and attendance — together in your personal workspace.':officer()?'Assign fees, verify payment tickets, and bring your community together.':'Monitor organization records and review consolidated financial and attendance reports.'}</p></div>${action('navigate',student()?'Explore events ↗':officer()?'Review transactions ↗':'View reports ↗',student()?'events':officer()?'payments':'reports')}</div>${statsView()}<div class="columns"><section class="card"><div class="card-heading"><h2>${student()?'Your fee overview':'Organization fees'}</h2>${action('navigate','View all →','fees','text-button')}</div>${visibleFees().slice(0,4).map(f=>`<div class="row"><div><strong>${esc(f.name)}</strong><small>Due ${date(f.dueDate)}${student()?'':' · '+f.studentIds.length+' students'}</small></div><strong>${money(f.amount)}</strong>${student()?badge(feeStatus(f,currentUser.id)):''}</div>`).join('')||empty('No fees assigned yet.')}</section><section class="card"><div class="card-heading"><h2>Coming up on campus</h2>${action('navigate','All events →','events','text-button')}</div>${upcoming.slice(0,3).map(e=>`<div class="row"><div class="date-tile"><strong>${new Date(e.date+'T00:00:00').getDate()}</strong><small>${new Date(e.date+'T00:00:00').toLocaleDateString('en',{month:'short'})}</small></div><div><strong>${esc(e.title)}</strong><small>${esc(e.venue)} · ${esc(e.time)}</small></div></div>`).join('')||empty('No upcoming events. Check back soon.')}</section></div><div class="notice">${student()?'A payment ticket stays pending until an authorized collector verifies it.':officer()?'Only verify a payment after checking the actual transfer or receiving cash. Creating a ticket does not collect money.':'Monitoring access: you can view and export consolidated records. Changes are handled by officers.'}</div>`;}
function feesView(){return heading('FEES & CONTRIBUTIONS',student()?'Your fees, clearly tracked.':'Manage organization fees.',student()?'See what’s due and keep track of every payment.':'Assign fees to students and monitor collection status.',officer()?action('fee','+ Assign fee','','primary'):'')+`<section class="card"><div class="card-heading"><h2>${student()?'Assigned fees':'Student fee assignments'}</h2><small>${visibleFees().length} fees</small></div><div id="feeRows">${feeTable('')}</div></section>`;}
function paymentModal(id){if(!authorized('student'))return;const fee=visibleFees().find(f=>f.id===id);if(!fee||feeStatus(fee,currentUser.id)!=='Unpaid')return toast('This fee already has a pending or verified payment.');modal('Create a payment ticket',`<div class="ticket"><p>${esc(fee.name)}</p><strong>${money(fee.amount)}</strong><p>Due ${date(fee.dueDate)}</p></div><p class="notice">Get a ticket first, then pay through an organization-approved channel. Confirm the official payment details with your collector. If you already paid, attach your payment screenshot below. No money is transferred by this app.</p><form id="paymentForm"><label>Payment method<select name="method"><option>GCash</option><option value="Maya">Maya / PayMaya</option><option value="Cash">Over-the-counter / Cash</option></select></label><div id="paymentDestination">${paymentInstructions('GCash')}</div><button type="submit" name="requestOnly" value="yes" formnovalidate class="primary full">Get ticket — pay later</button><label>Already paid? Transfer reference / cash note<input name="reference" maxlength="120" placeholder="Optional wallet reference / required cash note"></label>${paymentProofFields()}<button class="full">Submit payment for verification</button></form>`);bindPaymentSubmission($('paymentForm'),{feeId:fee.id});}

function paymentsView(){return heading('PAYMENTS & VERIFICATION',student()?'Every transaction, on record.':'Review and verify transactions.',student()?'Track tickets from submission to confirmation.':'Check actual payment evidence before approving a ticket.',officer()?action('channels','Manage payment channels','','primary'):'')+`<section class="card"><div class="notice records-identity-note">Transaction search includes <strong>Name, Student ID, Course, Section, and Year</strong>. Use the search field below to find the correct student before reviewing payment evidence.</div><div class="toolbar"><strong>Transaction history</strong><select id="paymentFilter" aria-label="Filter transactions" style="width:180px"><option value="">All statuses</option><option>Requested</option><option>Pending</option><option>Paid</option><option>Rejected</option></select></div><div id="paymentRows">${paymentTable(paymentStatus)}</div></section>`;}
function ticketModal(id){const payment=visiblePayments().find(p=>p.id===id);if(!payment)return;modal('Payment ticket',`${paymentProgress(payment)}<div class="ticket"><span class="eyebrow">TRANSACTION REFERENCE</span><p><strong>${esc(payment.reference)}</strong></p>${badge(payment.status)}</div><dl class="ticket-details"><div><dt>Student</dt><dd>${esc(userName(payment.studentId))}</dd></div><div><dt>Amount</dt><dd class="ticket-amount">${money(payment.amount)}</dd></div><div><dt>Fee</dt><dd>${esc(payment.feeName)}</dd></div><div><dt>Payment method</dt><dd>${paymentBrand(payment.method,true)}</dd></div><div><dt>Created</dt><dd>${date(payment.createdAt)}</dd></div><div><dt>Submitted reference</dt><dd>${esc(payment.externalReference||(payment.status==='Requested'?'Not submitted yet':'Not provided'))}</dd></div></dl>${paymentProofView(payment)}${payment.verifiedBy?`<div class="verification-note">${icon('shield')}<div><strong>Reviewed by ${esc(userName(payment.verifiedBy))}</strong><small>${date(payment.verifiedAt)}</small><p>${esc(payment.note)}</p></div></div>`:''}${payment.status==='Requested'?paymentInstructions(payment.method,payment.destination):''}<div class="ticket-actions">${student()&&payment.status==='Requested'?action('submit-payment','Submit payment details',payment.id,'primary'):''}${payment.status==='Paid'?action('receipt','View receipt',payment.id,'primary'):''}${!officer()||payment.status!=='Pending'?action('print','Print ticket'):''}</div>${officer()&&payment.status==='Pending'?`<form id="verifyForm"><label>Verification note / rejection reason<textarea name="note" required maxlength="500" placeholder="Record the payment evidence checked or reason for rejection."></textarea></label><div class="actions"><button class="primary" name="decision" value="Paid">Verify &amp; issue receipt</button><button class="danger" name="decision" value="Rejected">Reject ticket</button></div></form>`:''}`);if($('verifyForm'))$('verifyForm').onsubmit=e=>{e.preventDefault();if(!authorized('officer')||payment.status!=='Pending')return;const note=new FormData(e.target).get('note').trim();if(!note)return toast('Enter a verification note.');const status=e.submitter?.value;if(!['Paid','Rejected'].includes(status))return;saveAction('verifyPayment',{id:payment.id,status,note},{receipt:status==='Paid',message:status==='Paid'?'Payment verified. Receipt issued to the student.':'Ticket rejected. The student can submit a new ticket.'});};}
const eventThemes={assembly:'General assembly',leadership:'Leadership & learning',community:'Community & activities',campus:'Campus event'};
function defaultEventCover(event){
 const title=(event?.title||'').toLowerCase();
 const theme=/assembly|meeting|orientation/.test(title)?'assembly':/leadership|seminar|workshop|finance|literacy/.test(title)?'leadership':/community|festival|activity|activities/.test(title)?'community':'campus';
 return '/assets/events/'+theme+'.svg';
}
function eventCover(event){return event?.coverImage||defaultEventCover(event);}
function eventsView(){
 return heading('MEET. LEARN. BELONG.','There is a place for you here.',student()?'Explore campus events and find your next activity.':'Publish events, manage registration, and open attendance.',officer()?action('event','+ Create event','','primary'):'')+`<div class="event-grid">${visibleEvents().map(e=>{
  const count=e.registrationCount??db.registrations.filter(r=>r.eventId===e.id).length,registered=db.registrations.some(r=>r.eventId===e.id&&r.studentId===currentUser.id);
  return `<article class="card event-card"><div class="event-cover"><img src="${esc(eventCover(e))}" alt="${esc(e.title)} event cover" loading="lazy"><div class="event-top"><div class="event-date-label">${icon('calendar')}<span>${date(e.date)}</span></div>${badge(e.published?'Published':'Draft')}</div></div><div class="event-body"><h2>${esc(e.title)}</h2><p>${esc(e.description)}</p><div class="event-meta"><span>${icon('clock')} ${esc(e.time)} &middot; ${date(e.date)}</span><span>${icon('pin')} ${esc(e.venue)}</span><span>${icon('users')} ${count} registered</span></div><div class="event-requirements">${icon('receipt')}<div><strong>What to bring</strong><span>${esc(e.requirements||'No additional requirements.')}</span></div></div><div class="actions">${student()?(registered?'<span class="registration-confirmed">'+icon('check')+' You are registered</span>':action('register','Register '+icon('arrow'),e.id,'primary')):officer()?action('event','Edit event',e.id)+action('toggle-checkin',e.checkInOpen?'Close check-in':'Open check-in',e.id):''}${e.checkInOpen?action('qr','Event QR',e.id):''}</div></div></article>`;
 }).join('')||empty('No published events yet.')}</div>`;
}
async function prepareEventPicture(file,maxWidth=1280,maxHeight=960){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Choose a JPG, PNG, or WebP picture.');
 if(file.size>5*1024*1024)throw Error('Choose a picture smaller than 5 MB.');
 const url=URL.createObjectURL(file),picture=new Image();
 try{
  picture.src=url;await picture.decode();
  if(!picture.naturalWidth||picture.naturalWidth*picture.naturalHeight>40000000)throw Error('This picture is too large. Choose a smaller picture.');
  const scale=Math.min(1,maxWidth/picture.naturalWidth,maxHeight/picture.naturalHeight),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(picture.naturalWidth*scale));canvas.height=Math.max(1,Math.round(picture.naturalHeight*scale));
  const context=canvas.getContext('2d');context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(picture,0,0,canvas.width,canvas.height);
  let quality=.86,data=canvas.toDataURL('image/jpeg',quality);
  while(data.length*3/4>600*1024&&quality>.36){quality-=.1;data=canvas.toDataURL('image/jpeg',quality);}
  if(data.length*3/4>600*1024)throw Error('Choose a smaller picture.');
  return data;
 }catch(error){if(error.name==='EncodingError')throw Error('This picture could not be read. Choose another JPG, PNG, or WebP file.');throw error;}
 finally{URL.revokeObjectURL(url);}
}
function eventModal(id){
 if(!authorized('officer'))return;
 const event=db.events.find(e=>e.id===id);let cover=eventCover(event),imageVersion=0,imageBusy=false;
 modal(event?'Edit event':'Create an event',`<form id="eventForm" class="event-editor"><section class="event-image-editor"><span class="eyebrow">EVENT COVER</span><img id="eventCoverPreview" class="event-cover-preview" src="${esc(cover)}" alt="Event cover preview"><label>Upload an event picture<input id="eventCoverFile" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="eventCoverHelp"></label><small id="eventCoverHelp">JPG, PNG, or WebP, up to 5 MB. Choose a picture that represents your event.</small><p class="cover-picker-label">Or choose a theme</p><div class="cover-themes">${Object.entries(eventThemes).map(([key,label])=>`<button type="button" data-cover-theme="${key}" aria-pressed="${cover==='/assets/events/'+key+'.svg'}"><img src="/assets/events/${key}.svg" alt=""><span>${label}</span></button>`).join('')}</div><p id="eventCoverStatus" class="cover-status" role="status"></p></section><div class="event-detail-fields"><label>Event title<input name="title" required maxlength="120" value="${esc(event?.title||'')}"></label><div class="form-grid"><label>Date<input name="date" type="date" required value="${event?.date||''}"></label><label>Time<input name="time" type="time" required value="${event?.time||''}"></label></div><label>Venue<input name="venue" required maxlength="150" value="${esc(event?.venue||'')}"></label><label>Description<textarea name="description" required maxlength="1000">${esc(event?.description||'')}</textarea></label><label>Requirements<input name="requirements" maxlength="300" value="${esc(event?.requirements||'')}"></label><label>Visibility<select name="published"><option value="true">Published</option><option value="false" ${event&&!event.published?'selected':''}>Draft</option></select></label></div><button id="saveEventButton" class="primary full">Save event</button></form>`);
 const form=$('eventForm'),status=$('eventCoverStatus'),preview=$('eventCoverPreview'),submit=$('saveEventButton'),fileInput=$('eventCoverFile');
 const showCover=()=>{preview.src=cover;form.querySelectorAll('[data-cover-theme]').forEach(button=>button.setAttribute('aria-pressed',String(cover==='/assets/events/'+button.dataset.coverTheme+'.svg')));};
 form.querySelectorAll('[data-cover-theme]').forEach(button=>button.onclick=()=>{imageVersion++;imageBusy=false;submit.disabled=false;cover='/assets/events/'+button.dataset.coverTheme+'.svg';fileInput.value='';status.textContent='Theme selected.';showCover();});
 fileInput.onchange=async()=>{
  const file=fileInput.files[0];if(!file)return;
  const version=++imageVersion;imageBusy=true;submit.disabled=true;status.textContent='Preparing your picture...';
  try{const result=await prepareEventPicture(file);if(version!==imageVersion||!form.isConnected)return;cover=result;showCover();status.textContent='Picture ready. Save the event to share it with students.';}
  catch(error){if(version===imageVersion&&form.isConnected){status.textContent=error.message;fileInput.value='';}}
  finally{if(version===imageVersion){imageBusy=false;submit.disabled=false;}}
 };
 form.onsubmit=e=>{
  e.preventDefault();if(!authorized('officer')||imageBusy)return;
  const data=Object.fromEntries(new FormData(form));data.published=data.published==='true';
  if(!data.title.trim()||!data.venue.trim()||!data.description.trim())return toast('Fill in the event details.');
  saveAction('saveEvent',{id:event?.id,...data,coverImage:cover},{message:'Event saved. Published events and their pictures are shared with students.'});
 };
}
async function register(id){if(!authorized('student'))return;await saveAction('register',{eventId:id},{message:'You’re registered. Your officer can now see your registration.'});}
async function toggleCheckIn(id){if(!authorized('officer'))return;await saveAction('toggleCheckIn',{eventId:id},{message:'Event check-in updated for all users.'});}
function qrModal(id){const event=visibleEvents().find(e=>e.id===id&&e.checkInOpen);if(!event)return toast('Check-in is closed.');const url=new URL(location.href);url.hash='attendance='+encodeURIComponent(event.token);modal('Event check-in QR',`<div class="ticket"><strong>${esc(event.title)}</strong><div id="qrcode"></div><p>Scan with your phone camera, sign in, and confirm check-in.</p></div><label>Check-in code<input readonly value="${esc(event.token)}"></label><p class="auth-note">Students must register first. For phone access, host this app at a reachable URL. Use the same server address on every device to share attendance records.</p>${action('print','Print QR')}`);if(typeof QRCode==='function')new QRCode($('qrcode'),{text:url.href,width:220,height:220});else $('qrcode').textContent='QR library unavailable. Use the check-in code above.';}
function attendanceView(){return heading('PARTICIPATION MATTERS',student()?'Your campus moments, recorded.':'Attendance workspace.',student()?'Scan an open event QR or enter its code to check in.':'Record student attendance and monitor participation.')+`${student()?'<div class="notice">Show your personal QR from My profile to the event officer. '+action('navigate','Open my QR','profile')+'</div>':officer()?officerQrCard():''}${!student()?'':`<div class="columns"><section class="card"><div class="scan-box"><div class="scan-symbol" aria-hidden="true">${icon('qr')}</div><h3>${student()?'Ready to check in?':'Scan an event code'}</h3><p>Use your camera or paste an event code below.</p>${action('scan','Start camera','','primary')}${action('stop-scanner','Stop camera')}<p id="qrScanStatus" class="qr-scan-status" role="status"></p><label>Or upload an event QR picture<input id="eventQrFile" type="file" accept="image/png,image/jpeg,image/webp"></label><video id="scannerVideo" playsinline muted hidden></video></div><form id="checkinForm"><label>Event QR code or scanned URL<input id="attendanceCode" required placeholder="Paste QR code / check-in URL"></label><button class="primary full">Confirm check-in</button></form></section><section class="card checkin-guide"><span class="eyebrow">A QUICK GUIDE</span><h3>Four steps. You’re checked in.</h3><ol class="checkin-steps"><li><span>1</span><div><strong>Reserve your place</strong><p>Register for a published event.</p></div></li><li><span>2</span><div><strong>Wait for check-in to open</strong><p>The event officer opens attendance.</p></div></li><li><span>3</span><div><strong>Scan or enter the code</strong><p>Use the event QR or paste its code.</p></div></li><li><span>4</span><div><strong>Confirm your attendance</strong><p>Your check-in appears in your history.</p></div></li></ol><div class="notice">Attendance is recorded once per student per event. Officers can also check in registered students using the same event code.</div>${action('navigate','Browse events →','events')}</section></div>`}<section class="card"><div class="card-heading"><h2>${student()?'Your attendance history':'Student attendance records'}</h2><small>${visibleAttendance().length} records</small></div>${attendanceTable()}</section>`;}
function parseQr(value){
 const raw=String(value||'').trim();let token=raw,kind='';
 if(raw.includes('#')){const hash=new URLSearchParams(raw.slice(raw.indexOf('#')+1));if(hash.has('student')){token=hash.get('student');kind='student';}else if(hash.has('attendance')){token=hash.get('attendance');kind='event';}else return null;}
 else if(raw.startsWith('FEATS-STUDENT:')){token=raw.slice(14);kind='student';}
 if(!kind)kind=token.startsWith('STUDENT-')?'student':token.startsWith('QR-')?'event':'';
 if(!kind||!new RegExp('^'+(kind==='student'?'STUDENT':'QR')+'-[0-9a-f-]{36}$','i').test(token))return null;
 return {kind,token};
}
function readCode(value){const parsed=parseQr(value);return parsed?.kind==='event'?parsed.token:'';}
function qrStatus(message){const status=$('qrScanStatus');if(status)status.textContent=message;}
function acceptScannedQr(raw,personal){
 const parsed=parseQr(raw);if(!parsed){qrStatus('This is not a FEATS attendance QR. Scan the whole student or event QR.');return false;}
 if(personal&&parsed.kind==='event'){
  const event=db.events.find(e=>e.token===parsed.token&&e.checkInOpen&&e.published);
  if(!event){qrStatus('Event check-in is closed or this QR is from another workspace.');return false;}
  $('studentQrEvent').value=event.id;qrStatus('Event selected. Now scan the student QR from My profile.');return false;
 }
 if(personal!== (parsed.kind==='student')){qrStatus('This is a student profile QR. Show it to the officer; use the event QR for self-check-in.');return false;}
 $(personal?'studentQrCode':'attendanceCode').value=personal?raw:parsed.token;
 qrStatus(personal?'Student QR detected. Select an event and press Review student.':'Event QR detected. Press Confirm check-in to record attendance.');return true;
}

async function checkIn(code,studentId){
 if(!currentUser||!['student','officer'].includes(currentUser.role))return toast('Your account has monitoring access only.');
 const data=await saveAction('checkIn',{code:readCode(code),studentId:student()?currentUser.id:studentId},{message:'Check-in confirmed and shared with your organization.'});
 if(data){stopScanner();history.replaceState(null,'',location.pathname+location.search);}
}
async function startScanner(personal=false){
 if(!currentUser||currentUser.role==='admin'||(personal&&!officer()))return;
 if(typeof jsQR!=='function')return qrStatus('QR scanner did not load. Refresh the page from the FEATS server.');
 if(!navigator.mediaDevices?.getUserMedia)return qrStatus('Camera access requires HTTPS or localhost. Use Upload QR picture or paste the QR code on this connection.');
 stopScanner();qrStatus('Opening camera. Allow camera access when asked.');const generation=sessionGeneration,scanGeneration=scannerGeneration;
 try{
  const camera=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
  if(generation!==sessionGeneration||scanGeneration!==scannerGeneration||page!=='attendance'){camera.getTracks().forEach(t=>t.stop());return;}
  stream=camera;const video=$(personal?'studentScannerVideo':'scannerVideo');video.hidden=false;video.srcObject=stream;await video.play();qrStatus('Camera ready. Hold the entire QR steady inside the preview.');
  const scan=async()=>{if(stream!==camera)return;try{const raw=decodeQrImage(video);if(raw&&acceptScannedQr(raw,personal)){stopScanner();return;}}catch{}if(stream===camera)scanTimer=setTimeout(scan,350);};scan();
 }catch(error){if(scanGeneration!==scannerGeneration)return;stopScanner();qrStatus(({NotAllowedError:'Camera permission was denied. Allow camera access in your browser, then try again.',NotFoundError:'No camera was found. Connect a camera or upload a QR picture.',NotReadableError:'The camera is busy. Close other camera apps and try again.'}[error.name]||'Camera could not be opened.')+' You can also upload a QR picture or paste its code.');}
}
function stopScanner(){scannerGeneration++;clearTimeout(scanTimer);if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;for(const id of ['scannerVideo','studentScannerVideo']){const video=$(id);if(video){video.hidden=true;video.srcObject=null;}}}
function reportsView(){const t=totals(),rate=t.assigned?Math.min(100,Math.round(t.collected/t.assigned*100)):0;return heading('TRANSPARENCY & INSIGHTS',student()?'Your records, all together.':'A clear view of your organization.',student()?'Your personal fees, transactions, and participation.':'Consolidated fee, transaction, and attendance records.',action('export','↓ Export CSV')+action('print','Print report','','primary'))+statsView()+`<section class="card"><div class="card-heading"><h2>Collection summary</h2><strong>${rate}% verified</strong></div><div class="report-bar"><span style="width:${rate}%"></span></div><p>${money(t.collected)} verified out of ${money(t.assigned)} assigned. Pending tickets are excluded from verified collections.</p></section><section class="card"><div class="card-heading"><h2>Assigned fee records</h2></div>${table(['Name','Student ID','Course','Section','Year','Fee','Amount','Due','Status'],visibleFees().flatMap(f=>f.studentIds.filter(id=>!student()||id===currentUser.id).map(id=>`<tr data-record-date="${esc(f.dueDate)}">${studentIdCells(id)}<td>${esc(f.name)}</td><td>${money(f.amount)}</td><td>${date(f.dueDate)}</td><td>${badge(feeStatus(f,id))}</td></tr>`)))}</section><section class="card"><div class="card-heading"><h2>Transaction records</h2></div>${paymentTable('')}</section><section class="card"><div class="card-heading"><h2>Attendance records</h2></div>${attendanceTable()}</section>`;}
function exportCSV(){exportOptions();}
function modal(title,body){$('modalTitle').textContent=title;$('modalBody').innerHTML=body;if(!$('modal').open)$('modal').showModal();}
$('closeModal').onclick=()=>$('modal').close();
$('modal').addEventListener('close',()=>{if(currentUser)render();});
$('modal').addEventListener('click',e=>{if(e.target===$('modal')){const r=$('modal').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('modal').close();}});

document.addEventListener('click',e=>{const nav=e.target.closest('#navigation [data-page]');if(nav)return navigate(nav.dataset.page);const button=e.target.closest('[data-action]');if(!button||!currentUser)return;const id=button.dataset.id;const actions={navigate:()=>navigate(id),fee:()=>feeModal(id),pay:()=>paymentModal(id),ticket:()=>ticketModal(id),'submit-payment':()=>submitPaymentModal(id),receipt:()=>receiptModal(id),channels:()=>paymentChannelsModal(),event:()=>eventModal(id),register:()=>register(id),'toggle-checkin':()=>toggleCheckIn(id),qr:()=>qrModal(id),'download-student-qr':downloadStudentQr,'scan-student':()=>startScanner(true),'stop-scanner':stopScanner,scan:()=>startScanner(false),export:exportCSV,print:()=>window.print()};actions[button.dataset.action]?.();});
document.addEventListener('click',e=>{
 const button=e.target.closest('[data-clear-record-filters]');if(!button)return;
 const block=button.closest('.records-block');block.querySelector('[data-record-search]').value='';
 block.querySelectorAll('[data-record-filter],input[data-record-date]').forEach(select=>select.value='');applyRecordSearch(block);
});
document.addEventListener('input',e=>{if(e.target.matches('[data-record-search]'))applyRecordSearch(e.target.closest('.records-block'));});
document.addEventListener('change',e=>{if(e.target.matches('[data-record-filter],input[data-record-date]')){applyRecordSearch(e.target.closest('.records-block'));return;}if(e.target.id==='paymentFilter'){paymentStatus=e.target.value;$('paymentRows').innerHTML=paymentTable(e.target.value);refreshRecordSearch();}});
document.addEventListener('submit',e=>{if(e.target.id==='studentQrForm'){e.preventDefault();reviewStudentQr();return;}if(e.target.id==='profileCourseForm'){e.preventDefault();const data=new FormData(e.target);saveAction('updateCourse',{course:data.get('course'),section:data.get('section'),year:data.get('year')},{message:'Student details updated.'});return;}if(e.target.id==='checkinForm'){e.preventDefault();checkIn($('attendanceCode').value,officer()?$('attendanceStudent').value:currentUser.id);}});
function checkHash(){
 if(!currentUser)return;const parsed=parseQr(location.hash);if(!parsed)return;
 if(currentUser.role==='admin')return toast('An officer or student account is needed for attendance check-in.');
 navigate('attendance');acceptScannedQr(location.href,officer());
}
window.addEventListener('hashchange',checkHash);
window.addEventListener('pagehide',stopScanner);
// All accounts read from the same server; revision checks avoid needless rerenders.
async function syncWorkspace(force=false){
 if(!currentUser||syncBusy||mutationBusy)return;syncBusy=true;const generation=sessionGeneration;
 try{
  const next=await api('workspace');if(generation!==sessionGeneration||mutationBusy)return;if(next.user&&next.user.id!==currentUser.id){applyWorkspace(next);signIn(next.user);toast('This browser is now signed in to '+next.user.name+'.');return;}
  if(next.revision>db.revision||JSON.stringify(next.notifications)!==JSON.stringify(db.notifications)){applyWorkspace(next);
   if(!$('modal').open&&!stream){
    const active=document.activeElement;const searchKey=active?.matches('[data-record-search]')?active.closest('.records-block').dataset.recordKey:null;
    const code=$('attendanceCode')?.value,selectedStudent=$('attendanceStudent')?.value;
    const preservedForms=[...document.querySelectorAll('#content form')].map(form=>({id:form.id,fields:[...form.elements].filter(field=>field.name&&field.type!=='file').map(field=>({name:field.name,value:field.value,checked:field.checked}))}));
    const profileValues=$('profileCourseForm')?[...new FormData($('profileCourseForm')).entries()]:[];
    const formValues=['studentQrCode','studentQrEvent','profileCourse'].map(id=>[id,$(id)?.value]);
    const tableScroll=new Map([...document.querySelectorAll('.records-block')].map(block=>{const wrap=block.querySelector('.table-wrap');return [block.dataset.recordKey,{top:wrap.scrollTop,left:wrap.scrollLeft}];}));
    const scroll=window.scrollY;render();for(const form of preservedForms){for(const saved of form.fields){const field=$(form.id)?.elements.namedItem(saved.name);if(field){field.value=saved.value;if(field.type==='checkbox'||field.type==='radio')field.checked=saved.checked;}}}for(const [name,value] of profileValues){const field=$('profileCourseForm')?.elements.namedItem(name);if(field)field.value=value;}formValues.forEach(([id,value])=>{if($(id)&&value!==undefined)$(id).value=value;});if($('attendanceCode')&&code)$('attendanceCode').value=code;if($('attendanceStudent')&&selectedStudent)$('attendanceStudent').value=selectedStudent;
    document.querySelectorAll('.records-block').forEach(block=>{const position=tableScroll.get(block.dataset.recordKey);if(position){const wrap=block.querySelector('.table-wrap');wrap.scrollTop=position.top;wrap.scrollLeft=position.left;}});
    if(searchKey){const block=[...document.querySelectorAll('.records-block')].find(b=>b.dataset.recordKey===searchKey);block?.querySelector('input')?.focus({preventScroll:true});}lockVerifiedProfile();window.scrollTo(0,scroll);
   }
  }if(force)toast('Records are up to date with the shared server.');
 }catch(error){if(error.status===401){showSignedOut();toast('Your session has ended. Please log in again.');}else if(force)toast(error.message);}
 finally{syncBusy=false;}
}
window.addEventListener('focus',()=>syncWorkspace());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncWorkspace();});
setInterval(()=>{if(!document.hidden)syncWorkspace();},3000);
async function startApp(){
 try{const health=await api('health');bootstrapRequired=health.bootstrapRequired===true;syncBootstrapField();const session=await api('session');if(session.user){applyWorkspace(await api('workspace'));signIn(db.user);}}
 catch(error){$('serverNotice').hidden=false;$('serverNotice').textContent=error.message;}
}
// Public entry points use the selected role without changing an existing account's role.
document.querySelectorAll('[data-open-auth]').forEach(button=>button.addEventListener('click',()=>openAuth(button.dataset.openAuth,button.dataset.entryRole||'student')));
document.querySelectorAll('[data-home]').forEach(button=>button.addEventListener('click',showLanding));
document.querySelectorAll('[name="accountRole"]').forEach(input=>input.addEventListener('change',updateRoleHint));
$('authCourse').innerHTML=courseOptions();
$('authCourse').addEventListener('change',()=>{$('authCourse').title=courses[$('authCourse').value]||'';});
hydrateIcons();
if(!currentUser && location.hash.startsWith('#attendance='))openAuth('login');

function paymentProgress(payment){
 const stage=payment.status==='Paid'?5:payment.status==='Pending'||payment.status==='Rejected'?4:2;
 return `<ol class="payment-progress">${['Request payment','Unique ticket','Pay via channel','Officer verifies','Paid / receipt'].map((label,index)=>`<li class="${index<stage?'done':''}"><span>${index+1}</span>${label}</li>`).join('')}</ol>${payment.status==='Rejected'?'<p class="notice">Ticket rejected. Review the officer’s note and submit a new ticket from My fees.</p>':''}`;
}
function submitPaymentModal(id){
 if(!authorized('student'))return;
 const payment=visiblePayments().find(p=>p.id===id&&p.status==='Requested');if(!payment)return;
 const selectedMethod=paymentMethods.includes(payment.method)?payment.method:'GCash';
 modal('Submit payment details',`<div class="ticket"><strong>${esc(payment.reference)}</strong><p>${esc(payment.feeName)} · ${money(payment.amount)}</p></div><p class="notice">Use only the payment details confirmed by your organization. Your collector must verify the payment before it is marked paid.</p><form id="submitPaymentForm"><label>Payment method<select name="method">${paymentMethods.map(m=>`<option value="${esc(m)}" ${m===selectedMethod?'selected':''}>${paymentMethodLabel(m)}</option>`).join('')}</select></label><div id="paymentDestination">${paymentInstructions(selectedMethod,selectedMethod===payment.method?payment.destination:null)}</div><label>Transfer reference (optional for wallets) / cash note<input name="reference" maxlength="120"></label>${paymentProofFields()}<button class="primary full">Submit for verification</button></form>`);
 bindPaymentSubmission($('submitPaymentForm'),{payment});
}
function receiptModal(id){
 if(!currentUser)return;
 const payment=visiblePayments().find(p=>p.id===id&&p.status==='Paid');if(!payment)return toast('A receipt is available only after verification.');
 const account=db.users.find(u=>u.id===payment.studentId),receipt=payment.receipt;
 const details=receipt||{number:payment.reference,studentName:account?.name||userName(payment.studentId),schoolId:account?.schoolId||'',course:account?.course||'',feeName:payment.feeName,amount:payment.amount,method:payment.method,transactionReference:payment.reference,externalReference:payment.externalReference,officerName:payment.verifiedBy?userName(payment.verifiedBy):'Not recorded',issuedAt:payment.verifiedAt,note:payment.note};
 modal('Payment receipt',`<article class="payment-receipt"><div class="receipt-brand"><img src="feats-logo.png" alt="FEATS"><div><h3>Payment receipt</h3><p>Fee, Event &amp; Attendance Tracking System</p></div></div>${badge('Paid')}<p class="receipt-confirmation">Payment received and verified for the fee listed below.</p><dl><dt>${receipt?'Receipt number':'Legacy transaction reference'}</dt><dd class="receipt-number">${esc(details.number)}</dd><dt>Student</dt><dd>${esc(details.studentName)}</dd><dt>Student ID</dt><dd>${esc(details.schoolId||'Not recorded')}</dd><dt>Course</dt><dd>${esc(details.course||'Not recorded')}</dd><dt>Fee paid</dt><dd>${esc(details.feeName)}</dd><dt>Payment method</dt><dd>${paymentBrand(details.method,true)}</dd><dt>Transaction</dt><dd>${esc(details.transactionReference)}</dd>${details.externalReference?`<dt>Transfer reference / cash note</dt><dd>${esc(details.externalReference)}</dd>`:''}<dt>${receipt?'Issued by':'Verified by'}</dt><dd>${esc(details.officerName)}<small class="receipt-officer-role">Officer / Authorized Collector</small></dd><dt>${receipt?'Date issued':'Verification date'}</dt><dd>${details.issuedAt?esc(new Date(details.issuedAt).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'})):'Not recorded'}</dd>${details.note?`<dt>Officer note</dt><dd>${esc(details.note)}</dd>`:''}</dl><div class="receipt-total"><span>Amount paid</span><strong>${money(details.amount)}</strong></div><p class="auth-note">${receipt?'Issued electronically by the officer after payment verification.':'Historical verified payment record.'} Keep this organization receipt as proof of payment.</p></article>${action('print','Print / save receipt as PDF','','primary')}`);

}

$('refreshRecords').addEventListener('click',()=>syncWorkspace(true));
function closeNavigation(){$('sidebar').classList.remove('open');$('menuButton').setAttribute('aria-expanded','false');}
$('closeNavigation').addEventListener('click',closeNavigation);
$('sidebarScrim').addEventListener('click',closeNavigation);
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeNavigation();});

function paymentMethodLabel(method){return {Maya:'Maya / PayMaya',Cash:'Over-the-counter / Cash'}[method]||method;}
function paymentBrand(method,compact=false){
 const logo={GCash:'assets/payments/gcash.png',Maya:'assets/payments/maya.png'}[method];
 const mark=logo?`<img class="payment-logo" src="${logo}" alt="" width="40" height="40">`:`<span class="payment-brand-icon">${icon('wallet')}</span>`;
 return `<span class="payment-brand${compact?' payment-brand-compact':''}">${mark}<span>${esc(paymentMethodLabel(method))}</span></span>`;
}
function channelSnapshot(method){const channel=db.paymentChannels?.[method];return channel?.enabled?{...channel}:null;}
function paymentInstructions(method,snapshot){
 const channel=snapshot||channelSnapshot(method);
 if(!channel)return `<div class="channel-instructions"><div class="channel-title">${paymentBrand(method)}</div><p>Payment destination has not been configured. Ask your organization’s officer for its approved account before paying. You can still create a ticket.</p></div>`;
 return `<div class="channel-instructions"><div class="channel-title">${paymentBrand(method)}</div><dl><dt>${method==='Cash'?'Collector':'Account name'}</dt><dd>${esc(channel.name)}</dd><dt>${method==='Cash'?'Payment location':'Account / mobile number'}</dt><dd>${esc(channel.account)}</dd></dl>${channel.instructions?`<p>${esc(channel.instructions)}</p>`:''}<small>Pay outside FEATS and keep your receipt/reference. Only an officer can confirm payment. Instructions are recorded with your ticket.</small></div>`;
}
function paymentChannelsModal(){
 if(!authorized('officer'))return;
 const methods=paymentMethods;
 modal('Organization payment channels',`<p class="notice">Enter only organization-approved receiving details. Never enter passwords, PINs, OTPs, or API keys. These details are shared with students in your organization.</p><form id="channelsForm">${methods.map((method,index)=>{const c=db.paymentChannels?.[method]||{};return `<fieldset class="channel-config"><legend>${paymentBrand(method)}</legend><label class="channel-enable"><input type="checkbox" name="enabled${index}" ${c.enabled?'checked':''}> Show this channel’s instructions</label><label>${method==='Cash'?'Collector name':'Account name'}<input name="name${index}" maxlength="100" value="${esc(c.name||'')}"></label><label>${method==='Cash'?'Collection location':'Account / mobile number'}<input name="account${index}" maxlength="120" value="${esc(c.account||'')}"></label><label>Instructions<textarea name="instructions${index}" maxlength="500">${esc(c.instructions||'')}</textarea></label></fieldset>`;}).join('')}<button class="primary full">Save approved payment details</button></form>`);
 methods.forEach((method,index)=>{const enabled=$('channelsForm').elements['enabled'+index],name=$('channelsForm').elements['name'+index],account=$('channelsForm').elements['account'+index];const syncRequired=()=>{const required=enabled.checked;name.required=account.required=required;name.setAttribute('aria-required',String(required));account.setAttribute('aria-required',String(required));};enabled.addEventListener('change',syncRequired);syncRequired();});
 $('channelsForm').onsubmit=e=>{e.preventDefault();if(!authorized('officer'))return;const data=new FormData(e.target),channels={};for(const [index,method] of methods.entries()){const enabled=data.has('enabled'+index),name=data.get('name'+index).trim(),account=data.get('account'+index).trim();if(enabled&&(!name||!account))return toast('Complete the receiving details for '+paymentMethodLabel(method)+': account name and account/mobile number are required.');channels[method]={enabled,name,account,instructions:data.get('instructions'+index).trim(),updatedBy:currentUser.id,updatedAt:new Date().toISOString()};}saveAction('saveChannels',{channels},{message:'Payment instructions saved for all users.'});};
}

function paymentProofFields(){return `<section class="proof-upload"><label>Payment screenshot<input id="paymentProofFile" name="proofFile" type="file" accept="image/png,image/jpeg,image/webp" aria-describedby="paymentProofHelp"></label><small id="paymentProofHelp">Required for GCash and Maya. Upload JPG, PNG, or WebP up to 5 MB. Include the amount, date, and payment reference.</small><p id="paymentProofStatus" role="status"></p><img id="paymentProofPreview" alt="Payment screenshot preview" hidden><button id="removePaymentProof" type="button" hidden>Remove screenshot</button></section>`;}
function bindPaymentSubmission(form,{feeId,payment}={}){
 let proofImage='',busy=false,version=0;
 const input=$('paymentProofFile'),preview=$('paymentProofPreview'),status=$('paymentProofStatus'),remove=$('removePaymentProof');
 const updateMethod=()=>{const method=form.elements.method.value;input.required=method!=='Cash';form.elements.reference.required=method==='Cash';$('paymentDestination').innerHTML=paymentInstructions(method,method===payment?.method?payment.destination:null);};
 form.elements.method.onchange=updateMethod;updateMethod();
 const clear=()=>{proofImage='';preview.hidden=true;preview.removeAttribute('src');remove.hidden=true;};
 remove.onclick=()=>{version++;busy=false;input.value='';clear();status.textContent='Screenshot removed.';};
 input.onchange=async()=>{
  const file=input.files[0],current=++version;clear();if(!file){busy=false;status.textContent='';return;}busy=true;status.textContent='Preparing screenshot...';
  try{const picture=await prepareEventPicture(file,1600,2400);if(current!==version||!form.isConnected)return;proofImage=picture;preview.src=picture;preview.hidden=false;remove.hidden=false;status.textContent='Screenshot attached. Submit it for officer review.';}
  catch(error){if(current===version){input.value='';status.textContent=error.message;}}
  finally{if(current===version)busy=false;}
 };
 form.onsubmit=event=>{
  event.preventDefault();if(!authorized('student'))return;const requestOnly=event.submitter?.name==='requestOnly',method=form.elements.method.value,externalReference=form.elements.reference.value.trim();
  if(!requestOnly&&busy)return toast('Wait for the screenshot to finish preparing.');
  if(!requestOnly&&method!=='Cash'&&!proofImage)return toast('Attach your payment screenshot first.');
  if(!requestOnly&&method==='Cash'&&!externalReference)return toast('Enter your cash payment note.');
  saveAction(payment?'submitPayment':'createPayment',{...(payment?{id:payment.id}:{feeId,requestOnly}),method,externalReference,proofImage:requestOnly?'':proofImage},{ticket:true,message:requestOnly?'Ticket created. Attach your screenshot after paying.':'Payment screenshot submitted for officer verification.'});
 };
}
function paymentProofView(payment){
 return payment.hasProof?`<section class="payment-proof"><h3>Payment screenshot</h3><a href="/api/payments/${encodeURIComponent(payment.id)}/proof" target="_blank" rel="noopener"><img src="/api/payments/${encodeURIComponent(payment.id)}/proof" alt="Submitted payment screenshot" loading="lazy"><span>Open full-size screenshot</span></a><p>Check the amount, recipient, date, and reference before verifying.</p></section>`:'<p class="auth-note">No payment screenshot attached to this ticket.</p>';
}
function profileView(){
 const user=currentUser,verified=user.enrollmentStatus==='Verified';
 const details=[['Full name',user.name],['Student ID',user.schoolId],['Email',user.email],['Course',user.course||'Not set'],['Section',user.section||'Not set'],['Year level',user.year||'Not set']];
 return heading('YOUR STUDENT PROFILE','Your campus identity.','Show your personal QR to the officer when attending a registered event.')+`
  <div class="profile-layout">
   <section class="card profile-card student-id-card" aria-labelledby="profileQrHeading">
    <div class="profile-card-header"><span class="profile-card-icon" aria-hidden="true">${icon('qr')}</span><h2 id="profileQrHeading">Personal attendance QR</h2></div>
    <div id="studentProfileQr" class="personal-qr" role="img" aria-label="Your personal attendance QR code"></div>
    <div class="profile-identity"><h3>${esc(user.name)}</h3><p class="student-id-number">Student ID: <strong>${esc(user.schoolId)}</strong></p></div>
    <dl class="profile-identity-meta">
     <div><dt>Course</dt><dd>${esc(user.course||'Not set')}</dd></div>
     <div><dt>Section</dt><dd>${esc(user.section||'Not set')}</dd></div>
     <div><dt>Year level</dt><dd>${esc(user.year||'Not set')}</dd></div>
    </dl>
    <div class="profile-qr-footer"><p>Register for an event, then present this QR during check-in.</p><button type="button" class="primary profile-button" data-action="download-student-qr">Download QR</button></div>
   </section>
   <section class="card profile-card profile-information-card" aria-labelledby="profileDetailsHeading">
    <div class="profile-details-header"><h2 id="profileDetailsHeading">Student profile details</h2><p>Your account and academic information.</p></div>
    <dl class="profile-details">${details.map(([label,value])=>`<div class="profile-detail-row"><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
    <form id="profileCourseForm" aria-labelledby="profileEditHeading">
     <div class="profile-editor-heading"><h3 id="profileEditHeading">Academic information</h3><p id="profileEditHelp">${verified?'Your academic details are verified through the official roster. Contact your administrator for corrections.':'Keep your course, section, and year level up to date.'}</p></div>
     <div class="profile-fields">
      <label class="profile-course-field" for="profileCourse">Course<select id="profileCourse" name="course" required aria-describedby="profileEditHelp">${courseOptions(user.course)}</select></label>
      <label for="profileSection">Section<input id="profileSection" name="section" maxlength="30" value="${esc(user.section||'')}" placeholder="e.g. A" aria-describedby="profileEditHelp"></label>
      <label for="profileYear">Year level<select id="profileYear" name="year" aria-describedby="profileEditHelp"><option value="">Select year</option>${yearLevels.map(year=>`<option ${user.year===year?'selected':''}>${year}</option>`).join('')}</select></label>
     </div>
     <p class="profile-form-note">These details appear in fee, transaction, and attendance records.</p>
     <div class="profile-actions"><button type="submit" class="primary profile-button">Save student details</button><button type="button" class="profile-button profile-secondary-button" data-action="navigate" data-id="events">Browse events ${icon('arrow')}</button></div>
    </form>
   </section>
  </div>`;
}
function hydrateStudentFeatures(){
 if($('studentProfileQr')&&currentUser.attendanceToken){new QRCode($('studentProfileQr'),{text:'FEATS-STUDENT:'+currentUser.attendanceToken,width:220,height:220,correctLevel:QRCode.CorrectLevel.M});$('studentProfileQr').removeAttribute('title');}
 for(const id of ['studentQrFile','eventQrFile'])if($(id))$(id).onchange=async event=>{
  const file=event.target.files[0],personal=id==='studentQrFile',input=$(personal?'studentQrCode':'attendanceCode'),generation=sessionGeneration;if(!file)return;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)return qrStatus('Choose a JPG, PNG, or WebP QR picture up to 5 MB.');
  stopScanner();qrStatus('Reading QR picture...');const url=URL.createObjectURL(file),picture=new Image();
  try{picture.src=url;await picture.decode();if(picture.naturalWidth*picture.naturalHeight>40000000)throw Error('Choose a smaller QR picture.');const code=decodeQrImage(picture);if(!code)throw Error('No QR found. Use a clear picture of the whole QR.');if(input.isConnected&&generation===sessionGeneration)acceptScannedQr(code,personal);}
  catch(error){if(input.isConnected&&generation===sessionGeneration)qrStatus(error.message||'The QR picture could not be read.');}finally{URL.revokeObjectURL(url);}
 };

}
function downloadStudentQr(){
 if(!authorized('student'))return;const source=$('studentProfileQr')?.querySelector('canvas');if(!source)return toast('Open My profile to download your QR.');
 const canvas=document.createElement('canvas');canvas.width=canvas.height=280;const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,280,280);context.drawImage(source,30,30,220,220);const link=document.createElement('a');link.href=canvas.toDataURL('image/png');link.download='FEATS-QR-'+currentUser.schoolId+'.png';link.click();
}
function officerQrCard(){return `<section class="card student-scan-card"><div><span class="eyebrow">STUDENT QR CHECK-IN</span><h2>Scan a student's personal QR</h2><p>Filter by course and year before scanning, then check the student's identity before confirming attendance.</p><div class="actions">${action('scan-student','Start camera','','primary')}${action('stop-scanner','Stop camera')}</div><p id="qrScanStatus" class="qr-scan-status" role="status"></p><video id="studentScannerVideo" playsinline muted hidden></video><label>Or upload a QR picture<input id="studentQrFile" type="file" accept="image/png,image/jpeg,image/webp"></label></div><form id="studentQrForm"><label>Event<select id="studentQrEvent" required><option value="">Select an open event</option>${visibleEvents().filter(e=>e.published&&e.checkInOpen).map(e=>`<option value="${esc(e.id)}">${esc(e.title)} - ${date(e.date)}</option>`).join('')}</select></label><div class="form-grid"><label>Course filter<select id="studentQrCourse"><option value="">Any course</option>${Object.keys(courses).map(code=>`<option value="${code}">${code}</option>`).join('')}</select></label><label>Year filter<select id="studentQrYear"><option value="">Any year</option>${yearLevels.map(year=>`<option>${year}</option>`).join('')}</select></label></div><label>Student QR code<input id="studentQrCode" required autocomplete="off" placeholder="Scan, upload, or paste the student's QR code"></label><p class="auth-note">The student must be registered for this event. Attendance is recorded once per event.</p><button class="primary full">Review student</button><p>${action('navigate','Manage event check-in','events','text-button')}</p></form></section>`;}
function decodeQrImage(source){
 const width=source.videoWidth||source.naturalWidth,height=source.videoHeight||source.naturalHeight;if(!width||!height)return '';
 const scale=Math.min(1,1400/Math.max(width,height)),canvas=document.createElement('canvas');canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(source,0,0,canvas.width,canvas.height);const pixels=context.getImageData(0,0,canvas.width,canvas.height);return jsQR(pixels.data,pixels.width,pixels.height)?.data||'';
}
async function reviewStudentQr(){
 if(!authorized('officer'))return;const eventId=$('studentQrEvent').value,raw=$('studentQrCode').value.trim(),parsed=parseQr(raw),token=parsed?.kind==='student'?parsed.token:'',event=db.events.find(e=>e.id===eventId),generation=sessionGeneration;
 if(!event)return toast('Select an open event.');if(!token)return qrStatus('Scan a student QR from My profile, not the event QR.');
 try{const data=await api('student-qr',{token});if(generation!==sessionGeneration||page!=='attendance')return;const account=data.student,courseFilter=$('studentQrCourse').value,yearFilter=$('studentQrYear').value;if(courseFilter&&account.course!==courseFilter)return qrStatus('The scanned student is not in the selected course.');if(yearFilter&&account.year!==yearFilter)return qrStatus('The scanned student is not in the selected year.');
  modal('Confirm student attendance',`<div class="ticket"><strong>${esc(account.name)}</strong><p>Student ID: ${esc(account.schoolId)}</p><p>${esc(account.course||'Course not selected')} · ${esc(account.section||'Section not set')} · ${esc(account.year||'Year not set')}</p></div><p>Event: <strong>${esc(event.title)}</strong></p><p>Confirm that this is the student presenting the QR.</p><button id="confirmStudentCheckin" class="primary full">Confirm attendance</button>`);
  $('confirmStudentCheckin').onclick=()=>saveAction('checkInStudent',{eventId,token},{message:'Attendance recorded for '+account.name+'.'});
 }catch(error){toast(error.message);}
}

/* Record columns keep the student's section and year visible beside the course. */
function studentOptionLabel(u){return `${esc(u.name)}${u.schoolId?' · '+esc(u.schoolId):''}${u.course?' / '+esc(u.course):''}${u.section?' · Sec. '+esc(u.section):''}${u.year?' · '+esc(u.year):''} — ${esc(u.email)}`;}
function feeModal(id){if(!authorized('officer'))return;const fee=db.fees.find(f=>f.id===id),students=db.users.filter(u=>u.role==='student'),locked=fee&&db.payments.some(p=>p.feeId===id);modal(fee?'Edit fee':'Assign a fee',`<form id="feeForm"><label>Fee name<input name="name" required maxlength="100" value="${esc(fee?.name||'')}"></label><div class="form-grid"><label>Amount (PHP)<input name="amount" type="number" min="1" step="0.01" max="1000000" required value="${fee?.amount||''}" ${locked?'readonly':''}></label><label>Due date<input name="dueDate" type="date" required value="${fee?.dueDate||''}"></label></div>${locked?'<p class="auth-note">Amount is locked once a ticket exists. Existing assignments are retained.</p>':''}<label>Assign to students<select name="students" multiple size="5" required>${students.map(u=>`<option value="${u.id}" ${fee?.studentIds.includes(u.id)?'selected':''}>${studentOptionLabel(u)}</option>`).join('')}</select></label><p class="auth-note">Student ID, course, section, and year are shown to help identify the correct student. Hold Ctrl / Command to select multiple.</p><button class="primary full">Save fee</button></form>`);$('feeForm').onsubmit=e=>{e.preventDefault();if(!authorized('officer'))return;const data=new FormData(e.target),amount=Number(data.get('amount'));if(!Number.isFinite(amount)||amount<=0||!data.get('name').trim())return toast('Enter a valid fee name and amount.');let studentIds=data.getAll('students');if(locked)studentIds=[...new Set([...fee.studentIds,...studentIds])];saveAction('saveFee',{id:fee?.id,name:data.get('name').trim(),amount:locked?fee.amount:amount,dueDate:data.get('dueDate'),studentIds},{message:'Fee saved. Assigned students will receive the update.'});};}
function feeTable(query){return table([...(student()?['Name','Student ID','Course','Section','Year']:[]),'Fee','Amount','Due date',student()?'Status':'Assigned students / School ID','Action'],visibleFees().filter(f=>f.name.toLowerCase().includes(query.toLowerCase())).map(f=>`<tr>${student()?studentIdCells(currentUser.id):''}<td><strong>${esc(f.name)}</strong></td><td>${money(f.amount)}</td><td>${date(f.dueDate)}</td><td>${student()?badge(feeStatus(f,currentUser.id)):`<div class="assigned-students">${f.studentIds.map(id=>`<div>${studentIdentity(id)}</div>`).join('')||'No students assigned'}</div>`}</td><td>${student()?(feeStatus(f,currentUser.id)==='Unpaid'?action('pay','Request payment',f.id):action('navigate','View transactions','payments')):officer()?action('fee','Edit',f.id):'View only'}</td></tr>`));}
function paymentTable(status){return table(['Reference / date','Name','Student ID','Course','Section','Year','Fee','Amount','Method','Status','Action'],visiblePayments().filter(p=>!status||p.status===status).map(p=>`<tr data-record-date="${esc(p.createdAt.slice(0,10))}" data-search="${esc(p.reference)}" data-status="${esc(p.status)}" data-amount="${esc(p.amount)}"><td><strong>${esc(p.reference.slice(0,22))}${p.reference.length>22?'…':''}</strong><small>${date(p.createdAt)}</small></td>${studentIdCells(p.studentId)}<td>${esc(p.feeName)}</td><td>${money(p.amount)}</td><td>${paymentBrand(p.method,true)}</td><td>${badge(p.status)}</td><td><div class="actions">${action('ticket',officer()&&p.status==='Pending'?'Review ticket':'View ticket',p.id)}${p.status==='Paid'?action('receipt','View receipt',p.id):''}</div></td></tr>`));}
function attendanceTable(){return table(['Name','Student ID','Course','Section','Year','Event','Checked in','Status'],visibleAttendance().map(a=>`<tr data-record-date="${esc(a.recordedAt.slice(0,10))}">${studentIdCells(a.studentId)}<td>${esc(db.events.find(e=>e.id===a.eventId)?.title||a.eventTitle)}</td><td>${date(a.recordedAt)} · ${new Date(a.recordedAt).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})}</td><td>${badge('Present')}</td></tr>`));}
startApp();
