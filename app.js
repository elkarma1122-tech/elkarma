import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  ref, push, set, update, remove, onValue, get, child as dbChild
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

/* =========================================================
   ثوابت: الأدوار والصلاحيات
   ========================================================= */
const ROLE_LABELS = {
  admin: "مدير النظام",
  manager: "مدير الحضانة",
  supervisor: "مشرف",
  therapist: "أخصائي تخاطب",
};
const ROLE_CLASS = { admin: "role-admin", manager: "role-manager", supervisor: "role-supervisor", therapist: "role-therapist" };

const PERMISSIONS = [
  { key: "manage_users", label: "إدارة المستخدمين والصلاحيات" },
  { key: "manage_children", label: "إضافة وتعديل بيانات الأطفال" },
  { key: "manage_assignments", label: "تعيين المتابعين (الفريق) للأطفال" },
  { key: "manage_progress", label: "تسجيل مراحل التقدم" },
  { key: "manage_plans", label: "إدارة الخطط العلاجية" },
  { key: "manage_reports", label: "إنشاء وتعديل التقارير" },
  { key: "view_reports", label: "الاطلاع على التقارير" },
];

function defaultPermissions(role) {
  const all = Object.fromEntries(PERMISSIONS.map(p => [p.key, false]));
  if (role === "admin") { Object.keys(all).forEach(k => all[k] = true); return all; }
  if (role === "manager") return { ...all, manage_children: true, manage_assignments: true, manage_progress: true, manage_plans: true, manage_reports: true, view_reports: true };
  if (role === "supervisor") return { ...all, manage_progress: true, manage_plans: true, manage_reports: true, view_reports: true };
  if (role === "therapist") return { ...all, manage_progress: true, manage_reports: true, view_reports: true };
  return all; // pending / no role
}

function can(user, perm) {
  if (!user || !user.role) return false;
  if (user.role === "admin") return true;
  return !!(user.permissions && user.permissions[perm]);
}

/* =========================================================
   الحالة العامة
   ========================================================= */
const state = {
  authUid: null,
  me: null,           // بروفايل المستخدم الحالي من users/{uid}
  users: {},
  children: {},
  assignments: {},
  milestones: {},
  plans: {},
  reports: {},
  view: "dashboard",
  childId: null,
  childTab: "info",
  loaded: { users: false, children: false, assignments: false, milestones: false, plans: false, reports: false },
};

/* =========================================================
   أدوات مساعدة
   ========================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const viewRoot = () => $("#viewRoot");

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  $("#toastRoot").appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function fmtDate(d) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" }); }
  catch { return d; }
}

function ageFromBirth(birthDate) {
  if (!birthDate) return "—";
  const b = new Date(birthDate), now = new Date();
  let years = now.getFullYear() - b.getFullYear();
  let months = now.getMonth() - b.getMonth();
  if (now.getDate() < b.getDate()) months--;
  if (months < 0) { years--; months += 12; }
  if (years <= 0) return `${months} شهر`;
  return `${years} سنة${months > 0 ? " و" + months + " شهر" : ""}`;
}

function initials(name) {
  if (!name) return "؟";
  return name.trim().split(" ").slice(0, 2).map(w => w[0]).join("");
}

function objToList(obj) {
  return Object.entries(obj || {}).map(([id, v]) => ({ id, ...v }));
}

function closeModal() { const m = $("#modalOverlay"); if (m) m.remove(); }

function openModal(html, { wide = false } = {}) {
  closeModal();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "modalOverlay";
  overlay.innerHTML = `<div class="modal ${wide ? "wide" : ""}">${html}</div>`;
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
  return overlay;
}

/* =========================================================
   المصادقة (Auth)
   ========================================================= */
$$(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    $$(".auth-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const isLogin = tab.dataset.authtab === "login";
    $("#loginForm").classList.toggle("hidden", !isLogin);
    $("#signupForm").classList.toggle("hidden", isLogin);
    $("#authError").classList.add("hidden");
  });
});

function showAuthError(err) {
  const box = $("#authError");
  box.textContent = translateAuthError(err);
  box.classList.remove("hidden");
}
function translateAuthError(err) {
  const code = err?.code || "";
  const map = {
    "auth/invalid-email": "البريد الإلكتروني غير صحيح",
    "auth/user-not-found": "لا يوجد حساب بهذا البريد",
    "auth/wrong-password": "كلمة المرور غير صحيحة",
    "auth/invalid-credential": "بيانات الدخول غير صحيحة",
    "auth/email-already-in-use": "البريد الإلكتروني مُستخدم بالفعل",
    "auth/weak-password": "كلمة المرور ضعيفة (6 أحرف على الأقل)",
    "custom/username-not-found": "لا يوجد حساب بهذا الاسم",
    "custom/username-taken": "اسم المستخدم ده محجوز، جرّب اسم تاني",
    "custom/invalid-username": "اسم المستخدم لازم يكون 3-20 حرف إنجليزي أو رقم (يسمح بـ _ و .)",
  };
  return map[code] || "حصل خطأ، حاول تاني";
}

