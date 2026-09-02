const $ = s => document.querySelector(s);
const content = $("#content");
const titles = {
  dashboard:"الرئيسية", children:"ملفات الأطفال", attendance:"الحضور والانصراف",
  plans:"الخطط الفردية", sessions:"جلسات التخاطب", reports:"التقارير",
  users:"المستخدمون والصلاحيات", settings:"الإعدادات"
};

document.addEventListener("DOMContentLoaded", () => {
  $("#loginForm").addEventListener("submit", login);
  $("#logoutBtn").addEventListener("click", logout);
  $("#closeModal").addEventListener("click", closeModal);
  $("#nav").addEventListener("click", e => {
    const btn = e.target.closest("button[data-page]");
    if (btn) showPage(btn.dataset.page);
  });
});

function login(e){
  e.preventDefault();
  const email = $("#loginEmail").value.trim();
  const password = $("#loginPassword").value;
  if(!email || !password) return;

  /*
    مؤقتًا: النموذج يقبل الدخول لأي بريد.
    في الإنتاج:
    1) Firebase Authentication للتحقق من البريد وكلمة المرور.
    2) Firestore لجلب role المستخدم.
  */
  APP.currentUser = {id:"local-user", name:email.split("@")[0], email, role:"admin", roleLabel:"أدمن أساسي"};
  $("#loginScreen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#userName").textContent = APP.currentUser.name;
  $("#roleLabel").textContent = APP.currentUser.roleLabel;
  applyPermissions();
  showPage("dashboard");
}

function logout(){
  APP.currentUser = null;
  $("#app").classList.add("hidden");
  $("#loginScreen").classList.remove("hidden");
  $("#loginForm").reset();
}

function applyPermissions(){
  const role = APP.currentUser.role;
  document.querySelectorAll("#nav button").forEach(btn=>{
    btn.classList.toggle("hidden", !permissions[role]?.[btn.dataset.page]);
  });
}

function showPage(page){
  if(!permissions[APP.currentUser.role]?.[page]) return;
  document.querySelectorAll("#nav button").forEach(b=>b.classList.toggle("active", b.dataset.page===page));
  $("#pageTitle").textContent = titles[page] || "";
  const views = {dashboard,children,attendance,plans,sessions,reports,users,settings};
  views[page]?.();
}

function dashboard(){
  content.innerHTML = `
    <div class="grid stats">
      ${stat("إجمالي الأطفال", APP.children.length)}
      ${stat("حضور اليوم", APP.attendance.filter(x=>x.status==="present").length)}
      ${stat("الخطط الفردية", APP.plans.length)}
      ${stat("جلسات التخاطب", APP.sessions.length)}
    </div>
    <div class="grid two" style="margin-top:15px">
      <div class="card"><div class="section-title"><h3>آخر الأطفال</h3></div>${APP.children.length?APP.children.slice(-5).reverse().map(childRow).join(""):'<div class="empty">لا توجد بيانات بعد. أضف أول طفل من «ملفات الأطفال».</div>'}</div>
      <div class="card"><div class="section-title"><h3>حالة النظام</h3></div>
        <div class="list">
          <div class="list-item">البيانات الحالية: <strong>فارغة</strong></div>
          <div class="list-item">مصدر التخزين: <strong>Local JS — قابل للاستبدال بـ Firebase</strong></div>
          <div class="list-item">الصلاحيات: <strong>Admin / Supervisor / Speech</strong></div>
        </div>
      </div>
    </div>`;
}
function stat(label,num){return `<div class="card stat"><div class="muted">${label}</div><div class="num">${num}</div></div>`}
function childRow(c){return `<div class="list-item"><strong>${esc(c.name)}</strong><div class="muted">${esc(c.condition||"")}</div></div>`}

