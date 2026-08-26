// ============================================================
// BRAHMASTRA — dashboard logic
// IMPORTANT: this NEVER calls api.anthropic.com or any AI provider
// directly from the browser. All AI calls go through our own
// Vercel serverless function (/api/generate), which holds
// the real API key server-side. Calling an AI API straight from
// client-side JS can't work outside Claude's own artifact sandbox —
// there's no key to send, and the provider blocks browser-origin
// calls anyway.
// ============================================================

const sampleSyllabus = `Unit 1: Cell Biology
- Cell structure and organelles
- Cell membrane transport (diffusion, osmosis, active transport)
- Cell division: mitosis and meiosis
- Cell theory and its history

Unit 2: Genetics
- Mendelian inheritance and Punnett squares
- DNA structure and replication
- Transcription and translation
- Mutations and their effects

Unit 3: Human Physiology
- Circulatory system and heart function
- Respiratory system and gas exchange
- Nervous system basics: neurons and reflexes
- Endocrine system and hormones

Unit 4: Ecology
- Food chains and food webs
- Energy flow and biomass pyramids
- Population dynamics
- Human impact on ecosystems`;

let currentUser = null;
let currentSession = null;
let lastResult = null; // { topics: [{title, points: []}] }
let selectedDepth = "5";
let selectedLayout = "single";
let selectedFocus = "balanced";

const $ = id => document.getElementById(id);
const authBox = $("auth-box");
const creditBadge = $("credit-badge");
const logoutBtn = $("logout-btn");
const authStatus = $("auth-status");
const generateBtn = $("generate-btn");
const generateStatus = $("generate-status");
const preview = $("preview");
const syllabusEl = $("syllabus-text");
const charCountEl = $("char-count");
const exportPdfBtn = $("export-pdf");
const exportDocxBtn = $("export-docx");

// Bring across a draft entered on the public landing page. It stays editable
// and is never sent anywhere until the user clicks Generate.
const pendingSyllabus = localStorage.getItem("brahmastra_pending_syllabus");
if (pendingSyllabus) {
  syllabusEl.value = pendingSyllabus;
  charCountEl.textContent = pendingSyllabus.length + " characters";
  localStorage.removeItem("brahmastra_pending_syllabus");
}

// ---------- char count + sample loader ----------
syllabusEl.addEventListener("input", () => {
  charCountEl.textContent = syllabusEl.value.length + " characters";
});
$("load-sample").addEventListener("click", () => {
  syllabusEl.value = sampleSyllabus;
  charCountEl.textContent = syllabusEl.value.length + " characters";
});

// ---------- pill option selectors ----------
function wireOptions(containerId, setter, onChange) {
  const el = document.getElementById(containerId);
  el.querySelectorAll(".pill-option").forEach(pill => {
    pill.addEventListener("click", () => {
      el.querySelectorAll(".pill-option").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      setter(pill.dataset.value);
      if (onChange) onChange();
    });
  });
}
wireOptions("depth-options", v => selectedDepth = v);
wireOptions("layout-options", v => { selectedLayout = v; if (lastResult) renderPreview(lastResult); });
wireOptions("focus-options", v => selectedFocus = v);

// ---------- auth ----------
async function refreshSession() {
  const { data } = await supabaseClient.auth.getSession();
  currentSession = data.session;
  currentUser = data.session ? data.session.user : null;
  updateAuthUI();
  if (currentUser) await refreshCredits();
}

function updateAuthUI() {
  document.body.classList.toggle("is-logged-out", !currentUser);
  if (currentUser) {
    authBox.style.display = "none";
    logoutBtn.style.display = "inline-flex";
  } else {
    authBox.style.display = "block";
    logoutBtn.style.display = "none";
    creditBadge.textContent = "— credits";
  }
}

async function refreshCredits() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("credits")
    .eq("id", currentUser.id)
    .single();
  if (!error && data) {
    creditBadge.textContent = `${data.credits} credit${data.credits === 1 ? "" : "s"}`;
  }
}

$("signup-btn").addEventListener("click", async () => {
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  authStatus.textContent = "Creating account...";
  authStatus.className = "status-line";
  const { error } = await supabaseClient.auth.signUp({ email, password });
  if (error) {
    authStatus.textContent = error.message;
    authStatus.className = "status-line error";
    return;
  }
  authStatus.textContent = "Check your inbox to confirm your email, then sign in.";
  authStatus.className = "status-line ok";
});

$("signin-btn").addEventListener("click", async () => {
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  authStatus.textContent = "Signing in...";
  authStatus.className = "status-line";
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    authStatus.textContent = error.message;
    authStatus.className = "status-line error";
    return;
  }
  await refreshSession();
});