// فايربيز أوث بيشتغل بالإيميل، فبنبني إيميل داخلي (وهمي) من اسم المستخدم
// عشان المستخدم يحس إنه بيدخل بـ"يوزر" عادي بس، من غير ما يكتب إيميل خالص
const USERNAME_DOMAIN = "nursery-app.local";
function usernameToEmail(username) { return `${username.toLowerCase()}@${USERNAME_DOMAIN}`; }
function normalizeUsername(u) { return (u || "").trim().toLowerCase(); }

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = normalizeUsername($("#loginUsername").value);
  try {
    const snap = await get(ref(db, "usernames/" + username));
    if (!snap.exists()) { showAuthError({ code: "custom/username-not-found" }); return; }
    const email = snap.val().email;
    await signInWithEmailAndPassword(auth, email, $("#loginPassword").value);
  } catch (err) { showAuthError(err); }
});

$("#signupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#signupName").value.trim();
  const username = normalizeUsername($("#signupUsername").value);
  const password = $("#signupPassword").value;

  if (!/^[a-z0-9_.\-]{3,20}$/.test(username)) {
    showAuthError({ code: "custom/invalid-username" });
    return;
  }

  try {
    // اتأكد إن اسم المستخدم مش مكرر
    const takenSnap = await get(ref(db, "usernames/" + username));
    if (takenSnap.exists()) { showAuthError({ code: "custom/username-taken" }); return; }

    // أول مستخدم في النظام يبقى أدمن تلقائيًا (تهيئة أول مرة)، وبعد كده أي حساب جديد يفضل معلّق لحد ما الأدمن يفعّله
    const usersSnap = await get(ref(db, "users"));
    const isFirstUser = !usersSnap.exists();

    const email = usernameToEmail(username);
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });

    const role = isFirstUser ? "admin" : null;
    await set(ref(db, "users/" + cred.user.uid), {
      name, username, email,
      role,
      permissions: defaultPermissions(role),
      createdAt: Date.now(),
    });
    await set(ref(db, "usernames/" + username), { uid: cred.user.uid, email });

    if (isFirstUser) toast("تم إنشاء أول حساب في النظام كمدير للنظام");
    else toast("تم إنشاء الحساب، في انتظار تفعيل الأدمن للدور");
  } catch (err) { showAuthError(err); }
});

$("#logoutBtn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user) {
    state.authUid = user.uid;
    listenAll();
  } else {
    state.authUid = null;
    state.me = null;
    $("#authScreen").classList.remove("hidden");
    $("#appScreen").classList.add("hidden");
  }
});

/* =========================================================
   الاستماع اللحظي (Realtime listeners)
   ========================================================= */
function listenAll() {
  onValue(ref(db, "users"), (snap) => {
    state.users = snap.val() || {};
    state.loaded.users = true;
    state.me = state.authUid ? { uid: state.authUid, ...(state.users[state.authUid] || {}) } : null;
    afterAuthReady();
    renderShell();
    renderCurrentView();
  });
  onValue(ref(db, "children"), (snap) => { state.children = snap.val() || {}; state.loaded.children = true; renderCurrentView(); });
  onValue(ref(db, "assignments"), (snap) => { state.assignments = snap.val() || {}; state.loaded.assignments = true; renderCurrentView(); });
  onValue(ref(db, "milestones"), (snap) => { state.milestones = snap.val() || {}; state.loaded.milestones = true; renderCurrentView(); });
  onValue(ref(db, "plans"), (snap) => { state.plans = snap.val() || {}; state.loaded.plans = true; renderCurrentView(); });
  onValue(ref(db, "reports"), (snap) => { state.reports = snap.val() || {}; state.loaded.reports = true; renderCurrentView(); });
}

function afterAuthReady() {
  $("#authScreen").classList.add("hidden");
  $("#appScreen").classList.remove("hidden");
}

/* =========================================================
   القشرة العامة: القوائم الجانبية وبيانات المستخدم
   ========================================================= */
function renderShell() {
  const me = state.me;
  if (!me) return;
  $("#topUserName").textContent = me.name || me.email || "مستخدم";
  $("#topUserRole").textContent = me.role ? ROLE_LABELS[me.role] : "بانتظار التفعيل";
  $("#topUserAvatar").textContent = initials(me.name);
  $("#sideRoleChip").textContent = me.role ? ROLE_LABELS[me.role] : "بانتظار التفعيل";
  $("#navUsers").classList.toggle("hidden", !can(me, "manage_users"));
}

