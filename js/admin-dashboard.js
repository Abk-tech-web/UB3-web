// ============================================================================
// UB3 — Admin dashboard logic
// Completely separate from js/dashboard.js (Leader Portal). Only 4 sections
// exist here: Notifications, Community Feedback, Profile Editing, Whitepaper
// Management — there is no Leader Inbox, Announcements, or Roadmap Manager
// anywhere in this file.
// ============================================================================

import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { adminInitials } from "./admins-data.js";
import { uploadFileWithProgress } from "./media-upload.js";

const MAX_PHOTO_DATA_URL_BYTES = 300 * 1024;
const PHOTO_MAX_DIMENSION = 480;

let currentUser = null;
let currentAdmin = null;

function resizeImageToDataURL(file, maxDimension = PHOTO_MAX_DIMENSION, maxBytes = MAX_PHOTO_DATA_URL_BYTES) {
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
      let quality = 0.85;
      let dataUrl = canvas.toDataURL("image/jpeg", quality);
      while (dataUrl.length > maxBytes && quality > 0.3) {
        quality -= 0.15;
        dataUrl = canvas.toDataURL("image/jpeg", quality);
      }
      if (dataUrl.length > maxBytes) {
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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function firstName(name) {
  return (name || "").split(" ")[0] || "Admin";
}

function renderAvatar(elId, admin) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = admin.photoURL
    ? `<img src="${admin.photoURL}" alt="${admin.name}">`
    : adminInitials(admin.name || "UB3 Admin");
}

/* ---------------------------------------------------------------------- */
/* Auth guard — only an approved admin (admins/{uid} doc owner) may see    */
/* this dashboard. Everyone else is sent back to the Admin Portal.         */
/* ---------------------------------------------------------------------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "admin-portal.html";
    return;
  }
  currentUser = user;

  let snap = null;
  try {
    snap = await getDoc(doc(db, "admins", user.uid));
  } catch (err) {
    console.error("Couldn't check admin status:", err);
  }

  if (!snap?.exists()) {
    window.location.href = "admin-portal.html";
    return;
  }

  currentAdmin = snap.data();
  document.getElementById("auth-gate").style.display = "none";
  document.getElementById("dash-shell").style.display = "grid";

  populateProfileForm();
  watchNotifications();
  watchFeedback();
  loadWhitepaper();
});

document.getElementById("logout-btn")?.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "admin-portal.html";
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
/* Profile editing                                                         */
/* ---------------------------------------------------------------------- */
function populateProfileForm() {
  document.getElementById("dash-greeting").innerHTML =
    `Welcome back, ${firstName(currentAdmin.name)}<span class="admin-badge-pill">ADMIN</span>`;

  const form = document.getElementById("profile-form");
  form.name.value = currentAdmin.name || "";
  form.email.value = currentAdmin.email || currentUser.email || "";
  form.position.value = currentAdmin.position || "Admin 1";
  form.bio.value = currentAdmin.bio || "";
  form.x.value = currentAdmin.socials?.x || "";
  form.telegram.value = currentAdmin.socials?.telegram || "";
  renderAvatar("profile-avatar-preview", currentAdmin);
}

let pendingPhotoDataURL = null;
let pendingPhotoError = null;

document.getElementById("photo-input")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  pendingPhotoError = null;
  try {
    pendingPhotoDataURL = await resizeImageToDataURL(file);
    renderAvatar("profile-avatar-preview", { ...currentAdmin, photoURL: pendingPhotoDataURL });
  } catch (err) {
    pendingPhotoError = err.message;
  }
});

document.getElementById("profile-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = document.getElementById("profile-status");
  const btn = form.querySelector("button[type=submit]");
  const data = new FormData(form);

  if (pendingPhotoError) {
    status.textContent = pendingPhotoError;
    status.className = "form-status error";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Saving…";
  status.className = "form-status";
  status.textContent = "";

  try {
    const update = {
      name: data.get("name"),
      bio: data.get("bio") || "",
      socials: { x: data.get("x") || "", telegram: data.get("telegram") || "" },
      updatedAt: serverTimestamp(),
    };
    if (pendingPhotoDataURL) update.photoURL = pendingPhotoDataURL;

    await updateDoc(doc(db, "admins", currentUser.uid), update);
    currentAdmin = { ...currentAdmin, ...update };
    pendingPhotoDataURL = null;

    status.textContent = "Profile updated.";
    status.className = "form-status success";
    populateProfileForm();
  } catch (err) {
    status.textContent = "Couldn't save your profile. Please try again.";
    status.className = "form-status error";
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Save Changes";
  }
});

