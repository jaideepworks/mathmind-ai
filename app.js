

const CONFIG = {
    SUPABASE_URL:      "https://gmokwlqudjqrvsacxvlm.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdtb2t3bHF1ZGpxcnZzYWN4dmxtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0ODU4NzQsImV4cCI6MjA4OTA2MTg3NH0.vHfu76sEhjLjI9V194dfGdOnDaC0NypFNLkXjUBfUJQ",
  RAZORPAY_KEY:      "YOUR_RAZORPAY_KEY_HERE",

  FREE_DAILY_LIMIT:  5,
  PLANS: {
    monthly: { amount: 19900, label: "₹199/month" },
    yearly:  { amount: 99900, label: "₹999/year"  }
  }
};

const supabase = window.supabase.createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY
);

let currentUser    = null;
let currentProfile = null;
let chatHistory    = [];
let selectedPlan   = "yearly";

/* ── INIT ── */
document.addEventListener("DOMContentLoaded", async () => {
  setupTextarea();
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) { currentUser = session.user; await loadProfile(); showPage("appPage"); }
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_IN" && session?.user) { currentUser = session.user; await loadProfile(); showPage("appPage"); }
    else if (event === "SIGNED_OUT") { currentUser = null; currentProfile = null; showPage("landingPage"); }
  });
});

/* ── AUTH ── */
async function handleSignup() {
  const name  = document.getElementById("signupName").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const pass  = document.getElementById("signupPassword").value;
  const errEl = document.getElementById("signupError");
  if (!name)                { showError(errEl, "Please enter your name."); return; }
  if (!email.includes("@")) { showError(errEl, "Please enter a valid email."); return; }
  if (pass.length < 6)      { showError(errEl, "Password must be at least 6 characters."); return; }
  setBtnLoading("signupBtn", true);
  const { data, error } = await supabase.auth.signUp({ email, password: pass });
  if (error) { showError(errEl, error.message); setBtnLoading("signupBtn", false); return; }
  if (data.user) await supabase.from("users").insert({ id: data.user.id, email, name, plan: "free" });
  setBtnLoading("signupBtn", false);
  showToast("Account created! Welcome 🎉");
}

async function handleLogin() {
  const email = document.getElementById("loginEmail").value.trim();
  const pass  = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");
  if (!email || !pass) { showError(errEl, "Please enter email and password."); return; }
  setBtnLoading("loginBtn", true);
  const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
  if (error) { showError(errEl, "Wrong email or password."); setBtnLoading("loginBtn", false); return; }
  setBtnLoading("loginBtn", false);
}

async function handleGoogleLogin() {
  const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  if (error) showToast("Google login failed: " + error.message);
}

async function handleLogout() {
  await supabase.auth.signOut();
  chatHistory = [];
  document.getElementById("messages").innerHTML = "";
  document.getElementById("chatWelcome").style.display = "block";
  document.getElementById("historyList").innerHTML = '<div class="history-empty">No history yet</div>';
}

/* ── PROFILE ── */
async function loadProfile() {
  if (!currentUser) return;
  const { data, error } = await supabase.from("users").select("*").eq("id", currentUser.id).single();
  if (error || !data) {
    const name = currentUser.user_metadata?.full_name || currentUser.email?.split("@")[0] || "Student";
    await supabase.from("users").upsert({ id: currentUser.id, email: currentUser.email, name, plan: "free" });
    currentProfile = { name, plan: "free", daily_count: 0, last_reset: todayStr() };
  } else {
    currentProfile = data;
    if (data.last_reset !== todayStr()) {
      await supabase.from("users").update({ daily_count: 0, last_reset: todayStr() }).eq("id", currentUser.id);
      currentProfile.daily_count = 0;
    }
  }
  updateUI();
  loadChatHistory();
}

/* ── DAILY LIMIT ── */
function getRemainingQuestions() {
  if (!currentProfile) return CONFIG.FREE_DAILY_LIMIT;
  if (currentProfile.plan === "pro") return Infinity;
  return Math.max(0, CONFIG.FREE_DAILY_LIMIT - (currentProfile.daily_count || 0));
}

async function incrementDailyCount() {
  if (!currentUser || currentProfile?.plan === "pro") return;
  currentProfile.daily_count = (currentProfile.daily_count || 0) + 1;
  await supabase.from("users").update({ daily_count: currentProfile.daily_count }).eq("id", currentUser.id);
  updateUI();
}

async function decrementDailyCount() {
  if (!currentUser || currentProfile?.plan === "pro") return;
  currentProfile.daily_count = Math.max(0, (currentProfile.daily_count || 1) - 1);
  await supabase.from("users").update({ daily_count: currentProfile.daily_count }).eq("id", currentUser.id);
  updateUI();
}

/* ── CHAT HISTORY ── */
async function loadChatHistory() {
  if (!currentUser) return;
  const { data } = await supabase.from("chats").select("id, title, created_at").eq("user_id", currentUser.id).order("created_at", { ascending: false }).limit(20);
  renderHistoryList(data || []);
}