$$(".nav-item[data-nav]").forEach(btn => {
  btn.addEventListener("click", () => {
    state.view = btn.dataset.nav;
    state.childId = null;
    $$(".nav-item[data-nav]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    renderCurrentView();
  });
});

/* =========================================================
   الموجّه (Router)
   ========================================================= */
function renderCurrentView() {
  if (!state.me) return;
  if (!state.me.role) return renderPending();

  const titles = {
    dashboard: ["لوحة التحكم", "نظرة عامة على الحضانة اليوم"],
    children: ["الأطفال", "بيانات الأطفال ومتابعتهم"],
    reports: ["التقارير", "كل التقارير المسجّلة على مستوى الحضانة"],
    users: ["المستخدمون والصلاحيات", "إدارة الأدوار وتحديد الصلاحيات"],
    childDetail: ["ملف الطفل", ""],
  };
  const t = titles[state.view] || ["", ""];
  $("#pageTitle").textContent = t[0];
  $("#pageSub").textContent = t[1];

  if (state.view === "dashboard") return renderDashboard();
  if (state.view === "children") return renderChildrenList();
  if (state.view === "reports") return renderGlobalReports();
  if (state.view === "users") return can(state.me, "manage_users") ? renderUsers() : renderNoAccess();
  if (state.view === "childDetail") return renderChildDetail();
}

function renderNoAccess() {
  viewRoot().innerHTML = `<div class="card empty"><div class="big">🚫</div><h3>مفيش صلاحية</h3><p>محتاج صلاحية إضافية من الأدمن عشان تدخل هنا</p></div>`;
}

function renderPending() {
  $("#pageTitle").textContent = "بانتظار التفعيل";
  $("#pageSub").textContent = "";
  viewRoot().innerHTML = `
    <div class="card empty">
      <div class="big">⏳</div>
      <h3>حسابك بانتظار التفعيل</h3>
      <p>الأدمن هيراجع حسابك ويحدد دورك وصلاحياتك (مدير / مشرف / أخصائي تخاطب) قريبًا</p>
    </div>`;
}

/* =========================================================
   لوحة التحكم
   ========================================================= */
function renderDashboard() {
  const childrenList = objToList(state.children);
  const usersList = objToList(state.users);
  const reportsList = objToList(state.reports);
  const activeAssignments = objToList(state.assignments).filter(a => !a.to);

  const recentReports = reportsList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);

  viewRoot().innerHTML = `
    <div class="grid grid-4">
      ${statCard("👶", childrenList.length, "عدد الأطفال المسجّلين", "teal")}
      ${statCard("🧑‍⚕️", usersList.filter(u => u.role === "therapist").length, "أخصائيو تخاطب", "plum")}
      ${statCard("🔗", activeAssignments.length, "متابعات نشطة حاليًا", "apricot")}
      ${statCard("📄", reportsList.length, "إجمالي التقارير", "rose")}
    </div>

    <div class="section-title"><h3>أحدث التقارير</h3></div>
    <div class="list-card">
      ${recentReports.length ? recentReports.map(r => reportRow(r)).join("") : emptyRow("لسه مفيش تقارير مسجّلة")}
    </div>
  `;
  bindReportRowClicks();
}

function statCard(icon, num, lbl, color) {
  const tint = { teal: "var(--teal-tint)", plum: "var(--plum-tint)", apricot: "var(--apricot-tint)", rose: "var(--rose-tint)" }[color];
  const fg = { teal: "var(--teal-dark)", plum: "var(--plum)", apricot: "#8a5417", rose: "var(--rose)" }[color];
  return `<div class="card stat-card">
    <div class="icon" style="background:${tint};color:${fg}">${icon}</div>
    <div class="num">${num}</div>
    <div class="lbl">${lbl}</div>
  </div>`;
}

function emptyRow(msg) { return `<div class="empty">${msg}</div>`; }

/* =========================================================
   الأطفال — القائمة
   ========================================================= */
