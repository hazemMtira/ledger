(function () {
"use strict";

var CFG = window.LEDGER_CONFIG || {};

var CATS = {
  expense: ["Food", "Rent", "Transport", "Bills", "Health", "Fun", "Shopping", "Education", "Other"],
  income: ["Salary", "Freelance", "Gift", "Other income"]
};
var COLORS = {
  Food: "#d99a1f", Rent: "#2f7f86", Transport: "#6c8ebf", Bills: "#8a6bbd", Health: "#3fa172",
  Fun: "#d9718a", Shopping: "#c4544c", Education: "#7d9b3c", Other: "#8b9896"
};
var NEEDS = ["Rent", "Bills", "Food", "Transport", "Health"];
var WANTS = ["Fun", "Shopping"];

/* ---------- tiny helpers ---------- */
function $(id) { return document.getElementById(id); }
function pad(n) { return n < 10 ? "0" + n : "" + n; }
function todayStr() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function setStatus(id, msg) { $(id).textContent = msg || ""; }
function errText(e) { return (e && e.message) ? e.message : "Something went wrong."; }
function el(tag, attrs, kids) {
  var e = document.createElement(tag);
  if (attrs) for (var k in attrs) {
    if (k === "text") e.textContent = attrs[k];
    else if (k === "class") e.className = attrs[k];
    else e.setAttribute(k, attrs[k]);
  }
  (kids || []).forEach(function (c) { e.appendChild(c); });
  return e;
}
function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
// tiny safe markdown: escape first, then allow bullets and bold only
function md(t) {
  function inl(s) { return s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"); }
  var html = "", inList = false;
  esc(t).split("\n").forEach(function (l) {
    var m = l.match(/^\s*[-*•]\s+(.*)/);
    if (m) { if (!inList) { html += "<ul>"; inList = true; } html += "<li>" + inl(m[1]) + "</li>"; }
    else {
      if (inList) { html += "</ul>"; inList = false; }
      if (l.trim()) html += "<p>" + inl(l.replace(/^#+\s*/, "")) + "</p>";
    }
  });
  if (inList) html += "</ul>";
  return html;
}

/* ---------- views ---------- */
function view(name) {
  $("auth").hidden = name !== "auth";
  $("recovery").hidden = name !== "recovery";
  $("app").hidden = name !== "app";
}

/* ---------- setup check ---------- */
if (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.indexOf("YOUR-") >= 0 || !CFG.SUPABASE_ANON_KEY || CFG.SUPABASE_ANON_KEY.indexOf("YOUR-") >= 0) {
  view("auth");
  setStatus("authStatus", "Setup needed: open js/config.js and paste your Supabase URL and anon key.");
  return;
}

var recovering = /type=recovery/.test(location.hash);
var sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
var HOME = location.origin + location.pathname;

/* ---------- state ---------- */
var user = null, currentUid; // currentUid starts undefined so the first signed-out event still shows the sign-in screen
var tabs = [], activeId = null, entries = [];
var month = todayStr().slice(0, 7);
var type = "expense";
var editingId = null;
var channel = null;
var loadSeq = 0;

function active() { for (var i = 0; i < tabs.length; i++) if (tabs[i].id === activeId) return tabs[i]; return tabs[0] || null; }
function canEdit() { var t = active(); return !!t && (t.role === "owner" || t.role === "editor"); }

/* ---------- date and money helpers ---------- */
function money(n) {
  var t = active(), c = ((t && t.currency) || "USD").toUpperCase();
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(n); }
  catch (e) { return (Math.round(n * 100) / 100).toFixed(2) + " " + c; }
}
function monthName(m, short) {
  var p = m.split("-"), d = new Date(+p[0], +p[1] - 1, 1);
  try { return d.toLocaleDateString(undefined, short ? { month: "short" } : { month: "long", year: "numeric" }); }
  catch (e) { return m; }
}
function shiftMonth(m, delta) { var p = m.split("-"), d = new Date(+p[0], +p[1] - 1 + delta, 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
function inMonth(m) { return entries.filter(function (e) { return e.date.slice(0, 7) === m; }); }
function totals(list) {
  var inc = 0, exp = 0, by = {};
  list.forEach(function (e) {
    var a = Number(e.amount);
    if (e.type === "income") inc += a; else { exp += a; by[e.category] = (by[e.category] || 0) + a; }
  });
  return { inc: inc, exp: exp, by: by };
}

/* =====================================================
   AUTH
   ===================================================== */
$("signin").addEventListener("click", function () {
  setStatus("authStatus", "Signing in…");
  sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("pw").value }).then(function (r) {
    setStatus("authStatus", r.error ? r.error.message : "");
  });
});
$("signup").addEventListener("click", function () {
  var pw = $("pw").value;
  if (pw.length < 8) { setStatus("authStatus", "Use a password with at least 8 characters."); return; }
  setStatus("authStatus", "Creating account…");
  sb.auth.signUp({ email: $("email").value.trim(), password: pw, options: { emailRedirectTo: HOME } }).then(function (r) {
    if (r.error) setStatus("authStatus", r.error.message);
    else if (!r.data.session) setStatus("authStatus", "Account created. Check your email and click the confirmation link, then sign in.");
    else setStatus("authStatus", "");
  });
});
$("forgot").addEventListener("click", function () {
  var email = $("email").value.trim();
  if (!email) { setStatus("authStatus", "Type your email above first, then click this again."); return; }
  sb.auth.resetPasswordForEmail(email, { redirectTo: HOME }).then(function (r) {
    setStatus("authStatus", r.error ? r.error.message : "If that email has an account, a reset link is on its way.");
  });
});
$("pw").addEventListener("keydown", function (e) { if (e.key === "Enter") $("signin").click(); });
$("signout").addEventListener("click", function () { sb.auth.signOut(); });

$("savepw").addEventListener("click", function () {
  var pw = $("newpw").value;
  if (pw.length < 8) { setStatus("recStatus", "Use at least 8 characters."); return; }
  sb.auth.updateUser({ password: pw }).then(function (r) {
    if (r.error) { setStatus("recStatus", r.error.message); return; }
    recovering = false;
    try { history.replaceState(null, "", HOME); } catch (e) {}
    $("newpw").value = "";
    if (user) startApp();
  });
});

sb.auth.onAuthStateChange(function (ev, session) {
  if (ev === "PASSWORD_RECOVERY") recovering = true;
  var uid = session && session.user ? session.user.id : null;
  user = session ? session.user : null;
  if (recovering && uid) { view("recovery"); currentUid = uid; return; }
  if (uid === currentUid) return;
  currentUid = uid;
  // run outside the callback to avoid auth deadlocks
  setTimeout(function () { if (uid) startApp(); else stopApp(); }, 0);
});

function stopApp() {
  if (channel) { sb.removeChannel(channel); channel = null; }
  tabs = []; entries = []; activeId = null; clearAI(); view("auth");
}

/* =====================================================
   LOADING DATA
   ===================================================== */
async function startApp() {
  view("app"); $("who").textContent = user.email || "";
  await loadTabs();
  if (!tabs.length) {
    var r = await sb.from("tabs").insert({ name: "Me" });
    if (r.error) { setStatus("entStatus", errText(r.error)); return; }
    await loadTabs();
  }
  renderAll(); await loadEntries(); subscribe();
}

async function loadTabs() {
  var t = await sb.from("tabs").select("*").order("created_at");
  if (t.error) { setStatus("entStatus", errText(t.error)); return; }
  var m = await sb.from("tab_members").select("tab_id,role").eq("user_id", user.id);
  var roles = {}; (m.data || []).forEach(function (x) { roles[x.tab_id] = x.role; });
  tabs = (t.data || []).map(function (x) { x.role = x.owner_id === user.id ? "owner" : (roles[x.id] || "viewer"); return x; });
  if (!activeId || !tabs.some(function (x) { return x.id === activeId; })) activeId = tabs[0] ? tabs[0].id : null;
}

async function loadEntries() {
  var t = active();
  if (!t) { entries = []; renderSummary(); renderTrend(); renderEntries(); return; }
  var seq = ++loadSeq;
  var from = shiftMonth(month, -5) + "-01", to = shiftMonth(month, 1) + "-01";
  var r = await sb.from("entries").select("*").eq("tab_id", t.id)
    .gte("date", from).lt("date", to)
    .order("date", { ascending: false }).order("created_at", { ascending: false }).limit(3000);
  if (seq !== loadSeq) return; // a newer request replaced this one
  if (r.error) { setStatus("entStatus", errText(r.error)); return; }
  setStatus("entStatus", ""); entries = r.data || [];
  renderSummary(); renderTrend(); renderEntries();
}

function subscribe() {
  if (channel) { sb.removeChannel(channel); channel = null; }
  var t = active(); if (!t) return;
  channel = sb.channel("entries-" + t.id)
    .on("postgres_changes", { event: "*", schema: "public", table: "entries", filter: "tab_id=eq." + t.id }, function () { loadEntries(); })
    .subscribe();
}

async function switchTab(id) {
  activeId = id; resetForm(); clearAI(); renderAll(); await loadEntries(); subscribe();
}

/* =====================================================
   RENDER
   ===================================================== */
function renderTabs() {
  var box = $("tabs"); box.innerHTML = "";
  tabs.forEach(function (p) {
    var b = el("button", { "class": "tab", role: "tab", "aria-selected": p.id === activeId ? "true" : "false", text: p.name });
    if (p.role !== "owner") b.appendChild(el("small", { text: p.role === "editor" ? "shared" : "view only" }));
    b.addEventListener("click", function () { switchTab(p.id); });
    box.appendChild(b);
  });
  var add = el("button", { "class": "tab add", text: "+ Add person" });
  add.addEventListener("click", function () {
    add.remove();
    var wrap = el("div", { "class": "addtab" });
    var inp = el("input", { placeholder: "Name", "aria-label": "New tab name", maxlength: "40" });
    var ok = el("button", { "class": "btn", type: "button", text: "Add" });
    async function go() {
      var n = inp.value.trim(); if (!n) return;
      var r = await sb.from("tabs").insert({ name: n }).select().single();
      if (r.error) { setStatus("entStatus", errText(r.error)); return; }
      await loadTabs(); await switchTab(r.data.id);
    }
    ok.addEventListener("click", go);
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } });
    wrap.appendChild(inp); wrap.appendChild(ok); box.appendChild(wrap); inp.focus();
  });
  box.appendChild(add);
}

function renderSummary() {
  $("monthLabel").textContent = monthName(month);
  var t = totals(inMonth(month)), left = t.inc - t.exp;
  var f = $("figures"); f.innerHTML = "";
  [["Earned", money(t.inc), "pos", ""], ["Spent", money(t.exp), "", ""], ["Left", money(left), left >= 0 ? "pos" : "neg", "left"]].forEach(function (x) {
    var d = el("div", { "class": "fig " + x[3] });
    d.appendChild(el("span", { text: x[0] })); d.appendChild(el("strong", { "class": x[2], text: x[1] })); f.appendChild(d);
  });
  var bar = $("bar"); bar.innerHTML = "";
  var denom = Math.max(t.inc, t.exp);
  var names = Object.keys(t.by).sort(function (a, b) { return t.by[b] - t.by[a]; });
  if (denom > 0) names.forEach(function (c) {
    var i = document.createElement("i");
    i.style.width = (t.by[c] / denom * 100) + "%"; i.style.background = COLORS[c] || "#8b9896"; i.title = c + ": " + money(t.by[c]);
    bar.appendChild(i);
  });
  var L = $("barL"), R = $("barR");
  if (denom === 0) { L.textContent = "Nothing recorded for this month yet."; R.textContent = ""; }
  else if (t.inc === 0) { L.textContent = "No income recorded this month."; R.textContent = ""; }
  else if (left >= 0) { L.textContent = "Colored: spent. Striped: still yours."; R.textContent = Math.round(left / t.inc * 100) + "% of income kept"; }
  else { L.textContent = "Spending is above income."; R.textContent = "Over by " + money(-left); }
  var ul = $("cats"); ul.innerHTML = "";
  names.forEach(function (c) {
    var li = el("li"), d = el("span", { "class": "dot" }); d.style.background = COLORS[c] || "#8b9896";
    li.appendChild(d); li.appendChild(el("span", { text: c })); li.appendChild(el("span", { text: money(t.by[c]) }));
    li.appendChild(el("span", { "class": "pct", text: Math.round(t.by[c] / t.exp * 100) + "%" })); ul.appendChild(li);
  });
}

function renderTrend() {
  var NS = "http://www.w3.org/2000/svg", box = $("trend"); box.innerHTML = "";
  var months = [], i;
  for (i = 5; i >= 0; i--) months.push(shiftMonth(month, -i));
  var data = months.map(function (m) { return { m: m, t: totals(inMonth(m)) }; });
  var max = 0; data.forEach(function (d) { max = Math.max(max, d.t.inc, d.t.exp); });
  if (max === 0) { box.appendChild(el("p", { "class": "hint", text: "Your history will appear here as you add entries." })); return; }
  var W = 360, H = 130, base = 104, top = 8, slot = W / 6;
  var svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Earned versus spent over the last 6 months");
  function rect(x, h, color, label) {
    var r = document.createElementNS(NS, "rect");
    r.setAttribute("x", x); r.setAttribute("width", 20); r.setAttribute("rx", 3);
    r.setAttribute("y", base - h); r.setAttribute("height", Math.max(h, 1));
    r.setAttribute("style", "fill:" + color);
    var t = document.createElementNS(NS, "title"); t.textContent = label; r.appendChild(t);
    return r;
  }
  data.forEach(function (d, idx) {
    var x = idx * slot + (slot - 44) / 2;
    var hi = d.t.inc / max * (base - top), he = d.t.exp / max * (base - top);
    var name = monthName(d.m, true);
    svg.appendChild(rect(x, hi, "var(--gain)", name + " earned: " + money(d.t.inc)));
    svg.appendChild(rect(x + 24, he, "var(--spend)", name + " spent: " + money(d.t.exp)));
    var tx = document.createElementNS(NS, "text");
    tx.setAttribute("x", x + 22); tx.setAttribute("y", base + 18); tx.setAttribute("text-anchor", "middle");
    tx.textContent = name; svg.appendChild(tx);
  });
  var line = document.createElementNS(NS, "line");
  line.setAttribute("x1", 0); line.setAttribute("x2", W); line.setAttribute("y1", base); line.setAttribute("y2", base);
  line.setAttribute("style", "stroke:var(--line)"); svg.insertBefore(line, svg.firstChild);
  box.appendChild(svg);
}

function renderEntries() {
  var list = inMonth(month), ul = $("entries"); ul.innerHTML = "";
  if (!list.length) {
    ul.appendChild(el("li", { "class": "empty", text: canEdit() ? "No entries this month. Add one, or type a sentence and let the AI sort it." : "No entries this month." }));
    return;
  }
  list.forEach(function (e) {
    var li = el("li"), d = el("span", { "class": "dot" });
    d.style.background = e.type === "income" ? "var(--gain)" : (COLORS[e.category] || "#8b9896");
    var what = el("div", { "class": "what" });
    what.appendChild(el("b", { text: e.note || e.category }));
    what.appendChild(el("small", { text: e.category + " · " + e.date }));
    var amt = el("span", { "class": e.type === "income" ? "pos" : "", text: (e.type === "income" ? "+" : "−") + money(Number(e.amount)) });
    li.appendChild(d); li.appendChild(what); li.appendChild(amt);
    if (canEdit()) {
      var ed = el("button", { "class": "x", "aria-label": "Edit entry", title: "Edit", text: "✎" });
      ed.addEventListener("click", function () { startEdit(e); });
      var x = el("button", { "class": "x del", "aria-label": "Delete entry", title: "Delete", text: "×" });
      x.addEventListener("click", async function () {
        var r = await sb.from("entries").delete().eq("id", e.id);
        if (r.error) setStatus("entStatus", errText(r.error)); else { if (editingId === e.id) resetForm(); loadEntries(); }
      });
      li.appendChild(ed); li.appendChild(x);
    } else { li.appendChild(el("span")); li.appendChild(el("span")); }
    ul.appendChild(li);
  });
}

function fillCats() {
  var s = $("cat"); s.innerHTML = "";
  CATS[type].forEach(function (c) { s.appendChild(el("option", { value: c, text: c })); });
  $("tExp").setAttribute("aria-pressed", type === "expense" ? "true" : "false");
  $("tInc").setAttribute("aria-pressed", type === "income" ? "true" : "false");
}

function renderSettings() {
  var t = active(); if (!t) return;
  var owner = t.role === "owner";
  $("pname").value = t.name; $("goal").value = t.goal || ""; $("cur").value = t.currency || "USD";
  $("ownerSettings").hidden = !owner; $("shareBox").hidden = !owner;
  $("roleNote").textContent = owner ? "" : (t.role === "editor" ? "This tab belongs to someone else. You can add and edit entries." : "This tab belongs to someone else. You can only view it.");
  $("del").textContent = owner ? "Delete this tab" : "Leave this tab"; $("del").dataset.armed = "";
  $("addCard").hidden = !canEdit();
  if (owner) loadMembers();
}
function renderAll() { renderTabs(); renderSummary(); renderTrend(); renderEntries(); renderSettings(); }

/* =====================================================
   ENTRIES: add, edit
   ===================================================== */
function resetForm() {
  editingId = null; type = "expense"; fillCats();
  $("amt").value = ""; $("note").value = ""; $("date").value = todayStr();
  $("submitBtn").textContent = "Save entry"; $("cancelEdit").hidden = true; $("addTitle").textContent = "Add money in or out";
}
function startEdit(e) {
  editingId = e.id; type = e.type; fillCats();
  $("amt").value = e.amount; $("cat").value = e.category; $("note").value = e.note || ""; $("date").value = e.date;
  $("submitBtn").textContent = "Update entry"; $("cancelEdit").hidden = false; $("addTitle").textContent = "Edit entry";
  $("addCard").scrollIntoView({ behavior: "smooth", block: "nearest" }); $("amt").focus();
}
$("cancelEdit").addEventListener("click", resetForm);
$("tExp").addEventListener("click", function () { type = "expense"; fillCats(); });
$("tInc").addEventListener("click", function () { type = "income"; fillCats(); });

$("addForm").addEventListener("submit", async function (ev) {
  ev.preventDefault();
  var t = active(), a = parseFloat($("amt").value);
  if (!t || !(a > 0)) return;
  var d = $("date").value || todayStr();
  var row = { type: type, amount: Math.round(a * 100) / 100, category: $("cat").value, note: $("note").value.trim(), date: d };
  var r = editingId
    ? await sb.from("entries").update(row).eq("id", editingId)
    : await sb.from("entries").insert(Object.assign({ tab_id: t.id }, row));
  if (r.error) { setStatus("entStatus", errText(r.error)); return; }
  var wasEditing = !!editingId;
  if (d.slice(0, 7) !== month) month = d.slice(0, 7);
  resetForm(); if (!wasEditing) $("amt").focus();
  loadEntries();
});

/* month navigation */
$("prev").addEventListener("click", function () { month = shiftMonth(month, -1); clearAI(); loadEntries(); });
$("next").addEventListener("click", function () { month = shiftMonth(month, 1); clearAI(); loadEntries(); });

/* =====================================================
   TAB SETTINGS, CSV, SHARING
   ===================================================== */
$("pname").addEventListener("change", async function () {
  var v = $("pname").value.trim(); if (!v) return;
  var r = await sb.from("tabs").update({ name: v }).eq("id", active().id);
  if (r.error) setStatus("setStatus", errText(r.error)); else { await loadTabs(); renderTabs(); }
});
$("goal").addEventListener("change", async function () {
  var r = await sb.from("tabs").update({ goal: Math.max(0, parseFloat($("goal").value) || 0) }).eq("id", active().id);
  if (r.error) setStatus("setStatus", errText(r.error)); else await loadTabs();
});
$("cur").addEventListener("change", async function () {
  var v = $("cur").value.trim().toUpperCase() || "USD";
  try { new Intl.NumberFormat(undefined, { style: "currency", currency: v }); }
  catch (e) { setStatus("setStatus", "Unknown currency code."); $("cur").value = active().currency; return; }
  var r = await sb.from("tabs").update({ currency: v }).eq("id", active().id);
  if (r.error) setStatus("setStatus", errText(r.error)); else { await loadTabs(); renderSummary(); renderTrend(); renderEntries(); }
});

$("del").addEventListener("click", async function () {
  var b = $("del"), t = active();
  if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Tap again to confirm"; return; }
  var r = t.role === "owner"
    ? await sb.from("tabs").delete().eq("id", t.id)
    : await sb.from("tab_members").delete().eq("tab_id", t.id).eq("user_id", user.id);
  if (r.error) { setStatus("setStatus", errText(r.error)); return; }
  activeId = null; await loadTabs();
  if (!tabs.length) { await sb.from("tabs").insert({ name: "Me" }); await loadTabs(); }
  await switchTab(active().id);
});

$("csv").addEventListener("click", async function () {
  var t = active();
  var r = await sb.from("entries").select("date,type,category,amount,note").eq("tab_id", t.id).order("date").limit(10000);
  if (r.error) { setStatus("setStatus", errText(r.error)); return; }
  function q(v) { v = String(v == null ? "" : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; }
  var lines = ["date,type,category,amount,note"].concat((r.data || []).map(function (x) {
    return [x.date, x.type, x.category, x.amount, x.note].map(q).join(",");
  }));
  var a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  a.download = t.name.replace(/[^\w-]+/g, "_") + ".csv"; a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
});

async function loadMembers() {
  var ul = $("members"); ul.innerHTML = "";
  var t = active(); if (!t) return;
  var r = await sb.rpc("tab_members_list", { p_tab: t.id });
  if (r.error) return;
  (r.data || []).forEach(function (m) {
    var li = el("li"); li.appendChild(el("span", { text: m.email + " · " + (m.role === "editor" ? "can edit" : "view only") }));
    var rm = el("button", { "class": "ghost", text: "Remove" });
    rm.addEventListener("click", async function () {
      var d = await sb.from("tab_members").delete().eq("tab_id", t.id).eq("user_id", m.user_id);
      if (d.error) setStatus("setStatus", errText(d.error)); else loadMembers();
    });
    li.appendChild(rm); ul.appendChild(li);
  });
}
$("share").addEventListener("click", async function () {
  var email = $("shEmail").value.trim(); if (!email) return;
  var r = await sb.rpc("share_tab", { p_tab: active().id, p_email: email, p_role: $("shRole").value });
  if (r.error) { setStatus("setStatus", r.error.message); return; }
  setStatus("setStatus", "Shared with " + email + "."); $("shEmail").value = ""; loadMembers();
});

/* =====================================================
   AI (through your own Supabase Edge Function, using Gemini)
   ===================================================== */
function clearAI() { $("aiOut").hidden = true; $("aiOut").innerHTML = ""; setStatus("aiStatus", ""); }

async function callAI(body) {
  var r = await sb.functions.invoke("ai", { body: body });
  if (r.error) {
    var msg = r.error.message;
    try { var j = await r.error.context.json(); if (j && j.error) msg = j.error; } catch (e) {}
    throw new Error(msg);
  }
  return r.data;
}

// works with no AI at all, used as a fallback
function localInsights() {
  var t = totals(inMonth(month)), p = active(), out = [];
  if (!t.inc && !t.exp) return "Add a few entries and I will summarize them here.";
  if (t.inc > 0) out.push("- You kept **" + Math.round((t.inc - t.exp) / t.inc * 100) + "%** of what you earned this month.");
  var names = Object.keys(t.by).sort(function (a, b) { return t.by[b] - t.by[a]; });
  if (names.length) out.push("- Your biggest category is **" + names[0] + "** at " + money(t.by[names[0]]) + " (" + Math.round(t.by[names[0]] / t.exp * 100) + "% of spending).");
  var pr = totals(inMonth(shiftMonth(month, -1)));
  if (pr.exp > 0) out.push("- Compared with last month, spending is " + (t.exp >= pr.exp ? "up " : "down ") + money(Math.abs(t.exp - pr.exp)) + ".");
  if (t.inc > 0) {
    var n = 0, w = 0; NEEDS.forEach(function (c) { n += t.by[c] || 0; }); WANTS.forEach(function (c) { w += t.by[c] || 0; });
    out.push("- Needs are " + Math.round(n / t.inc * 100) + "% of income (target 50%), wants " + Math.round(w / t.inc * 100) + "% (target 30%).");
  }
  if (Number(p.goal) > 0) out.push("- Savings goal " + money(Number(p.goal)) + ": " + ((t.inc - t.exp) >= p.goal ? "on track." : "short by " + money(p.goal - (t.inc - t.exp)) + "."));
  return out.join("\n");
}

async function runAI(task, btn, extra) {
  var t = active(); if (!t) return;
  var out = $("aiOut"); out.hidden = true; out.innerHTML = "";
  setStatus("aiStatus", "Thinking…"); btn.disabled = true;
  try {
    var body = { task: task, tab_id: t.id, month: month };
    if (extra) for (var k in extra) body[k] = extra[k];
    var r = await callAI(body);
    out.innerHTML = md(r.text || ""); out.hidden = false; setStatus("aiStatus", "");
  } catch (e) {
    setStatus("aiStatus", errText(e) + " Showing the built-in summary instead.");
    out.innerHTML = md(localInsights()); out.hidden = false;
  } finally { btn.disabled = false; }
}
$("analyze").addEventListener("click", function () { runAI("analyze", this); });
$("plan").addEventListener("click", function () { runAI("plan", this); });
function ask() { var q = $("ask").value.trim(); if (q) runAI("ask", $("askgo"), { question: q }); }
$("askgo").addEventListener("click", ask);
$("ask").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); ask(); } });

$("nlgo").addEventListener("click", async function () {
  var txt = $("nl").value.trim(), t = active(), btn = this;
  if (!txt) { setStatus("nlStatus", "Type what you earned or spent first."); return; }
  btn.disabled = true; setStatus("nlStatus", "Reading your message…");
  try {
    var r = await callAI({ task: "parse", text: txt, today: todayStr() });
    var rows = (r.entries || []).map(function (e) {
      return { tab_id: t.id, type: e.type, amount: e.amount, category: e.category, note: e.note, date: e.date };
    });
    if (!rows.length) { setStatus("nlStatus", "I could not find an amount in that. Try: “spent 20 on lunch”."); return; }
    var ins = await sb.from("entries").insert(rows);
    if (ins.error) throw ins.error;
    $("nl").value = "";
    setStatus("nlStatus", "Added " + rows.length + (rows.length === 1 ? " entry" : " entries") + ". Check the list and fix or delete any that look wrong.");
    loadEntries();
  } catch (e) { setStatus("nlStatus", errText(e)); }
  finally { btn.disabled = false; }
});

/* ---------- boot ---------- */
fillCats(); $("date").value = todayStr();
})();