function children(){
  content.innerHTML = `
  <div class="toolbar"><div class="muted">أضف ملفات الأطفال الخاصة بالمركز فقط.</div><div class="actions"><button class="btn primary" onclick="openChildForm()">+ إضافة طفل</button></div></div>
  <div class="card"><div class="table-wrap"><table><thead><tr><th>الاسم</th><th>العمر</th><th>الحالة/التشخيص</th><th>المجموعة</th><th>المتابع</th><th></th></tr></thead>
  <tbody>${APP.children.length?APP.children.map(c=>`<tr><td>${esc(c.name)}</td><td>${esc(c.age)}</td><td>${esc(c.condition)}</td><td>${esc(c.group)}</td><td>${esc(c.therapist)}</td><td><button class="btn secondary" onclick="viewChild('${c.id}')">فتح الملف</button></td></tr>`).join(""):`<tr><td colspan="6"><div class="empty">لا توجد ملفات أطفال.</div></td></tr>`}</tbody></table></div></div>`;
}
function openChildForm(){
  modal("إضافة ملف طفل", `
  <form onsubmit="saveChild(event)">
    <div class="form-grid">
      <label>اسم الطفل<input name="name" required></label><label>العمر<input name="age"></label>
      <label>الحالة/التشخيص<input name="condition"></label><label>المجموعة<input name="group"></label>
      <label>المتابع/الأخصائي<input name="therapist"></label><label>ولي الأمر<input name="guardian"></label>
      <label>الهاتف<input name="phone"></label><label>تاريخ الميلاد<input name="birth" type="date"></label>
      <label class="full-col">ملاحظات<textarea name="notes"></textarea></label>
    </div><button class="btn primary">حفظ الملف</button>
  </form>`);
}
function saveChild(e){
  e.preventDefault(); const f=new FormData(e.target);
  APP.children.push({id:id(),...Object.fromEntries(f),progress:0});
  closeModal(); children();
}
function viewChild(id){
  const c=APP.children.find(x=>x.id===id); if(!c)return;
  modal("ملف الطفل", `<div class="grid two">
    <div class="card"><h3>${esc(c.name)}</h3><p>العمر: ${esc(c.age)}</p><p>الحالة: ${esc(c.condition)}</p><p>المجموعة: ${esc(c.group)}</p><p>المتابع: ${esc(c.therapist)}</p></div>
    <div class="card"><p>ولي الأمر: ${esc(c.guardian)}</p><p>الهاتف: ${esc(c.phone)}</p><p>تاريخ الميلاد: ${esc(c.birth)}</p><p>ملاحظات: ${esc(c.notes)}</p></div></div>`);
}

function attendance(){
  content.innerHTML=`<div class="toolbar"><div class="muted">سجل الحضور اليومي للأطفال.</div><button class="btn primary" onclick="openAttendanceForm()">+ تسجيل حضور</button></div>
  <div class="card"><div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>الطفل</th><th>الحالة</th><th>وقت الدخول</th><th>وقت الانصراف</th></tr></thead><tbody>
  ${APP.attendance.length?APP.attendance.map(a=>`<tr><td>${esc(a.date)}</td><td>${esc(childName(a.childId))}</td><td>${esc(a.status)}</td><td>${esc(a.in)}</td><td>${esc(a.out)}</td></tr>`).join(""):`<tr><td colspan="5"><div class="empty">لا يوجد سجل حضور.</div></td></tr>`}</tbody></table></div></div>`;
}
function openAttendanceForm(){
  modal("تسجيل حضور", `<form onsubmit="saveAttendance(event)">
    <label>الطفل<select name="childId" required>${childOptions()}</select></label>
    <div class="form-grid"><label>التاريخ<input name="date" type="date" value="${today()}"></label><label>الحالة<select name="status"><option>present</option><option>absent</option><option>late</option><option>excused</option></select></label><label>وقت الدخول<input name="in" type="time"></label><label>وقت الانصراف<input name="out" type="time"></label></div>
    <button class="btn primary">حفظ</button></form>`);
}
function saveAttendance(e){e.preventDefault();const f=new FormData(e.target);APP.attendance.push({id:id(),...Object.fromEntries(f)});closeModal();attendance()}