function renderChildrenList() {
  const list = objToList(state.children).sort((a, b) => (a.name || "").localeCompare(b.name || "", "ar"));
  const addBtn = can(state.me, "manage_children")
    ? `<button class="btn btn-primary" id="addChildBtn">+ إضافة طفل</button>` : "";

  viewRoot().innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:16px">${addBtn}</div>
    <div class="list-card">
      ${list.length ? list.map(c => childRow(c)).join("") : emptyRow("لسه مفيش أطفال مسجّلين — ابدأ بإضافة طفل")}
    </div>
  `;
  $("#addChildBtn")?.addEventListener("click", () => openChildForm());
  $$(".js-open-child").forEach(el => el.addEventListener("click", () => {
    state.view = "childDetail"; state.childId = el.dataset.id; state.childTab = "info";
    renderCurrentView();
  }));
  $$(".js-edit-child").forEach(el => el.addEventListener("click", (e) => { e.stopPropagation(); openChildForm(el.dataset.id); }));
  $$(".js-del-child").forEach(el => el.addEventListener("click", (e) => { e.stopPropagation(); confirmDeleteChild(el.dataset.id); }));
}

function childRow(c) {
  const canEdit = can(state.me, "manage_children");
  return `
  <div class="row js-open-child" data-id="${c.id}" style="cursor:pointer">
    <div class="row-main">
      <div class="row-avatar">${initials(c.name)}</div>
      <div>
        <div class="row-title">${esc(c.name)}</div>
        <div class="row-sub">العمر: ${ageFromBirth(c.birthDate)} · تاريخ الالتحاق: ${fmtDate(c.enrollDate)}</div>
      </div>
    </div>
    <div class="row-actions">
      <span class="badge ${c.status === "paused" ? "badge-gray" : "badge-teal"}">${c.status === "paused" ? "متوقف" : "نشط"}</span>
      ${canEdit ? `<button class="btn btn-ghost btn-sm js-edit-child" data-id="${c.id}">تعديل</button>
      <button class="btn btn-danger btn-sm js-del-child" data-id="${c.id}">حذف</button>` : ""}
    </div>
  </div>`;
}

function esc(s) { return (s ?? "").toString().replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }

function openChildForm(id) {
  const c = id ? state.children[id] : {};
  openModal(`
    <div class="modal-head"><h3>${id ? "تعديل بيانات الطفل" : "إضافة طفل جديد"}</h3><button class="modal-close" id="mClose">✕</button></div>
    <form id="childForm">
      <div class="grid grid-2">
        <div class="field"><label>اسم الطفل</label><input type="text" id="cf_name" required value="${esc(c.name)}"></div>
        <div class="field"><label>تاريخ الميلاد</label><input type="date" id="cf_birthDate" required value="${c.birthDate || ""}"></div>
        <div class="field"><label>النوع</label>
          <select id="cf_gender">
            <option value="ذكر" ${c.gender === "ذكر" ? "selected" : ""}>ذكر</option>
            <option value="أنثى" ${c.gender === "أنثى" ? "selected" : ""}>أنثى</option>
          </select>
        </div>
        <div class="field"><label>تاريخ الالتحاق بالحضانة</label><input type="date" id="cf_enrollDate" value="${c.enrollDate || ""}"></div>
        <div class="field"><label>اسم ولي الأمر</label><input type="text" id="cf_parentName" value="${esc(c.parentName)}"></div>
        <div class="field"><label>رقم تواصل ولي الأمر</label><input type="tel" id="cf_parentPhone" value="${esc(c.parentPhone)}"></div>
      </div>
      <div class="field"><label>التشخيص / الحالة</label><input type="text" id="cf_diagnosis" placeholder="مثال: تأخر لغوي، اضطراب نطق..." value="${esc(c.diagnosis)}"></div>
      <div class="field"><label>ملاحظات عامة</label><textarea id="cf_notes">${esc(c.notes)}</textarea></div>
      <div class="field"><label>الحالة</label>
        <select id="cf_status">
          <option value="active" ${c.status !== "paused" ? "selected" : ""}>نشط</option>
          <option value="paused" ${c.status === "paused" ? "selected" : ""}>متوقف مؤقتًا</option>
        </select>
      </div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-ghost" id="mCancel">إلغاء</button>
      </div>
    </form>
  `);
  $("#mClose").onclick = $("#mCancel").onclick = closeModal;
  $("#childForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = {
      name: $("#cf_name").value.trim(),
      birthDate: $("#cf_birthDate").value,
      gender: $("#cf_gender").value,
      enrollDate: $("#cf_enrollDate").value,
      parentName: $("#cf_parentName").value.trim(),
      parentPhone: $("#cf_parentPhone").value.trim(),
      diagnosis: $("#cf_diagnosis").value.trim(),
      notes: $("#cf_notes").value.trim(),
      status: $("#cf_status").value,
    };
    try {
      if (id) { await update(ref(db, "children/" + id), data); toast("تم تحديث بيانات الطفل"); }
      else {
        data.createdAt = Date.now(); data.createdBy = state.authUid;
        await push(ref(db, "children"), data);
        toast("تمت إضافة الطفل");
      }
      closeModal();
    } catch (err) { toast("حصل خطأ أثناء الحفظ"); console.error(err); }
  });
}

function confirmDeleteChild(id) {
  const c = state.children[id];
  openModal(`
    <div class="modal-head"><h3>حذف الطفل</h3><button class="modal-close" id="mClose">✕</button></div>
    <p>هل أنت متأكد من حذف <b>${esc(c?.name)}</b>؟ هيتم حذف كل البيانات المرتبطة بيه (المتابعون، التقدم، الخطط، التقارير) ولا يمكن التراجع.</p>
    <div class="modal-actions">
      <button class="btn btn-danger" id="confirmDel">حذف نهائي</button>
      <button class="btn btn-ghost" id="mCancel">إلغاء</button>
    </div>
  `);
  $("#mClose").onclick = $("#mCancel").onclick = closeModal;
  $("#confirmDel").onclick = async () => {
    const updates = { ["children/" + id]: null };
    objToList(state.assignments).filter(a => a.childId === id).forEach(a => updates["assignments/" + a.id] = null);
    objToList(state.milestones).filter(m => m.childId === id).forEach(m => updates["milestones/" + m.id] = null);
    objToList(state.plans).filter(p => p.childId === id).forEach(p => updates["plans/" + p.id] = null);
    objToList(state.reports).filter(r => r.childId === id).forEach(r => updates["reports/" + r.id] = null);
    await update(ref(db), updates);
    toast("تم حذف الطفل وكل بياناته");
    closeModal();
    if (state.view === "childDetail" && state.childId === id) { state.view = "children"; }
    renderCurrentView();
  };
}

/* =========================================================
   ملف الطفل — تفاصيل بتابات
   ========================================================= */
function renderChildDetail() {
  const c = state.children[state.childId];
  if (!c) { state.view = "children"; return renderCurrentView(); }
  $("#pageTitle").textContent = c.name;
  $("#pageSub").textContent = `العمر ${ageFromBirth(c.birthDate)} · تاريخ الميلاد ${fmtDate(c.birthDate)}`;

  const tabs = [
    ["info", "البيانات"],
    ["followers", "المتابعون"],
    ["progress", "مراحل التقدم"],
    ["plan", "الخطة العلاجية"],
    ["reports", "التقارير"],
  ];

  viewRoot().innerHTML = `
    <button class="btn btn-ghost btn-sm" id="backToChildren" style="margin-bottom:14px">→ رجوع لكل الأطفال</button>
    <div class="tabs">
      ${tabs.map(([k, l]) => `<button class="tab ${state.childTab === k ? "active" : ""}" data-tab="${k}">${l}</button>`).join("")}
    </div>
    <div id="childTabBody"></div>
  `;
  $("#backToChildren").onclick = () => { state.view = "children"; renderCurrentView(); };
  $$(".tab[data-tab]").forEach(t => t.onclick = () => { state.childTab = t.dataset.tab; renderCurrentView(); });

  const body = $("#childTabBody");
  if (state.childTab === "info") body.innerHTML = childInfoTab(c);
  if (state.childTab === "followers") return renderFollowersTab(c);
  if (state.childTab === "progress") return renderProgressTab(c);
  if (state.childTab === "plan") return renderPlanTab(c);
  if (state.childTab === "reports") return renderChildReportsTab(c);
}

function childInfoTab(c) {
  return `
  <div class="card">
    <div class="grid grid-2">
      ${infoField("الاسم", c.name)}
      ${infoField("تاريخ الميلاد", fmtDate(c.birthDate))}
      ${infoField("العمر الحالي", ageFromBirth(c.birthDate))}
      ${infoField("النوع", c.gender)}
      ${infoField("تاريخ الالتحاق", fmtDate(c.enrollDate))}
      ${infoField("الحالة", c.status === "paused" ? "متوقف مؤقتًا" : "نشط")}
      ${infoField("اسم ولي الأمر", c.parentName)}
      ${infoField("رقم التواصل", c.parentPhone)}
      ${infoField("التشخيص / الحالة", c.diagnosis)}
    </div>
    ${c.notes ? `<div style="margin-top:16px"><div class="hint" style="font-weight:800;color:var(--ink);margin-bottom:6px">ملاحظات</div><p>${esc(c.notes)}</p></div>` : ""}
  </div>`;
}
function infoField(label, val) {
  return `<div><div class="hint" style="margin-bottom:2px">${label}</div><div style="font-weight:700">${esc(val) || "—"}</div></div>`;
}

/* ---------- المتابعون (الفريق المسؤول عن الطفل) ---------- */
function renderFollowersTab(c) {
  const list = objToList(state.assignments).filter(a => a.childId === c.id)
    .sort((a, b) => (b.from || "").localeCompare(a.from || ""));
  const canManage = can(state.me, "manage_assignments");

  $("#childTabBody").innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
      ${canManage ? `<button class="btn btn-primary btn-sm" id="addFollower">+ إضافة متابع</button>` : ""}
    </div>
    <div class="list-card">
      ${list.length ? list.map(a => followerRow(a, canManage)).join("") : emptyRow("لسه مفيش متابعين معينين لهذا الطفل")}
    </div>
  `;
  $("#addFollower")?.addEventListener("click", () => openFollowerForm(c.id));
  $$(".js-end-follow").forEach(b => b.onclick = async () => {
    await update(ref(db, "assignments/" + b.dataset.id), { to: new Date().toISOString().slice(0, 10) });
    toast("تم إنهاء متابعة هذا الشخص للطفل");
  });
  $$(".js-del-follow").forEach(b => b.onclick = async () => {
    await remove(ref(db, "assignments/" + b.dataset.id));
    toast("تم حذف المتابعة");
  });
}