/* ---------------------------------------------------------------------- */
/* Notifications — same shared `notifications` collection leaders use,     */
/* keyed to this admin's own uid.                                          */
/* ---------------------------------------------------------------------- */
const NOTIF_LABELS = {
  post_like: "Liked your post",
  post_comment: "Commented on your post",
  comment_like: "Liked your comment",
  comment_reply: "Replied to your comment",
  mention: "Mentioned you in a comment",
};

function watchNotifications() {
  const list = document.getElementById("notif-list");
  if (!list) return;

  const q = query(
    collection(db, "notifications"),
    where("leaderId", "==", currentUser.uid),
    orderBy("createdAt", "desc"),
    limit(50)
  );

  onSnapshot(
    q,
    (snap) => {
      if (snap.empty) {
        list.innerHTML = `<div class="empty-state">No notifications yet.</div>`;
        updateNotifUnreadCount(0);
        return;
      }
      let unread = 0;
      list.innerHTML = "";
      snap.forEach((docSnap) => {
        const n = docSnap.data();
        if (!n.read) unread++;
        const time = n.createdAt?.toDate ? n.createdAt.toDate().toLocaleString() : "";
        const item = document.createElement("div");
        item.className = `msg-item glass ${n.read ? "" : "unread"}`;
        item.innerHTML = `
          <div class="msg-top">
            <span class="msg-from">${NOTIF_LABELS[n.type] || "New activity"}</span>
            <span class="msg-time">${time}</span>
          </div>
          <div class="msg-preview">${escapeHtml(n.body || "")}</div>
        `;
        item.addEventListener("click", () => markNotificationRead(docSnap.id, n));
        list.appendChild(item);
      });
      updateNotifUnreadCount(unread);
    },
    (err) => {
      list.innerHTML = `<div class="empty-state">Couldn't load notifications right now.</div>`;
      console.error(err);
    }
  );
}

function updateNotifUnreadCount(count) {
  const badge = document.getElementById("notif-badge");
  if (badge) badge.textContent = count > 0 ? `(${count})` : "";
}

async function markNotificationRead(id, n) {
  if (n.read) return;
  try {
    await updateDoc(doc(db, "notifications", id), { read: true });
  } catch (err) {
    console.error(err);
  }
}

document.getElementById("notif-mark-all-read")?.addEventListener("click", async () => {
  const btn = document.getElementById("notif-mark-all-read");
  btn.disabled = true;
  try {
    const q = query(
      collection(db, "notifications"),
      where("leaderId", "==", currentUser.uid),
      where("read", "==", false)
    );
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map((d) => updateDoc(doc(db, "notifications", d.id), { read: true })));
  } catch (err) {
    console.error("Mark all as read failed:", err);
  } finally {
    btn.disabled = false;
  }
});

/* ---------------------------------------------------------------------- */
/* General Community Feedback — its own collection, separate from the      */
/* leaders' `messages` inbox.                                              */
/* ---------------------------------------------------------------------- */
function watchFeedback() {
  const list = document.getElementById("feedback-list");
  if (!list) return;

  const q = query(collection(db, "communityFeedback"), orderBy("createdAt", "desc"));

  onSnapshot(
    q,
    (snap) => {
      if (snap.empty) {
        list.innerHTML = `<div class="empty-state">No community feedback yet — general feedback from visitors will show up here.</div>`;
        updateFeedbackBadge(0);
        return;
      }
      let unread = 0;
      list.innerHTML = "";
      snap.forEach((docSnap) => {
        const f = docSnap.data();
        if (!f.read) unread++;
        const time = f.createdAt?.toDate ? f.createdAt.toDate().toLocaleString() : "";
        const item = document.createElement("div");
        item.className = `msg-item glass ${f.read ? "" : "unread"}`;
        item.innerHTML = `
          <div class="msg-top">
            <span class="msg-from">${escapeHtml(f.fromName || "Anonymous")} · ${escapeHtml(f.fromEmail || "")}</span>
            <span class="msg-time">${time}</span>
          </div>
          <div class="msg-preview">${escapeHtml(f.body || "")}</div>
        `;
        item.addEventListener("click", () => markFeedbackRead(docSnap.id, f));
        list.appendChild(item);
      });
      updateFeedbackBadge(unread);
    },
    (err) => {
      list.innerHTML = `<div class="empty-state">Couldn't load feedback right now.</div>`;
      console.error(err);
    }
  );
}