function renderHistoryList(chats) {
  const list = document.getElementById("historyList");
  if (!chats.length) { list.innerHTML = '<div class="history-empty">No history yet</div>'; return; }
  list.innerHTML = chats.map(c => `<div class="history-item" onclick="loadChat('${c.id}')">${escHtml((c.title || "Math Chat").slice(0, 38))}</div>`).join("");
}

async function loadChat(chatId) {
  const { data } = await supabase.from("chats").select("messages").eq("id", chatId).single();
  if (!data?.messages) return;
  chatHistory = data.messages;
  document.getElementById("chatWelcome").style.display = "none";
  document.getElementById("messages").innerHTML = "";
  chatHistory.forEach(m => {
    if (m.role === "user") appendUserMessage(m.content, false);
    else if (m.role === "assistant") appendAIMessage(m.parsed, false);
  });
  if (window.innerWidth < 768) closeSidebar();
  scrollToBottom();
}

async function saveCurrentChat() {
  if (!currentUser || chatHistory.length < 2) return;
  const title = chatHistory.find(m => m.role === "user")?.content?.slice(0, 50) || "Chat";
  await supabase.from("chats").insert({ user_id: currentUser.id, title, messages: chatHistory });
  loadChatHistory();
}

function newChat() {
  if (chatHistory.length >= 2) saveCurrentChat();
  chatHistory = [];
  document.getElementById("messages").innerHTML = "";
  document.getElementById("chatWelcome").style.display = "block";
  if (window.innerWidth < 768) closeSidebar();
}

/* ── SEND QUESTION ── */
async function sendQuestion() {
  const input    = document.getElementById("questionInput");
  const question = input.value.trim();
  if (!question) return;
  if (currentProfile?.plan !== "pro" && getRemainingQuestions() <= 0) { showPaywallMessage(); return; }
  input.value = "";
  input.style.height = "auto";
  document.getElementById("sendButton").disabled = true;
  document.getElementById("chatWelcome").style.display = "none";
  appendUserMessage(question);
  chatHistory.push({ role: "user", content: question });
  const loaderId = addLoader();
  await incrementDailyCount();
  try {
    const result = await callMathAI(question);
    removeLoader(loaderId);
    if (result.refused) { appendRefusedMessage(result.msg); await decrementDailyCount(); }
    else { appendAIMessage(result); chatHistory.push({ role: "assistant", parsed: result }); }
  } catch (err) {
    removeLoader(loaderId);
    await decrementDailyCount();
    appendErrorMessage(err.message);
  }
  document.getElementById("sendButton").disabled = false;
  scrollToBottom();
}

/* ── AI API CALL (via Vercel serverless) ── */
async function callMathAI(question) {
  const messages = [];
  chatHistory.slice(-6).forEach(m => {
    if (m.role === "user") messages.push({ role: "user", parts: [{ text: m.content }] });
    else if (m.role === "assistant" && m.parsed) messages.push({ role: "model", parts: [{ text: JSON.stringify(m.parsed) }] });
  });
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Server error: " + response.status);
  }
  return await response.json();
}

/* ── RENDER MESSAGES ── */
function appendUserMessage(text, scroll = true) {
  const msgs = document.getElementById("messages");
  const div  = document.createElement("div");
  div.className = "msg-row-user";
  div.innerHTML = `<div class="bubble-user">${escHtml(text)}</div>`;
  msgs.appendChild(div);
  if (scroll) scrollToBottom();
}

function appendAIMessage(data, scroll = true) {
  const msgs = document.getElementById("messages");
  const div  = document.createElement("div");
  div.className = "msg-row-ai";
  const stepsHtml = (data.steps || []).map(s => `<div class="step-card"><div class="step-title">${escHtml(s.label)}</div><div class="step-work">${escHtml(s.work)}</div></div>`).join("");
  const tipHtml   = data.tip ? `<div class="tip-box">💡 ${escHtml(data.tip)}</div>` : "";
  div.innerHTML   = `<div class="ai-icon">∑x</div><div class="bubble-ai">${stepsHtml}<div class="answer-box">✓ Answer: ${escHtml(data.answer)}</div>${tipHtml}</div>`;
  msgs.appendChild(div);
  if (scroll) scrollToBottom();
}

function appendRefusedMessage(msg) {
  const msgs = document.getElementById("messages");
  const div  = document.createElement("div");
  div.className = "msg-row-ai";
  div.innerHTML = `<div class="ai-icon">∑x</div><div class="refused-bubble">${escHtml(msg)}</div>`;
  msgs.appendChild(div);
  scrollToBottom();
}

function appendErrorMessage(msg) {
  const msgs = document.getElementById("messages");
  const div  = document.createElement("div");
  div.className = "msg-row-ai";
  div.innerHTML = `<div class="ai-icon">∑x</div><div class="refused-bubble">⚠️ ${escHtml(msg)}</div>`;
  msgs.appendChild(div);
  scrollToBottom();
}