function followerRow(a, canManage) {
  const active = !a.to;
  return `
  <div class="row">
    <div class="row-main">
      <div class="row-avatar">${initials(a.staffName)}</div>
      <div>
        <div class="row-title">${esc(a.staffName)} <span class="tag-role ${ROLE_CLASS[a.staffRole] || "role-therapist"}">${ROLE_LABELS[a.staffRole] || a.staffRole || ""}</span></div>
        <div class="row-sub">من ${fmtDate(a.from)} ${active ? "— لحد النهاردة (مستمر)" : "إلى " + fmtDate(a.to)}${a.notes ? " · " + esc(a.notes) : ""}</div>
      </div>
    </div>
    <div class="row-actions">
      <span class="badge ${active ? "badge-teal" : "badge-gray"}">${active ? "متابعة نشطة" : "منتهية"}</span>
      ${canManage && active ? `<button class="btn btn-ghost btn-sm js-end-follow" data-id="${a.id}">إنهاء المتابعة</button>` : ""}
      ${canManage ? `<button class="btn btn-danger btn-sm js-del-follow" data-id="${a.id}">حذف</button>` : ""}
    </div>
  </div>`;
}

function openFollowerForm(childId) {
  const staffOptions = objToList(state.users).filter(u => u.role && u.role !== "admin" || u.role === "admin")
    .map(u => `<option value="${u.uid}" data-role="${u.role}">${esc(u.name)} — ${ROLE_LABELS[u.role] || ""}</option>`).join("");
  openModal(`
    <div class="modal-head"><h3>إضافة متابع للطفل</h3><button class="modal-close" id="mClose">✕</button></div>
    <form id="folForm">
      <div class="field"><label>الموظف / الأخصائي</label>
        <select id="fl_staff" required>${staffOptions}</select>
      </div>
      <div class="grid grid-2">
        <div class="field"><label>من تاريخ</label><input type="date" id="fl_from" required value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label>إلى تاريخ (اختياري — سيبها فاضية لو المتابعة مستمرة)</label><input type="date" id="fl_to"></div>
      </div>
      <div class="field"><label>ملاحظات</label><input type="text" id="fl_notes" placeholder="مثال: جلسات تخاطب مرتين أسبوعيًا"></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">إضافة</button>
        <button type="button" class="btn btn-ghost" id="mCancel">إلغاء</button>
      </div>
    </form>
  `);
  $("#mClose").onclick = $("#mCancel").onclick = closeModal;
  $("#folForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const sel = $("#fl_staff");
    const staffUid = sel.value;
    const staffRole = sel.selectedOptions[0].dataset.role;
    const staffName = state.users[staffUid]?.name || "";
    await push(ref(db, "assignments"), {
      childId, staffUid, staffName, staffRole,
      from: $("#fl_from").value, to: $("#fl_to").value || null,
      notes: $("#fl_notes").value.trim(), createdAt: Date.now(), createdBy: state.authUid,
    });
    toast("تمت إضافة المتابع");
    closeModal();
  });
}

