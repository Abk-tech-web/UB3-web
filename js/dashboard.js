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
  deleteDoc,
  addDoc,
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

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

// Some phones/browsers occasionally fail to decode a picked image through
// the <img>/canvas path (even for a perfectly valid file) — memory
// pressure, an unusual color profile, etc. If that happens, fall back to
// storing the original file directly (still capped in size) so the save
// isn't blocked entirely.
async function photoFileToStoredURL(file) {
  try {
    return await resizeImageToDataURL(file);
  } catch (resizeErr) {
    console.warn("Photo resize failed, falling back to raw upload:", resizeErr);
    const RAW_FALLBACK_MAX_BYTES = 650 * 1024; // keep base64 result comfortably under Firestore's 1MB doc limit
    if (file.size > RAW_FALLBACK_MAX_BYTES) {
      throw new Error("Couldn't process that photo, and it's too large to store as-is. Please try a smaller image (under 650KB) or a different photo.");
    }
    return await readFileAsDataURL(file);
  }
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
  watchMyAnnouncements();
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

// Holds the processed (resized/compressed) photo data URL for whatever was
// most recently picked in the file input. We read the file immediately on
// selection rather than waiting for Save — some mobile browsers invalidate
// the File reference if too much time passes or the page state changes
// before it's read, causing a "file could not be read" error at submit time.
let pendingPhotoDataURL = null;
let pendingPhotoError = null;

document.getElementById("photo-input")?.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  pendingPhotoDataURL = null;
  pendingPhotoError = null;
  if (!file) return;

  const preview = document.getElementById("profile-avatar-preview");
  const status = document.getElementById("profile-status");
  if (!file.type.startsWith("image/")) {
    pendingPhotoError = "Please choose an image file.";
    status.textContent = pendingPhotoError;
    status.className = "form-status error";
    return;
  }

  preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Preview">`;
  status.textContent = "Processing photo…";
  status.className = "form-status";
  try {
    pendingPhotoDataURL = await photoFileToStoredURL(file);
    status.textContent = "Photo ready — click Save Changes to apply.";
    status.className = "form-status success";
  } catch (err) {
    pendingPhotoError = err?.message || "Couldn't process that photo.";
    status.textContent = pendingPhotoError;
    status.className = "form-status error";
  }
});

