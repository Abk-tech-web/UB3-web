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
  getDoc,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { MAX_LEADER_ACCOUNTS } from "./leaders-data.js";

const LIMIT_MESSAGE = `Account creation is limited to UB3's ${MAX_LEADER_ACCOUNTS} leaders. All ${MAX_LEADER_ACCOUNTS} spots have been filled — contact the Head of Technology if this is a mistake.`;

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

  const emailInput = (data.get("email") || "").trim().toLowerCase();
  const statsRef = doc(db, "meta", "stats");

  // Fast, friendly pre-check — anyone can read meta/stats (see firestore.rules),
  // so we can tell people the spots are full before we even try to sign them up.
  try {
    const statsSnap = await getDoc(statsRef);
    const currentCount = statsSnap.exists() ? (statsSnap.data().leaderCount || 0) : 0;
    if (currentCount >= MAX_LEADER_ACCOUNTS) {
      status.textContent = LIMIT_MESSAGE;
      status.className = "form-status error";
      btn.disabled = false;
      btn.textContent = "Create Account";
      return;
    }
  } catch (err) {
    // If the pre-check itself fails, fall through — the transaction below is
    // the real, authoritative gate and will catch it regardless.
  }

  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, emailInput, data.get("password"));
    await updateProfile(cred.user, { displayName: data.get("name") });

    // Authoritative check: atomically read the current count and, only if
    // there's still room, create the leader profile AND bump the counter in
    // the same transaction. firestore.rules enforces the count can never
    // exceed MAX_LEADER_ACCOUNTS, so this is safe even if two people submit
    // at the exact same moment.
    await runTransaction(db, async (tx) => {
      const statsSnap = await tx.get(statsRef);
      const currentCount = statsSnap.exists() ? (statsSnap.data().leaderCount || 0) : 0;
      if (currentCount >= MAX_LEADER_ACCOUNTS) {
        throw new Error("LEADER_LIMIT_REACHED");
      }

      tx.set(doc(db, "leaders", cred.user.uid), {
        name: data.get("name"),
        email: emailInput,
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

      tx.set(statsRef, { leaderCount: currentCount + 1 }, { merge: true });
    });

    status.textContent = "Account created — redirecting…";
    status.className = "form-status success";
    window.location.href = "dashboard.html";
  } catch (err) {
    // If we got as far as creating the Auth account but couldn't finish
    // (limit hit in the race, or the write failed), don't leave behind an
    // orphaned Auth user with no profile — remove it and sign out.
    if (cred?.user) {
      await cred.user.delete().catch(() => {});
    }
    status.textContent = err.message === "LEADER_LIMIT_REACHED" ? LIMIT_MESSAGE : friendlyAuthError(err);
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