/* ---------- مراحل التقدم ---------- */
function renderProgressTab(c) {
  const list = objToList(state.milestones).filter(m => m.childId === c.id)
    .sort((a, b) => (b.achievedDate || "").localeCompare(a.achievedDate || ""));
  const canManage = can(state.me, "manage_progress");

  $("#childTabBody").innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
      ${canManage ? `<button class="btn btn-primary btn-sm" id="addMilestone">+ تسجيل مرحلة تقدم</button>` : ""}
    </div>
    <div class="card">
      ${list.length ? `<div class="progress-track">${list.map(m => progressItem(m, canManage)).join("")}</div>` : emptyRow("لسه مفيش مراحل تقدم مسجّلة")}
    </div>
  `;
  $("#addMilestone")?.addEventListener("click", () => openMilestoneForm(c.id));
  $$(".js-del-mile").forEach(b => b.onclick = async () => { await remove(ref(db, "milestones/" + b.dataset.id)); toast("تم الحذف"); });
}

function progressItem(m, canManage) {
  return `
  <div class="progress-item">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div class="pd-title">${esc(m.stageTitle)} <span class="badge badge-plum">${esc(m.category || "")}</span></div>
        <div class="pd-meta">بتاريخ ${fmtDate(m.achievedDate)} — سجّلها ${esc(state.users[m.recordedBy]?.name || "")}</div>
      </div>
      ${canManage ? `<button class="btn btn-danger btn-sm js-del-mile" data-id="${m.id}">حذف</button>` : ""}
    </div>
    ${m.description ? `<div class="pd-notes">${esc(m.description)}</div>` : ""}
  </div>`;
}

function openMilestoneForm(childId) {
  openModal(`
    <div class="modal-head"><h3>تسجيل مرحلة تقدم جديدة</h3><button class="modal-close" id="mClose">✕</button></div>
    <form id="mileForm">
      <div class="field"><label>عنوان المرحلة</label><input type="text" id="ms_title" required placeholder="مثال: نطق أول كلمة مفهومة"></div>
      <div class="field"><label>المجال</label>
        <select id="ms_cat">
          <option>النطق</option><option>اللغة الاستيعابية</option><option>اللغة التعبيرية</option>
          <option>التواصل الاجتماعي</option><option>المهارات الحركية</option><option>أخرى</option>
        </select>
      </div>
      <div class="field"><label>تاريخ التحقق</label><input type="date" id="ms_date" required value="${new Date().toISOString().slice(0, 10)}"></div>
      <div class="field"><label>وصف / ملاحظات</label><textarea id="ms_desc"></textarea></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-ghost" id="mCancel">إلغاء</button>
      </div>
    </form>
  `);
  $("#mClose").onclick = $("#mCancel").onclick = closeModal;
  $("#mileForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await push(ref(db, "milestones"), {
      childId, stageTitle: $("#ms_title").value.trim(), category: $("#ms_cat").value,
      achievedDate: $("#ms_date").value, description: $("#ms_desc").value.trim(),
      recordedBy: state.authUid, recordedAt: Date.now(),
    });
    toast("تم تسجيل مرحلة التقدم");
    closeModal();
  });
}

/* ---------- الخطة العلاجية ---------- */
function renderPlanTab(c) {
  const list = objToList(state.plans).filter(p => p.childId === c.id).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const canManage = can(state.me, "manage_plans");

  $("#childTabBody").innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
      ${canManage ? `<button class="btn btn-primary btn-sm" id="addPlan">+ خطة جديدة</button>` : ""}
    </div>
    <div class="grid grid-2">
      ${list.length ? list.map(p => planCard(p, canManage)).join("") : `<div class="card empty">${emptyRow("لسه مفيش خطة علاجية لهذا الطفل")}</div>`}
    </div>
  `;
  $("#addPlan")?.addEventListener("click", () => openPlanForm(c.id));
  $$(".js-edit-plan").forEach(b => b.onclick = () => openPlanForm(c.id, b.dataset.id));
  $$(".js-del-plan").forEach(b => b.onclick = async () => { await remove(ref(db, "plans/" + b.dataset.id)); toast("تم الحذف"); });
}

const PLAN_STATUS = { active: ["قيد التنفيذ", "badge-teal"], done: ["منجزة", "badge-plum"], paused: ["متوقفة", "badge-gray"] };
function planCard(p, canManage) {
  const st = PLAN_STATUS[p.status] || PLAN_STATUS.active;
  return `
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
      <h4>${esc(p.title)}</h4>
      <span class="badge ${st[1]}">${st[0]}</span>
    </div>
    <div class="hint" style="margin-bottom:10px">من ${fmtDate(p.startDate)} إلى ${fmtDate(p.targetDate)}</div>
    <p style="white-space:pre-wrap;font-size:13.5px;line-height:1.8">${esc(p.goals)}</p>
    ${canManage ? `<div class="modal-actions" style="border:none;padding-top:12px">
      <button class="btn btn-ghost btn-sm js-edit-plan" data-id="${p.id}">تعديل</button>
      <button class="btn btn-danger btn-sm js-del-plan" data-id="${p.id}">حذف</button>
    </div>` : ""}
  </div>`;
}

