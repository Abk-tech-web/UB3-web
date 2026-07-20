// ============================================================================
// UB3 — Leader dashboard logic
// ============================================================================

import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  signOut,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initials } from "./leaders-data.js";

// Max photo size accepted for the profile picture. Photos are stored as a
// base64 string directly inside the leader's Firestore document (no
// Firebase Storage / Blaze plan required), so this must stay well under
// Firestore's 1MB per-document limit.
// Max size we allow the final base64 photo string to be. Photos are stored
// directly inside the leader's Firestore document (no Firebase Storage /
// Blaze plan required), so this must stay well under Firestore's 1MB
// per-document limit, leaving plenty of room for the rest of the profile.
const MAX_PHOTO_DATA_URL_BYTES = 300 * 1024; // ~300KB final encoded size
const PHOTO_MAX_DIMENSION = 480; // px, longest side

// Resizes/compresses an image file in the browser (via canvas) and returns
// a small base64 data URL, regardless of how large the original photo is.
function resizeImageToDataURL(file, maxDimension = PHOTO_MAX_DIMENSION) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > height && width > maxDimension) {
        height = Math.round((height * maxDimension) / width);
        width = maxDimension;
      } else if (height > maxDimension) {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      // Try decreasing JPEG quality until the result is small enough.
      let quality = 0.85;
      let dataUrl = canvas.toDataURL("image/jpeg", quality);
      while (dataUrl.length > MAX_PHOTO_DATA_URL_BYTES && quality > 0.3) {
        quality -= 0.15;
        dataUrl = canvas.toDataURL("image/jpeg", quality);
      }
      if (dataUrl.length > MAX_PHOTO_DATA_URL_BYTES) {
        reject(new Error("Photo is too large even after compression. Please choose a simpler image."));
        return;
      }
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read that image file."));
    };
    img.src = objectUrl;
  });
}

let currentUser = null;
let currentLeader = null;

/* ---------------------------------------------------------------------- */
/* Auth guard                                                              */
/* ---------------------------------------------------------------------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "portal.html";
    return;
  }
  currentUser = user;

  const leaderRef = doc(db, "leaders", user.uid);
  const snap = await getDoc(leaderRef);
  if (snap.exists()) {
    currentLeader = snap.data();
  } else {
    // Auth account exists but its Firestore profile is missing (e.g. it
    // never finished being created). Create it now so future saves work.
    currentLeader = {
      name: user.displayName || "Leader",
      email: user.email || "",
      position: "",
      department: "Executive",
      phone: "",
      bio: "",
      photoURL: "",
      socials: { x: "", telegram: "" },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(leaderRef, currentLeader).catch((err) => console.error("Could not create missing leader profile:", err));
  }

  document.getElementById("auth-gate").style.display = "none";
  document.getElementById("dash-shell").style.display = "grid";

  populateOverview();
  populateProfileForm();
  watchInbox();
});

document.getElementById("logout-btn")?.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "portal.html";
});

/* ---------------------------------------------------------------------- */
/* Sidebar navigation                                                      */
/* ---------------------------------------------------------------------- */
document.querySelectorAll(".dash-nav-item[data-panel]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".dash-nav-item[data-panel]").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".dash-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.querySelector(`.dash-panel[data-panel="${btn.dataset.panel}"]`).classList.add("active");
  });
});

/* ---------------------------------------------------------------------- */
/* Overview                                                                 */
/* ---------------------------------------------------------------------- */
function populateOverview() {
  document.getElementById("dash-greeting").textContent = `Welcome back, ${firstName(currentLeader.name)}`;
  document.getElementById("overview-name").textContent = currentLeader.name || "";
  document.getElementById("overview-role").textContent = currentLeader.position || "";
  document.getElementById("overview-dept").textContent = currentLeader.department || "";
  document.getElementById("overview-bio").textContent = currentLeader.bio || "No bio added yet — add one in Edit Profile.";
  renderAvatar("overview-avatar", currentLeader);
  renderAvatar("profile-avatar-preview", currentLeader);
}

function firstName(name) {
  return (name || "").split(" ")[0] || "there";
}

function renderAvatar(elId, leader) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = leader.photoURL
    ? `<img src="${leader.photoURL}" alt="${leader.name}">`
    : initials(leader.name || "U B");
}

/* ---------------------------------------------------------------------- */
/* Edit profile                                                            */
/* ---------------------------------------------------------------------- */
function populateProfileForm() {
  const form = document.getElementById("profile-form");
  form.name.value = currentLeader.name || "";
  form.email.value = currentLeader.email || currentUser.email || "";
  form.position.value = currentLeader.position || "";
  form.department.value = currentLeader.department || "Executive";
  form.phone.value = currentLeader.phone || "";
  form.bio.value = currentLeader.bio || "";
  form.x.value = currentLeader.socials?.x || "";
  form.telegram.value = currentLeader.socials?.telegram || "";
}