function updateFeedbackBadge(count) {
  const badge = document.getElementById("feedback-badge");
  if (badge) badge.textContent = count > 0 ? `(${count})` : "";
}

async function markFeedbackRead(id, f) {
  if (f.read) return;
  try {
    await updateDoc(doc(db, "communityFeedback", id), { read: true });
  } catch (err) {
    console.error(err);
  }
}

/* ---------------------------------------------------------------------- */
/* Whitepaper Management                                                   */
/* ---------------------------------------------------------------------- */
async function loadWhitepaper() {
  const box = document.getElementById("whitepaper-current-box");
  if (!box) return;
  try {
    const snap = await getDoc(doc(db, "whitepaper", "current"));
    if (!snap.exists()) {
      box.innerHTML = `<div class="empty-state">No whitepaper published yet.</div>`;
      return;
    }
    const wp = snap.data();
    const time = wp.publishedAt?.toDate ? wp.publishedAt.toDate().toLocaleString() : "";
    box.innerHTML = `
      <div class="whitepaper-current">
        <div>
          <div class="whitepaper-current-name">${escapeHtml(wp.fileName || "Whitepaper.pdf")}${wp.version ? ` — ${escapeHtml(wp.version)}` : ""}</div>
          <div class="whitepaper-current-meta">Published ${time}</div>
        </div>
        <div class="whitepaper-actions">
          <a href="${wp.url}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">View</a>
          <button type="button" class="ann-delete-btn" id="whitepaper-delete-btn">Delete</button>
        </div>
      </div>
    `;
    document.getElementById("whitepaper-delete-btn")?.addEventListener("click", deleteWhitepaper);
  } catch (err) {
    box.innerHTML = `<div class="empty-state">Couldn't load the current whitepaper.</div>`;
    console.error(err);
  }
}

async function deleteWhitepaper() {
  if (!confirm("Delete the current whitepaper? Visitors will no longer be able to download it until you publish a new one.")) return;
  try {
    await deleteDoc(doc(db, "whitepaper", "current"));
    loadWhitepaper();
  } catch (err) {
    console.error(err);
    alert("Couldn't delete the whitepaper. Please try again.");
  }
}

document.getElementById("whitepaper-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = document.getElementById("whitepaper-status");
  const btn = form.querySelector("button[type=submit]");
  const data = new FormData(form);
  const file = document.getElementById("whitepaper-file-input").files?.[0];

  if (!file) {
    status.textContent = "Please choose a PDF file.";
    status.className = "form-status error";
    return;
  }
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
    status.textContent = "The whitepaper must be a PDF file.";
    status.className = "form-status error";
    return;
  }

  const progressWrap = document.getElementById("whitepaper-upload-progress");
  const progressFill = document.getElementById("whitepaper-upload-progress-fill");
  const progressPct = document.getElementById("whitepaper-upload-progress-pct");

  btn.disabled = true;
  btn.textContent = "Publishing…";
  status.className = "form-status";
  status.textContent = "";
  progressWrap.style.display = "flex";

  try {
    const path = `whitepaper/ub3-whitepaper-${Date.now()}`;
    const url = await uploadFileWithProgress(
      path,
      file,
      (pct) => {
        progressFill.style.width = `${pct}%`;
        progressPct.textContent = `${pct}%`;
      },
      "raw"
    );

    await setDoc(doc(db, "whitepaper", "current"), {
      url,
      fileName: file.name,
      version: data.get("version") || "",
      publishedBy: currentUser.uid,
      publishedAt: serverTimestamp(),
    });

    status.textContent = "Whitepaper published — it's now live on the public site.";
    status.className = "form-status success";
    form.reset();
    loadWhitepaper();
  } catch (err) {
    status.textContent = err.message || "Couldn't publish the whitepaper. Please try again.";
    status.className = "form-status error";
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Publish Whitepaper";
    progressWrap.style.display = "none";
    progressFill.style.width = "0%";
    progressPct.textContent = "0%";
  }
});