function openPlanForm(childId, id) {
  const p = id ? state.plans[id] : {};
  openModal(`
    <div class="modal-head"><h3>${id ? "تعديل الخطة" : "خطة علاجية جديدة"}</h3><button class="modal-close" id="mClose">✕</button></div>
    <form id="planForm">
      <div class="field"><label>عنوان الخطة</label><input type="text" id="pl_title" required value="${esc(p.title)}" placeholder="مثال: خطة تنمية اللغة التعبيرية"></div>
      <div class="grid grid-2">
        <div class="field"><label>تاريخ البدء</label><input type="date" id="pl_start" value="${p.startDate || new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label>التاريخ المستهدف</label><input type="date" id="pl_target" value="${p.targetDate || ""}"></div>
      </div>
      <div class="field"><label>الحالة</label>
        <select id="pl_status">
          <option value="active" ${p.status !== "done" && p.status !== "paused" ? "selected" : ""}>قيد التنفيذ</option>
          <option value="done" ${p.status === "done" ? "selected" : ""}>منجزة</option>
          <option value="paused" ${p.status === "paused" ? "selected" : ""}>متوقفة</option>
        </select>
      </div>
      <div class="field"><label>الأهداف والخطوات</label><textarea id="pl_goals" rows="5" placeholder="اكتب الأهداف والخطوات التفصيلية للخطة">${esc(p.goals)}</textarea></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-ghost" id="mCancel">إلغاء</button>
      </div>
    </form>
  `);
  $("#mClose").onclick = $("#mCancel").onclick = closeModal;
  $("#planForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = {
      childId, title: $("#pl_title").value.trim(), startDate: $("#pl_start").value,
      targetDate: $("#pl_target").value, status: $("#pl_status").value, goals: $("#pl_goals").value.trim(),
      updatedAt: Date.now(),
    };
    if (id) await update(ref(db, "plans/" + id), data);
    else { data.createdBy = state.authUid; data.createdAt = Date.now(); await push(ref(db, "plans"), data); }
    toast("تم حفظ الخطة");
    closeModal();
  });
}