document.getElementById("profile-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = document.getElementById("profile-status");
  const btn = form.querySelector("button[type=submit]");
  const data = new FormData(form);

  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    let photoURL = currentLeader.photoURL || "";
    const file = document.getElementById("photo-input").files[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        throw new Error("Please choose an image file.");
      }
      photoURL = await resizeImageToDataURL(file);
    }

    const updates = {
      name: data.get("name"),
      position: data.get("position"),
      department: data.get("department"),
      phone: data.get("phone") || "",
      bio: data.get("bio") || "",
      photoURL,
      socials: { x: data.get("x") || "", telegram: data.get("telegram") || "" },
      updatedAt: serverTimestamp(),
    };

    await updateDoc(doc(db, "leaders", currentUser.uid), updates);
    currentLeader = { ...currentLeader, ...updates };

    populateOverview();
    status.textContent = "Profile updated successfully.";
    status.className = "form-status success";
  } catch (err) {
    status.textContent = err?.message || "Couldn't save changes. Please try again.";
    status.className = "form-status error";
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Save Changes";
  }
});

document.getElementById("photo-input")?.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const preview = document.getElementById("profile-avatar-preview");
  preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Preview">`;
});

/* ---------------------------------------------------------------------- */
/* Inbox                                                                    */
/* ---------------------------------------------------------------------- */
function watchInbox() {
  const q = query(
    collection(db, "messages"),
    where("toLeaderId", "==", currentUser.uid),
    orderBy("createdAt", "desc")
  );

  onSnapshot(
    q,
    (snap) => {
      const list = document.getElementById("msg-list");
      if (snap.empty) {
        list.innerHTML = `<div class="empty-state">No messages yet — visitor messages from your profile will show up here.</div>`;
        updateUnreadCount(0);
        return;
      }

      let unread = 0;
      list.innerHTML = "";
      snap.forEach((docSnap) => {
        const m = docSnap.data();
        if (!m.read) unread++;
        const time = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString() : "";
        const item = document.createElement("div");
        item.className = `msg-item glass ${m.read ? "" : "unread"}`;
        item.innerHTML = `
          <div class="msg-top">
            <span class="msg-from">${m.fromName || "Anonymous"} · ${m.fromEmail || ""}</span>
            <span class="msg-time">${time}</span>
          </div>
          <div class="msg-preview">${(m.body || "").slice(0, 140)}</div>
        `;
        item.addEventListener("click", () => openMessage(docSnap.id, m));
        list.appendChild(item);
      });

      updateUnreadCount(unread);
    },
    (err) => {
      document.getElementById("msg-list").innerHTML = `<div class="empty-state">Couldn't load messages right now.</div>`;
      console.error(err);
    }
  );
}

function updateUnreadCount(count) {
  const badge = document.getElementById("unread-badge");
  badge.textContent = count > 0 ? `(${count})` : "";
  document.getElementById("overview-unread-count").textContent = count;
}

async function openMessage(id, m) {
  if (!m.read) {
    try {
      await updateDoc(doc(db, "messages", id), { read: true });
    } catch (err) {
      console.error(err);
    }
  }
  const subject = encodeURIComponent(`Re: your message to ${currentLeader.name}`);
  const body = encodeURIComponent(`Hi ${m.fromName || ""},\n\n`);
  window.location.href = `mailto:${m.fromEmail}?subject=${subject}&body=${body}`;
}

/* ---------------------------------------------------------------------- */
/* Password change                                                         */
/* ---------------------------------------------------------------------- */
document.getElementById("password-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = document.getElementById("password-status");
  const btn = form.querySelector("button[type=submit]");
  const data = new FormData(form);

  btn.disabled = true;
  btn.textContent = "Updating…";

  try {
    const cred = EmailAuthProvider.credential(currentUser.email, data.get("currentPassword"));
    await reauthenticateWithCredential(currentUser, cred);
    await updatePassword(currentUser, data.get("newPassword"));
    status.textContent = "Password updated successfully.";
    status.className = "form-status success";
    form.reset();
  } catch (err) {
    status.textContent = err.code === "auth/wrong-password" || err.code === "auth/invalid-credential"
      ? "Current password is incorrect."
      : "Couldn't update password. Please try again.";
    status.className = "form-status error";
  } finally {
    btn.disabled = false;
    btn.textContent = "Update Password";
  }
});

/* ---------------------------------------------------------------------- */
/* Security question                                                       */
/* ---------------------------------------------------------------------- */
document.getElementById("security-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = document.getElementById("security-status");
  const btn = form.querySelector("button[type=submit]");
  const data = new FormData(form);

  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    await updateDoc(doc(db, "leaders", currentUser.uid), {
      securityQuestion: data.get("securityQuestion"),
      securityAnswer: data.get("securityAnswer"),
      updatedAt: serverTimestamp(),
    });
    status.textContent = "Security question updated.";
    status.className = "form-status success";
    form.reset();
  } catch (err) {
    status.textContent = "Couldn't save. Please try again.";
    status.className = "form-status error";
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Save Security Question";
  }
});
