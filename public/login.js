const form = document.getElementById("loginForm");
const errorEl = document.getElementById("error");
const go = document.getElementById("go");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  go.disabled = true;
  go.textContent = "Opening";
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: document.getElementById("password").value }),
    });
    if (res.ok) {
      location.href = "/";
      return;
    }
    const data = await res.json().catch(() => ({}));
    errorEl.textContent = data.error || "Could not sign in.";
    errorEl.hidden = false;
  } catch {
    errorEl.textContent = "Ledger is not running. Start the server and try again.";
    errorEl.hidden = false;
  } finally {
    go.disabled = false;
    go.textContent = "Open Ledger";
  }
});