// Google authentication is configured in Supabase Auth. The redirect returns
// to this same page, where refreshSession() restores the signed-in UI.
$("google-login-btn").addEventListener("click", async () => {
  authStatus.textContent = "Opening Google sign-in...";
  authStatus.className = "status-line";
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/dashboard.html` }
  });
  if (error) {
    authStatus.textContent = error.message;
    authStatus.className = "status-line error";
  }
});

logoutBtn.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  await refreshSession();
});

refreshSession();

// ---------- generate (via backend proxy — never direct to AI provider) ----------
generateBtn.addEventListener("click", async () => {
  if (!currentUser) {
    generateStatus.innerHTML = "Sign in first.";
    generateStatus.className = "status-line error";
    return;
  }
  const syllabus = syllabusEl.value.trim();
  if (!syllabus) {
    generateStatus.innerHTML = "Please paste a syllabus first.";
    generateStatus.className = "status-line error";
    return;
  }

  generateBtn.disabled = true;
  generateStatus.innerHTML = `<span class="spinner"></span> Extracting topics...`;
  generateStatus.className = "status-line";
  preview.className = "cheatsheet-preview";
  preview.innerHTML = `<div class="empty-state">Charging the arrow...</div>`;

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${currentSession.access_token}`
      },
      body: JSON.stringify({
        syllabus,
        depth: selectedDepth,
        focus: selectedFocus
      })
    });
    // Netlify may return an HTML 404/500 page if a deployment is missing its
    // serverless function. Parse defensively so users see a useful action
    // instead of the browser's "Unexpected token <" JSON parsing error.
    const responseBody = await res.text();
    let data;
    try {
      data = JSON.parse(responseBody);
    } catch {
      if (res.status === 404) {
        throw new Error("Generator service is not deployed yet. Redeploy the Netlify site with its functions enabled.");
      }
      throw new Error(`Generator service returned an invalid response (${res.status}). Please try again shortly.`);
    }
    if (!res.ok) throw new Error(data.error || "Generation failed.");

    lastResult = data;
    renderPreview(data);
    await refreshCredits();
    generateStatus.textContent = "Done. Export below.";
    generateStatus.className = "status-line ok";
    exportPdfBtn.disabled = false;
    exportDocxBtn.disabled = false;
  } catch (err) {
    generateStatus.textContent = err.message;
    generateStatus.className = "status-line error";
    preview.innerHTML = `<div class="empty-state">Your cheat sheet will render here once generated.</div>`;
  } finally {
    generateBtn.disabled = false;
  }
});

function renderPreview(data) {
  const layoutClass = selectedLayout === "single" ? "" : "layout-" + selectedLayout;
  preview.className = "cheatsheet-preview " + layoutClass;
  let html = "";
  data.topics.forEach(t => {
    html += `<div class="topic-block"><h3>${escapeHtml(t.title)}</h3><ul>`;
    t.points.forEach(p => html += `<li>${escapeHtml(p)}</li>`);
    html += `</ul></div>`;
  });
  preview.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// ---------- export: PDF via print (matches real print-shop paper sizes) ----------
exportPdfBtn.addEventListener("click", () => {
  if (!lastResult) return;
  const pageSize = selectedLayout === "single" ? "A4 portrait"
    : selectedLayout === "grid42" ? "A4 landscape" : "A4 portrait";

  let styleTag = document.getElementById("print-page-size");
  if (!styleTag) {
    styleTag = document.createElement("style");
    styleTag.id = "print-page-size";
    document.head.appendChild(styleTag);
  }
  styleTag.innerHTML = `@media print{ @page{ size:${pageSize}; margin:8mm; } }`;

  // Wrap the current preview in a printable container
  let printArea = document.getElementById("print-area");
  if (!printArea) {
    printArea = document.createElement("div");
    printArea.id = "print-area";
    printArea.style.display = "none";
    document.body.appendChild(printArea);
  }
  printArea.innerHTML = preview.outerHTML;
  printArea.style.display = "block";
  window.print();
  printArea.style.display = "none";
});

// ---------- export: DOCX via Word-compatible HTML trick ----------
exportDocxBtn.addEventListener("click", () => {
  if (!lastResult) return;
  const sheetHtml = preview.innerHTML;
  const wrapped = wrapForWord(sheetHtml);
  const doc = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head><meta charset='utf-8'><title>Brahmastra Cheatsheet</title>
    <style>
      body{font-family:Calibri,Arial,sans-serif;}
      .topic-block{margin-bottom:14px;}
      .topic-block h3{font-size:13pt; border-bottom:1.5pt solid #111; padding-bottom:2pt;}
      .topic-block ul{margin:0; padding-left:18pt; font-size:10.5pt;}
      table.layoutgrid{width:100%; border-collapse:collapse;}
      table.layoutgrid td{vertical-align:top; border:0.5pt solid #ccc; padding:8pt; width:${selectedLayout === "grid42" ? "25%" : selectedLayout === "grid33" ? "33%" : "100%"};}
    </style></head>
    <body>${wrapped}</body></html>`;
  const blob = new Blob(['\ufeff', doc], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "brahmastra-cheatsheet.doc";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// Word doesn't respect CSS grid — convert grid layouts into a table for docx export
function wrapForWord(sheetHtml) {
  if (selectedLayout === "single") return sheetHtml;
  const cols = selectedLayout === "grid42" ? 4 : 3;
  const parser = new DOMParser();
  const parsed = parser.parseFromString(`<div>${sheetHtml}</div>`, "text/html");
  const blocks = Array.from(parsed.querySelectorAll(".topic-block"));
  let html = "<table class='layoutgrid'><tbody>";
  for (let i = 0; i < blocks.length; i += cols) {
    html += "<tr>";
    for (let j = i; j < i + cols; j++) {
      html += "<td>" + (blocks[j] ? blocks[j].outerHTML : "") + "</td>";
    }
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
}
