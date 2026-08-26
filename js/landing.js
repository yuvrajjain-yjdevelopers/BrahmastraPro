// Keep the landing-page draft when the visitor is asked to sign in.
// It is copied into the generator after authentication; no generation happens
// until the user explicitly presses the generator button.
const quickForm = document.getElementById("quick-generate-form");
const quickSyllabus = document.getElementById("quick-syllabus");

quickForm.addEventListener("submit", event => {
  event.preventDefault();
  const syllabus = quickSyllabus.value.trim();
  if (syllabus) localStorage.setItem("brahmastra_pending_syllabus", syllabus);
  window.location.href = "dashboard.html";
});
