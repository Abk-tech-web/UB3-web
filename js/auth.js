// ============================================================================
// UB3 — Leadership portal auth logic (login, create account, reset password)
// ============================================================================

import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ---------------------------------------------------------------------- */
/* Tabs                                                                    */
/* ---------------------------------------------------------------------- */
document.querySelectorAll(".portal-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".portal-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".portal-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add("active");
  });
});

/* ---------------------------------------------------------------------- */
/* If already logged in, skip straight to the dashboard                    */
/* ---------------------------------------------------------------------- */
onAuthStateChanged(auth, (user) => {
  if (user) window.location.href = "dashboard.html";
});

/* ---------------------------------------------------------------------- */
/* Log in                                                                  */
/* ---------------------------------------------------------------------- */
document.getElementById("login-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = document.getElementById("login-status");
  const btn = form.querySelector("button[type=submit]");
  const data = new FormData(form);

  btn.disabled = true;
  btn.textContent = "Logging in…";
  status.className = "form-status";
  status.textContent = "";

  try {
    await signInWithEmailAndPassword(auth, data.get("email"), data.get("password"));
    status.textContent = "Success — redirecting…";
    status.className = "form-status success";
    window.location.href = "dashboard.html";
  } catch (err) {
    status.textContent = friendlyAuthError(err);
    status.className = "form-status error";
  } finally {
    btn.disabled = false;
    btn.textContent = "Log In";
  }
});

/* ---------------------------------------------------------------------- */
/* Create account                                                          */
/* ---------------------------------------------------------------------- */
document.getElementById("create-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = document.getElementById("create-status");
  const btn = form.querySelector("button[type=submit]");
  const data = new FormData(form);

  btn.disabled = true;
  btn.textContent = "Creating account…";
  status.className = "form-status";
  status.textContent = "";

  try {
    const cred = await createUserWithEmailAndPassword(auth, data.get("email"), data.get("password"));
    await updateProfile(cred.user, { displayName: data.get("name") });

    await setDoc(doc(db, "leaders", cred.user.uid), {
      name: data.get("name"),
      email: data.get("email"),
      position: data.get("position"),
      department: data.get("department"),
      phone: data.get("phone") || "",
      bio: "",
      photoURL: "",
      socials: { x: "", telegram: "" },
      securityQuestion: data.get("securityQuestion"),
      // NOTE: for real production use, verify the security answer server-side
      // (e.g. via a Cloud Function) instead of trusting client-stored values.
      securityAnswer: data.get("securityAnswer"),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    status.textContent = "Account created — redirecting…";
    status.className = "form-status success";
    window.location.href = "dashboard.html";
  } catch (err) {
    status.textContent = friendlyAuthError(err);
    status.className = "form-status error";
  } finally {
    btn.disabled = false;
    btn.textContent = "Create Account";
  }
});

/* ---------------------------------------------------------------------- */
/* Reset password                                                          */
/* ---------------------------------------------------------------------- */
document.getElementById("reset-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = document.getElementById("reset-status");
  const btn = form.querySelector("button[type=submit]");
  const data = new FormData(form);

  btn.disabled = true;
  btn.textContent = "Sending…";
  status.className = "form-status";
  status.textContent = "";

  try {
    await sendPasswordResetEmail(auth, data.get("email"));
    status.textContent = "If that email has an account, a reset link is on its way.";
    status.className = "form-status success";
    form.reset();
  } catch (err) {
    status.textContent = friendlyAuthError(err);
    status.className = "form-status error";
  } finally {
    btn.disabled = false;
    btn.textContent = "Send Reset Link";
  }
});

/* ---------------------------------------------------------------------- */
/* Helper: readable Firebase error messages                                */
/* ---------------------------------------------------------------------- */
function friendlyAuthError(err) {
  const code = err?.code || "";
  const map = {
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password. Try again or reset it.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/email-already-in-use": "An account already exists with that email.",
    "auth/weak-password": "Password should be at least 8 characters.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
  };
  return map[code] || "Something went wrong. Please try again.";
}