function plans(){
  content.innerHTML=`<div class="toolbar"><div class="muted">خطط فردية بأهداف قابلة للقياس.</div><button class="btn primary" onclick="openPlanForm()">+ إضافة خطة</button></div>
  <div class="grid">${APP.plans.length?APP.plans.map(p=>`<div class="card"><div class="section-title"><h3>${esc(p.goal)}</h3><span>${esc(childName(p.childId))}</span></div><p class="muted">الأساس: ${esc(p.baseline)} — الهدف: ${esc(p.target)} — الفترة: ${esc(p.period)}</p><div class="progress"><i style="width:${Number(p.progress)||0}%"></i></div><small>${Number(p.progress)||0}%</small></div>`).join(""):'<div class="card empty">لا توجد خطط فردية.</div>'}</div>`;
}
function openPlanForm(){
 modal("إضافة خطة فردية",`<form onsubmit="savePlan(event)">
  <label>الطفل<select name="childId" required>${childOptions()}</select></label>
  <div class="form-grid"><label>الهدف<input name="goal" required></label><label>الفترة<input name="period" placeholder="مثال: 3 أشهر"></label><label>خط الأساس<input name="baseline"></label><label>المستهدف<input name="target"></label><label>نسبة التقدم %<input name="progress" type="number" min="0" max="100" value="0"></label></div>
  <button class="btn primary">حفظ الخطة</button></form>`);
}
function savePlan(e){e.preventDefault();const f=new FormData(e.target);APP.plans.push({id:id(),...Object.fromEntries(f)});closeModal();plans()}

function sessions(){
 content.innerHTML=`<div class="toolbar"><div class="muted">توثيق جلسات التخاطب والمهارات والملاحظات.</div><button class="btn primary" onclick="openSessionForm()">+ إضافة جلسة</button></div>
 <div class="card"><div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>الطفل</th><th>الأخصائي</th><th>الهدف</th><th>التقييم</th></tr></thead><tbody>
 ${APP.sessions.length?APP.sessions.map(s=>`<tr><td>${esc(s.date)}</td><td>${esc(childName(s.childId))}</td><td>${esc(s.therapist)}</td><td>${esc(s.goal)}</td><td>${esc(s.evaluation)}</td></tr>`).join(""):`<tr><td colspan="5"><div class="empty">لا توجد جلسات مسجلة.</div></td></tr>`}</tbody></table></div></div>`;
}
function openSessionForm(){
 modal("إضافة جلسة تخاطب",`<form onsubmit="saveSession(event)">
 <div class="form-grid"><label>الطفل<select name="childId" required>${childOptions()}</select></label><label>التاريخ<input name="date" type="date" value="${today()}"></label><label>الأخصائي<input name="therapist"></label><label>مدة الجلسة<input name="duration"></label><label>الهدف<input name="goal"></label><label>التقييم<input name="evaluation"></label><label class="full-col">ملاحظات<textarea name="notes"></textarea></label></div><button class="btn primary">حفظ الجلسة</button></form>`);
}
function saveSession(e){e.preventDefault();const f=new FormData(e.target);APP.sessions.push({id:id(),...Object.fromEntries(f)});closeModal();sessions()}