/* ---------- تقارير الطفل ---------- */
function renderChildReportsTab(c) {
  const list = objToList(state.reports).filter(r => r.childId === c.id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const canManage = can(state.me, "manage_reports");
  $("#childTabBody").innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
      ${canManage ? `<button class="btn btn-primary btn-sm" id="addReport">+ تقرير جديد</button>` : ""}
    </div>
    <div class="list-card">${list.length ? list.map(r => reportRow(r, canManage)).join("") : emptyRow("لسه مفيش تقارير لهذا الطفل")}</div>
  `;
  $("#addReport")?.addEventListener("click", () => openReportForm(c.id));
  bindReportRowClicks(canManage);
}

const REPORT_TYPES = { session: "تقرير جلسة", monthly: "تقرير شهري", assessment: "تقرير تقييم" };
function reportRow(r, canManage) {
  const childName = state.children[r.childId]?.name || "";
  return `
  <div class="row js-view-report" data-id="${r.id}" style="cursor:pointer">
    <div class="row-main">
      <div class="row-avatar">📄</div>
      <div>
        <div class="row-title">${esc(r.title)}</div>
        <div class="row-sub">${childName ? esc(childName) + " · " : ""}${REPORT_TYPES[r.type] || r.type} · ${fmtDate(r.date)}</div>
      </div>
    </div>
    ${canManage ? `<button class="btn btn-danger btn-sm js-del-report" data-id="${r.id}">حذف</button>` : ""}
  </div>`;
}
function bindReportRowClicks(canManage) {
  $$(".js-view-report").forEach(el => el.addEventListener("click", (e) => {
    if (e.target.closest(".js-del-report")) return;
    viewReport(el.dataset.id);
  }));
  $$(".js-del-report").forEach(el => el.addEventListener("click", async (e) => {
    e.stopPropagation();
    await remove(ref(db, "reports/" + el.dataset.id));
    toast("تم حذف التقرير");
  }));
}
function viewReport(id) {
  const r = state.reports[id];
  openModal(`
    <div class="modal-head"><h3>${esc(r.title)}</h3><button class="modal-close" id="mClose">✕</button></div>
    <div class="hint" style="margin-bottom:12px">${state.children[r.childId]?.name ? "الطفل: " + esc(state.children[r.childId].name) + " · " : ""}${REPORT_TYPES[r.type] || r.type} · ${fmtDate(r.date)}</div>
    <p style="white-space:pre-wrap;line-height:1.9">${esc(r.content)}</p>
    <div class="modal-actions"><button class="btn btn-ghost" id="mCancel">إغلاق</button></div>
  `);
  $("#mClose").onclick = $("#mCancel").onclick = closeModal;
}
function openReportForm(childId) {
  openModal(`
    <div class="modal-head"><h3>تقرير جديد</h3><button class="modal-close" id="mClose">✕</button></div>
    <form id="repForm">
      <div class="field"><label>عنوان التقرير</label><input type="text" id="rp_title" required></div>
      <div class="grid grid-2">
        <div class="field"><label>نوع التقرير</label>
          <select id="rp_type">
            <option value="session">تقرير جلسة</option>
            <option value="monthly">تقرير شهري</option>
            <option value="assessment">تقرير تقييم</option>
          </select>
        </div>
        <div class="field"><label>التاريخ</label><input type="date" id="rp_date" required value="${new Date().toISOString().slice(0, 10)}"></div>
      </div>
      <div class="field"><label>محتوى التقرير</label><textarea id="rp_content" rows="6" required></textarea></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ التقرير</button>
        <button type="button" class="btn btn-ghost" id="mCancel">إلغاء</button>
      </div>
    </form>
  `);
  $("#mClose").onclick = $("#mCancel").onclick = closeModal;
  $("#repForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await push(ref(db, "reports"), {
      childId, title: $("#rp_title").value.trim(), type: $("#rp_type").value,
      date: $("#rp_date").value, content: $("#rp_content").value.trim(),
      createdBy: state.authUid, createdAt: Date.now(),
    });
    toast("تم حفظ التقرير");
    closeModal();
  });
}

/* =========================================================
   التقارير على مستوى الحضانة كلها
   ========================================================= */
function renderGlobalReports() {
  const list = objToList(state.reports).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  viewRoot().innerHTML = `<div class="list-card">${list.length ? list.map(r => reportRow(r, can(state.me, "manage_reports"))).join("") : emptyRow("لسه مفيش تقارير")}</div>`;
  bindReportRowClicks(can(state.me, "manage_reports"));
}

/* =========================================================
   المستخدمون والصلاحيات (Admin فقط)
   ========================================================= */
function renderUsers() {
  const list = objToList(state.users).sort((a, b) => (a.name || "").localeCompare(b.name || "", "ar"));
  viewRoot().innerHTML = `<div class="list-card">${list.map(u => userRow(u)).join("")}</div>`;
  $$(".js-manage-user").forEach(b => b.onclick = () => openUserPermForm(b.dataset.id));
}

function userRow(u) {
  const pending = !u.role;
  return `
  <div class="row">
    <div class="row-main">
      <div class="row-avatar">${initials(u.name)}</div>
      <div>
        <div class="row-title">${esc(u.name)} ${u.uid === state.authUid ? "<span class='badge badge-gray'>أنت</span>" : ""}</div>
        <div class="row-sub">${esc(u.email)}</div>
      </div>
    </div>
    <div class="row-actions">
      <span class="tag-role ${pending ? "role-therapist" : ROLE_CLASS[u.role]}" style="${pending ? "background:var(--rose-tint);color:var(--rose)" : ""}">${pending ? "بانتظار التفعيل" : ROLE_LABELS[u.role]}</span>
      <button class="btn btn-ghost btn-sm js-manage-user" data-id="${u.uid}">الدور والصلاحيات</button>
    </div>
  </div>`;
}

function openUserPermForm(uid) {
  const u = state.users[uid];
  const permsHtml = PERMISSIONS.map(p => `
    <div class="perm-item">
      <input type="checkbox" id="perm_${p.key}" data-key="${p.key}" ${u.permissions?.[p.key] ? "checked" : ""}>
      <label for="perm_${p.key}">${p.label}</label>
    </div>`).join("");

  openModal(`
    <div class="modal-head"><h3>${esc(u.name)} — الدور والصلاحيات</h3><button class="modal-close" id="mClose">✕</button></div>
    <div class="field">
      <label>الدور الوظيفي</label>
      <select id="userRole">
        <option value="" ${!u.role ? "selected" : ""}>بانتظار التفعيل</option>
        <option value="admin" ${u.role === "admin" ? "selected" : ""}>مدير النظام</option>
        <option value="manager" ${u.role === "manager" ? "selected" : ""}>مدير الحضانة</option>
        <option value="supervisor" ${u.role === "supervisor" ? "selected" : ""}>مشرف</option>
        <option value="therapist" ${u.role === "therapist" ? "selected" : ""}>أخصائي تخاطب</option>
      </select>
      <p class="hint">اختيار دور بيحدّث الصلاحيات تلقائيًا بالإعدادات الافتراضية، وتقدر بعد كده تعدّل عليها يدويًا تحت</p>
    </div>
    <div class="field">
      <label>الصلاحيات التفصيلية</label>
      <div class="perm-grid">${permsHtml}</div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" id="saveUserBtn">حفظ</button>
      <button class="btn btn-ghost" id="mCancel">إلغاء</button>
    </div>
  `);
  $("#mClose").onclick = $("#mCancel").onclick = closeModal;

  $("#userRole").addEventListener("change", (e) => {
    const defs = defaultPermissions(e.target.value || null);
    PERMISSIONS.forEach(p => { $("#perm_" + p.key).checked = !!defs[p.key]; });
  });

  $("#saveUserBtn").onclick = async () => {
    const role = $("#userRole").value || null;
    const permissions = {};
    PERMISSIONS.forEach(p => permissions[p.key] = $("#perm_" + p.key).checked);
    if (uid === state.authUid && role !== "admin" && u.role === "admin") {
      const otherAdmins = objToList(state.users).some(x => x.uid !== uid && x.role === "admin");
      if (!otherAdmins) { toast("لازم يفضل أدمن واحد على الأقل في النظام"); return; }
    }
    await update(ref(db, "users/" + uid), { role, permissions });
    toast("تم تحديث بيانات المستخدم");
    closeModal();
  };
}