document.getElementById("profile-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = document.getElementById("profile-status");
  const btn = form.querySelector("button[type=submit]");
  const data = new FormData(form);

  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    if (pendingPhotoError) {
      throw new Error(pendingPhotoError);
    }
    const photoURL = pendingPhotoDataURL || currentLeader.photoURL || "";

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
    pendingPhotoDataURL = null;
    pendingPhotoError = null;

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

/* ---------------------------------------------------------------------- */
/* Inbox                                                                    */
/* ---------------------------------------------------------------------- */
function watchInbox() {
  const q = query(
    collection(db, "messages"),
    where("toLeaderId", "in", [currentUser.uid, "general"]),
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
            <span class="msg-from">${m.fromName || "Anonymous"} · ${m.fromEmail || ""}${m.toLeaderId === "general" ? ` <span class="ann-pin-tag">GENERAL</span>` : ""}</span>
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
      const detail = err?.message || err?.code || "unknown error";
      const urlMatch = detail.match(/https:\/\/console\.firebase\.google\.com\S+/);
      const detailHtml = urlMatch
        ? detail.slice(0, urlMatch.index) +
          `<a href="${urlMatch[0]}" target="_blank" rel="noopener" style="color:#7dd3fc;text-decoration:underline;">Tap here to create the required index</a>` +
          detail.slice(urlMatch.index + urlMatch[0].length)
        : detail;
      document.getElementById("msg-list").innerHTML = `<div class="empty-state">Couldn't load messages right now.<br><small style="opacity:.7;word-break:break-word;">(${detailHtml})</small></div>`;
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
/* Announcements — post to the public homepage feed                        */
/* ---------------------------------------------------------------------- */
document.getElementById("announcement-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = document.getElementById("announcement-status");
  const btn = form.querySelector("button[type=submit]");
  const data = new FormData(form);

  btn.disabled = true;
  btn.textContent = "Posting…";

  try {
    await addDoc(collection(db, "announcements"), {
      title: (data.get("title") || "").trim(),
      body: (data.get("body") || "").trim(),
      pinned: data.get("pinned") === "on",
      authorId: currentUser.uid,
      authorName: currentLeader.name || "UB3 Leader",
      authorPosition: currentLeader.position || "",
      authorPhoto: currentLeader.photoURL || "",
      createdAt: serverTimestamp(),
      likeCount: 0,
      commentCount: 0,
    });
    status.textContent = "Announcement posted — it's now live on the homepage.";
    status.className = "form-status success";
    form.reset();
  } catch (err) {
    status.textContent = "Couldn't post your announcement. Please try again.";
    status.className = "form-status error";
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Post Announcement";
  }
});

function watchMyAnnouncements() {
  const list = document.getElementById("my-announcements-list");
  if (!list) return;

  const q = query(
    collection(db, "announcements"),
    where("authorId", "==", currentUser.uid),
    orderBy("createdAt", "desc")
  );

  onSnapshot(
    q,
    (snap) => {
      if (snap.empty) {
        list.innerHTML = `<div class="empty-state">You haven't posted any announcements yet.</div>`;
        return;
      }

      list.innerHTML = "";
      snap.forEach((docSnap) => {
        const a = docSnap.data();
        const time = a.createdAt?.toDate ? a.createdAt.toDate().toLocaleString() : "";
        const item = document.createElement("div");
        item.className = "ann-item glass";
        item.innerHTML = `
          <div class="ann-item-top">
            <span class="ann-item-title">${escapeHtml(a.title)}${a.pinned ? `<span class="ann-pin-tag">PINNED</span>` : ""}</span>
            <span class="ann-item-time">${time}</span>
          </div>
          <div class="ann-item-body">${escapeHtml(a.body)}</div>
          <div class="ann-item-actions">
            <button type="button" class="ann-pin-btn" data-id="${docSnap.id}">${a.pinned ? "Unpin" : "Pin to top"}</button>
            <button type="button" class="ann-delete-btn" data-id="${docSnap.id}">Delete</button>
          </div>
        `;
        item.querySelector(".ann-pin-btn").addEventListener("click", async (btnEvent) => {
          const btn = btnEvent.currentTarget;
          btn.disabled = true;
          try {
            await updateDoc(doc(db, "announcements", docSnap.id), { pinned: !a.pinned });
          } catch (err) {
            console.error(err);
            alert("Couldn't update this announcement. Please try again.");
          } finally {
            btn.disabled = false;
          }
        });
        item.querySelector(".ann-delete-btn").addEventListener("click", async () => {
          if (!confirm("Delete this announcement? This can't be undone.")) return;
          try {
            await deleteDoc(doc(db, "announcements", docSnap.id));
          } catch (err) {
            console.error(err);
            alert("Couldn't delete this announcement. Please try again.");
          }
        });
        list.appendChild(item);
      });
    },
    (err) => {
      const detail = err?.message || err?.code || "unknown error";
      const urlMatch = detail.match(/https:\/\/console\.firebase\.google\.com\S+/);
      const detailHtml = urlMatch
        ? detail.slice(0, urlMatch.index) +
          `<a href="${urlMatch[0]}" target="_blank" rel="noopener" style="color:#7dd3fc;text-decoration:underline;">Tap here to create the required index</a>` +
          detail.slice(urlMatch.index + urlMatch[0].length)
        : detail;
      list.innerHTML = `<div class="empty-state">Couldn't load your announcements.<br><small style="opacity:.7;word-break:break-word;">(${detailHtml})</small></div>`;
      console.error(err);
    }
  );
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
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