function reports(){
 content.innerHTML=`<div class="toolbar"><div class="muted">أنشئ تقارير متابعة بناءً على البيانات التي تدخلها.</div><button class="btn primary" onclick="openReportForm()">+ إضافة تقرير</button></div>
 <div class="grid">${APP.reports.length?APP.reports.map(r=>`<div class="card"><div class="section-title"><h3>${esc(r.title)}</h3><span>${esc(r.date)}</span></div><p>${esc(r.summary)}</p><button class="btn secondary" onclick="printReport('${r.id}')">طباعة</button></div>`).join(""):'<div class="card empty">لا توجد تقارير.</div>'}</div>`;
}
function openReportForm(){
 modal("إضافة تقرير",`<form onsubmit="saveReport(event)">
 <div class="form-grid"><label>الطفل<select name="childId" required>${childOptions()}</select></label><label>التاريخ<input name="date" type="date" value="${today()}"></label><label class="full-col">عنوان التقرير<input name="title" required></label><label class="full-col">ملخص التقرير<textarea name="summary" required></textarea></label></div><button class="btn primary">حفظ التقرير</button></form>`);
}
function saveReport(e){e.preventDefault();const f=new FormData(e.target);APP.reports.push({id:id(),...Object.fromEntries(f)});closeModal();reports()}
function printReport(id){
 const r=APP.reports.find(x=>x.id===id); if(!r)return;
 const w=window.open("","_blank"); w.document.write(`<html dir="rtl"><head><title>${esc(r.title)}</title></head><body style="font-family:Arial;padding:40px"><h1>${esc(r.title)}</h1><p>الطفل: ${esc(childName(r.childId))}</p><p>التاريخ: ${esc(r.date)}</p><hr><p>${esc(r.summary)}</p><script>window.print()<\/script></body></html>`);w.document.close();
}

function users(){
 content.innerHTML=`<div class="toolbar"><div class="muted">إدارة المستخدمين والأدوار. لا توجد حسابات افتراضية.</div><button class="btn primary" onclick="openUserForm()">+ إضافة مستخدم</button></div>
 <div class="card"><div class="table-wrap"><table><thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th></tr></thead><tbody>${APP.users.length?APP.users.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.roleLabel)}</td></tr>`).join(""):`<tr><td colspan="3"><div class="empty">لا يوجد مستخدمون في النموذج.</div></td></tr>`}</tbody></table></div></div>`;
}
function openUserForm(){
 modal("إضافة مستخدم",`<form onsubmit="saveUser(event)">
 <div class="form-grid"><label>الاسم<input name="name" required></label><label>البريد الإلكتروني<input name="email" type="email" required></label><label>الدور<select name="role"><option value="admin">أدمن أساسي</option><option value="supervisor">مشرف</option><option value="speech">مسؤول تخاطب</option></select></label><label>كلمة المرور<input name="password" type="password"></label></div>
 <p class="muted">هذا النموذج لا ينشئ حساب Firebase فعليًا؛ اربطه بـ Firebase Authentication.</p><button class="btn primary">حفظ</button></form>`);
}
function saveUser(e){e.preventDefault();const f=new FormData(e.target);const x=Object.fromEntries(f);x.id=id();x.roleLabel={admin:"أدمن أساسي",supervisor:"مشرف",speech:"مسؤول تخاطب"}[x.role];APP.users.push(x);closeModal();users()}

function settings(){
 content.innerHTML=`<div class="grid two">
  <div class="card"><h3>إعدادات المركز</h3><label>اسم المركز<input placeholder="أدخل اسم المركز"></label><label>الهاتف<input></label><label>العنوان<textarea></textarea></label><button class="btn primary">حفظ الإعدادات</button></div>
  <div class="card"><h3>الربط المقترح</h3><p class="muted">Firebase Authentication للحسابات، Firestore للبيانات، Storage للملفات والصور، وSecurity Rules للصلاحيات.</p><div class="list"><div class="list-item">users</div><div class="list-item">children</div><div class="list-item">plans</div><div class="list-item">sessions</div><div class="list-item">attendance</div><div class="list-item">reports</div><div class="list-item">auditLogs</div></div></div>
 </div>`;
}

function modal(title,body){$("#modalTitle").textContent=title;$("#modalBody").innerHTML=body;$("#modal").classList.remove("hidden")}
function closeModal(){$("#modal").classList.add("hidden");$("#modalBody").innerHTML=""}
function childOptions(){return APP.children.length?APP.children.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join(""):`<option value="">لا يوجد أطفال — أضف طفلًا أولًا</option>`}
function childName(id){return APP.children.find(c=>c.id===id)?.name||"—"}
function id(){return crypto.randomUUID?.()||String(Date.now()+Math.random())}
function today(){return new Date().toISOString().slice(0,10)}
function esc(v=""){return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
