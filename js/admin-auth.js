// ============================================================================
// UB3 — Admin Portal auth logic
// Completely separate from js/auth.js (Leader Portal). Only Google Sign-In is
// offered here — no email/password, no visitor login/signup, no leader
// signup. First-admin creation is a one-time, self-locking action.
// ============================================================================

import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { MAX_ADMIN_ACCOUNTS } from "./admins-data.js";

const panels = {
  signin: document.getElementById("panel-signin"),
  create: document.getElementById("panel-create"),
  denied: document.getElementById("panel-denied"),
};

function showPanel(name) {
  Object.values(panels).forEach((p) => p?.classList.remove("active"));
  panels[name]?.classList.add("active");
}

/* ---------------------------------------------------------------------- */
/* Auth state — decides which of the 3 panels to show                      */
/* ---------------------------------------------------------------------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showPanel("signin");
    return;
  }

  // Already an approved admin? Straight to the Admin Dashboard.
  try {
    const adminSnap = await getDoc(doc(db, "admins", user.uid));
    if (adminSnap.exists()) {
      window.location.href = "admin-dashboard.html";
      return;
    }
  } catch (err) {
    console.error("Couldn't check admin status:", err);
  }

  // Not an admin yet — is admin registration still open?
  try {
    const statsSnap = await getDoc(doc(db, "meta", "adminStats"));
    const currentCount = statsSnap.exists() ? (statsSnap.data().adminCount || 0) : 0;
    if (currentCount >= MAX_ADMIN_ACCOUNTS) {
      showPanel("denied");
    } else {
      const nameInput = document.querySelector("#create-admin-form input[name='name']");
      if (nameInput && !nameInput.value) nameInput.value = user.displayName || "";
      showPanel("create");
    }
  } catch (err) {
    console.error("Couldn't check admin registration status:", err);
    showPanel("denied");
  }
});

/* ---------------------------------------------------------------------- */
/* Google Sign-In                                                          */
/* ---------------------------------------------------------------------- */
document.getElementById("google-signin-btn")?.addEventListener("click", async () => {
  const status = document.getElementById("signin-status");
  status.textContent = "";
  status.className = "form-status";
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
    // onAuthStateChanged above takes it from here.
  } catch (err) {
    status.textContent = "Couldn't sign in with Google. Please try again.";
    status.className = "form-status error";
    console.error(err);
  }
});

/* ---------------------------------------------------------------------- */
/* First-admin creation (self-locking)                                     */
/* ---------------------------------------------------------------------- */
document.getElementById("create-admin-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = document.getElementById("create-admin-status");
  const btn = form.querySelector("button[type=submit]");
  const data = new FormData(form);
  const user = auth.currentUser;

  if (!user) {
    status.textContent = "Your session expired — please sign in again.";
    status.className = "form-status error";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Creating admin profile…";
  status.className = "form-status";
  status.textContent = "";

  const statsRef = doc(db, "meta", "adminStats");

  try {
    // Authoritative, race-safe check-and-create: atomically read the
    // current admin count and, only if there's still room (i.e. nobody has
    // won this race already), create the admin profile AND lock the counter
    // at MAX_ADMIN_ACCOUNTS in the same transaction. firestore.rules further
    // enforces this server-side (meta/adminStats.update is disabled
    // entirely), so this can never be bypassed.
    await runTransaction(db, async (tx) => {
      const statsSnap = await tx.get(statsRef);
      const currentCount = statsSnap.exists() ? (statsSnap.data().adminCount || 0) : 0;
      if (currentCount >= MAX_ADMIN_ACCOUNTS) {
        throw new Error("ADMIN_LIMIT_REACHED");
      }

      tx.set(doc(db, "admins", user.uid), {
        name: data.get("name"),
        email: user.email || "",
        position: "Admin 1",
        bio: data.get("bio") || "",
        photoURL: user.photoURL || "",
        socials: { x: "", telegram: "" },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.set(statsRef, { adminCount: currentCount + 1 }, { merge: true });
    });

    status.textContent = "Admin profile created — redirecting…";
    status.className = "form-status success";
    window.location.href = "admin-dashboard.html";
  } catch (err) {
    status.textContent =
      err.message === "ADMIN_LIMIT_REACHED"
        ? "Access Denied. You are not authorized to create an administrator profile. Please contact the system owner if you believe this is an error."
        : "Something went wrong creating your admin profile. Please try again.";
    status.className = "form-status error";
    if (err.message === "ADMIN_LIMIT_REACHED") showPanel("denied");
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Create Admin Profile";
  }
});

/* ---------------------------------------------------------------------- */
/* Access Denied — sign out                                                 */
/* ---------------------------------------------------------------------- */
document.getElementById("denied-signout-btn")?.addEventListener("click", async () => {
  await signOut(auth);
  showPanel("signin");
});