function addLoader() {
  const id  = "loader_" + Date.now();
  const msgs = document.getElementById("messages");
  const div  = document.createElement("div");
  div.id = id; div.className = "msg-row-ai";
  div.innerHTML = `<div class="ai-icon">∑x</div><div class="bubble-ai"><div class="loading-msg"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>`;
  msgs.appendChild(div);
  scrollToBottom();
  return id;
}

function removeLoader(id) { document.getElementById(id)?.remove(); }

function showPaywallMessage() {
  if (document.getElementById("paywallCard")) return;
  const msgs = document.getElementById("messages");
  const div  = document.createElement("div");
  div.id = "paywallCard"; div.className = "paywall-card";
  div.innerHTML = `<p>🔒 Your <strong>${CONFIG.FREE_DAILY_LIMIT} free questions</strong> for today are used up.</p><button onclick="showUpgradeModal()">⚡ Get Pro — ₹199/mo</button>`;
  msgs.appendChild(div);
  scrollToBottom();
}

/* ── PAYMENT ── */
function handlePayment() {
  const plan = CONFIG.PLANS[selectedPlan];
  if (typeof Razorpay !== "undefined" && !CONFIG.RAZORPAY_KEY.includes("YOUR_")) {
    const rzp = new Razorpay({
      key: CONFIG.RAZORPAY_KEY, amount: plan.amount, currency: "INR",
      name: "MathMind AI", description: "Pro — " + plan.label,
      prefill: { name: currentProfile?.name || "", email: currentUser?.email || "" },
      theme: { color: "#1a1a2e" },
      handler: (res) => activatePro(res.razorpay_payment_id)
    });
    rzp.open();
  } else {
    showToast("Demo: Activating Pro...");
    setTimeout(() => activatePro("demo_" + Date.now()), 1000);
  }
}

async function activatePro(paymentId) {
  if (!currentUser) return;
  await supabase.from("users").update({ plan: "pro", payment_id: paymentId }).eq("id", currentUser.id);
  if (currentProfile) currentProfile.plan = "pro";
  closeUpgradeModal();
  updateUI();
  showToast("🎉 Pro activated! Unlimited math solving!");
  document.getElementById("paywallCard")?.remove();
}

/* ── UI HELPERS ── */
function updateUI() {
  if (!currentProfile) return;
  const name = currentProfile.name || "Student";
  const rem  = getRemainingQuestions();
  document.getElementById("userAvatar").textContent  = name.charAt(0).toUpperCase();
  document.getElementById("userName").textContent    = name;
  document.getElementById("welcomeName").textContent = name.split(" ")[0];
  document.getElementById("userPlan").textContent    = currentProfile.plan === "pro" ? "Pro Plan · Unlimited ✓" : `Free Plan · ${rem} left today`;
  const limitText = document.getElementById("dailyLimitText");
  if (limitText) limitText.innerHTML = currentProfile.plan === "pro" ? "Pro Plan: Unlimited ✓" : `Free: <strong>${rem}</strong> questions left today`;
}

function showPage(pageId) {
  document.querySelectorAll(".page").forEach(p => { p.classList.remove("active"); p.style.display = ""; });
  const el = document.getElementById(pageId);
  el.classList.add("active");
  if (pageId === "appPage") el.style.display = "flex";
}

function toggleSidebar() {
  const sidebar = document.getElementById("appSidebar");
  const overlay = document.getElementById("sidebarOverlay");
  const isOpen  = sidebar.classList.contains("open");
  sidebar.classList.toggle("open", !isOpen);
  overlay.classList.toggle("show", !isOpen);
}

function closeSidebar() {
  document.getElementById("appSidebar").classList.remove("open");
  document.getElementById("sidebarOverlay").classList.remove("show");
}

function showUpgradeModal()  { document.getElementById("upgradeModal").classList.add("open"); }
function closeUpgradeModal() { document.getElementById("upgradeModal").classList.remove("open"); }

function selectPlan(plan) {
  selectedPlan = plan;
  document.querySelectorAll(".modal-plan").forEach(el => el.classList.remove("mp-selected"));
  document.getElementById("plan-" + plan).classList.add("mp-selected");
}

function fillQuestion(text) {
  const ta = document.getElementById("questionInput");
  ta.value = text;
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  ta.focus();
}

function showError(el, msg) { el.textContent = msg; el.style.display = "block"; setTimeout(() => el.style.display = "none", 5000); }
function showToast(msg) { const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 3500); }
function setBtnLoading(btnId, loading) { const btn = document.getElementById(btnId); if (!btn) return; btn.disabled = loading; btn.textContent = loading ? "Loading..." : (btnId === "loginBtn" ? "Login" : "Create Account"); }

function setupTextarea() {
  const ta = document.getElementById("questionInput");
  if (!ta) return;
  ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 140) + "px"; });
  ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendQuestion(); } });
}

function scrollToBottom() { const c = document.getElementById("chatContainer"); if (c) setTimeout(() => c.scrollTop = c.scrollHeight, 80); }
function todayStr() { return new Date().toISOString().split("T")[0]; }
function escHtml(s) { return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\n/g,"<br/>"); }
