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
  getDocs,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initials } from "./leaders-data.js";

// Max size we allow the final base64 photo string to be. Photos are stored
// directly inside the leader's Firestore document (no Firebase Storage /
// Blaze plan required), so this must stay well under Firestore's 1MB
// per-document limit, leaving plenty of room for the rest of the profile.
const MAX_PHOTO_DATA_URL_BYTES = 300 * 1024; // ~300KB final encoded size
const PHOTO_MAX_DIMENSION = 480; // px, longest side

// Same idea, but for an optional photo attached to an announcement post —
// allowed to be a bit larger/wider since it's a banner image, not an avatar,
// while still leaving plenty of headroom under Firestore's 1MiB doc limit.
const MAX_POST_IMAGE_DATA_URL_BYTES = 700 * 1024; // ~700KB final encoded size
const POST_IMAGE_MAX_DIMENSION = 1280; // px, longest side

// Resizes/compresses an image file in the browser (via canvas) and returns
// a small base64 data URL, regardless of how large the original photo is.
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

      // Try decreasing JPEG quality until the result is small enough.
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
async function photoFileToStoredURL(file, maxDimension = PHOTO_MAX_DIMENSION, maxBytes = MAX_PHOTO_DATA_URL_BYTES) {
  try {
    return await resizeImageToDataURL(file, maxDimension, maxBytes);
  } catch (resizeErr) {
    console.warn("Photo resize failed, falling back to raw upload:", resizeErr);
    const rawFallbackMaxBytes = Math.min(maxBytes, 650 * 1024); // keep base64 result comfortably under Firestore's 1MB doc limit
    if (file.size > rawFallbackMaxBytes) {
      throw new Error(`Couldn't process that photo, and it's too large to store as-is. Please try a smaller image (under ${Math.round(rawFallbackMaxBytes / 1024)}KB) or a different photo.`);
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

  // Whether someone gets the full dashboard or just Notifications depends
  // ENTIRELY on whether a leaders/{uid} profile already exists — never on
  // just being signed in. That profile can only ever be created by the
  // controlled email/password signup flow in auth.js (and firestore.rules
  // enforces that server-side too, capped at 9 accounts). Visitors who
  // sign in with Google purely to comment on the public site never get
  // one, so they land here as a visitor, not a leader — no profile is
  // ever auto-created for them.
  const leaderRef = doc(db, "leaders", user.uid);
  let snap = null;
  try {
    snap = await getDoc(leaderRef);
  } catch (err) {
    console.error("Couldn't check leader status:", err);
  }

  document.getElementById("auth-gate").style.display = "none";
  document.getElementById("dash-shell").style.display = "grid";

  if (snap?.exists()) {
    currentLeader = snap.data();
    populateOverview();
    populateProfileForm();
    watchInbox();
    watchMyAnnouncements();
    watchRoadmapUpdates();
    watchRoadmapPhases();
  } else {
    enterVisitorMode(user);
  }

  // Notifications work the same way for everyone with a signed-in uid —
  // a leader gets notified about their posts/comments, a visitor gets
  // notified about their own comment activity (likes, replies, mentions).
  watchNotifications();
});

// Locks the dashboard down to just the Notifications panel for anyone
// signed in who isn't one of the 9 leader accounts — i.e. a visitor who
// signed in with Google to comment on the public site, not through the
// leader signup/login flow.
function enterVisitorMode(user) {
  document.getElementById("dash-greeting").textContent = `Welcome, ${firstName(user.displayName || "there")}`;

  const notice = document.getElementById("visitor-notice");
  if (notice) notice.style.display = "block";

  document.querySelectorAll(".dash-nav-item[data-panel]").forEach((btn) => {
    if (btn.dataset.panel === "notifications") return;
    btn.disabled = true;
    btn.classList.add("locked");
    btn.title = "Only UB3 leaders have access to this section.";
  });

  document.querySelectorAll(".dash-nav-item[data-panel]").forEach((b) => b.classList.remove("active"));
  document.querySelector('.dash-nav-item[data-panel="notifications"]')?.classList.add("active");
  document.querySelectorAll(".dash-panel").forEach((p) => p.classList.remove("active"));
  document.querySelector('.dash-panel[data-panel="notifications"]')?.classList.add("active");
}

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
/* Notifications — a visitor liking/commenting on this leader's posts or   */
/* comments (js/main.js writes these as a side effect on the public site)  */
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
        list.innerHTML = `<div class="empty-state">No notifications yet — you'll see one here whenever a visitor engages with your posts or comments.</div>`;
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
        item.addEventListener("click", () => openNotification(docSnap.id, n));
        list.appendChild(item);
      });

      updateNotifUnreadCount(unread);
    },
    (err) => {
      const detail = err?.message || err?.code || "unknown error";
      const urlMatch = detail.match(/https:\/\/console\.firebase\.google\.com\S+/);
      const detailHtml = urlMatch
        ? detail.slice(0, urlMatch.index) +
          `<a href="${urlMatch[0]}" target="_blank" rel="noopener" style="color:#7dd3fc;text-decoration:underline;">Tap here to create the required index</a>` +
          detail.slice(urlMatch.index + urlMatch[0].length)
        : detail;
      list.innerHTML = `<div class="empty-state">Couldn't load notifications right now.<br><small style="opacity:.7;word-break:break-word;">(${detailHtml})</small></div>`;
      console.error(err);
    }
  );
}

function updateNotifUnreadCount(count) {
  const badge = document.getElementById("notif-badge");
  if (badge) badge.textContent = count > 0 ? `(${count})` : "";
}

async function openNotification(id, n) {
  if (!n.read) {
    try {
      await updateDoc(doc(db, "notifications", id), { read: true });
    } catch (err) {
      console.error(err);
    }
  }
  if (n.announcementId) {
    // index.html reads ?post=<id> on load and scrolls straight to that
    // exact card (with a highlight flash), instead of just landing on the
    // Announcements section and making them hunt for it.
    window.open(`index.html?post=${encodeURIComponent(n.announcementId)}#announcements`, "_blank");
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
/* Announcements — post to the public homepage feed                        */
/* ---------------------------------------------------------------------- */

// Same "process on selection, not on submit" reasoning as the profile
// photo picker above.
let pendingAnnPhotoDataURL = null;
let pendingAnnPhotoError = null;

document.getElementById("announcement-photo-input")?.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  pendingAnnPhotoDataURL = null;
  pendingAnnPhotoError = null;

  const preview = document.getElementById("announcement-photo-preview");
  const status = document.getElementById("announcement-photo-status");
  const removeBtn = document.getElementById("announcement-photo-remove");

  if (!file) {
    preview.innerHTML = "No photo";
    removeBtn.style.display = "none";
    status.textContent = "";
    return;
  }
  if (!file.type.startsWith("image/")) {
    pendingAnnPhotoError = "Please choose an image file.";
    status.textContent = pendingAnnPhotoError;
    status.className = "ann-photo-status error";
    return;
  }

  preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Preview">`;
  removeBtn.style.display = "inline-block";
  status.textContent = "Processing photo…";
  status.className = "ann-photo-status";
  try {
    pendingAnnPhotoDataURL = await photoFileToStoredURL(file, POST_IMAGE_MAX_DIMENSION, MAX_POST_IMAGE_DATA_URL_BYTES);
    status.textContent = "Photo ready — it'll be attached when you post.";
    status.className = "ann-photo-status success";
  } catch (err) {
    pendingAnnPhotoError = err?.message || "Couldn't process that photo.";
    status.textContent = pendingAnnPhotoError;
    status.className = "ann-photo-status error";
  }
});

document.getElementById("announcement-photo-remove")?.addEventListener("click", () => {
  pendingAnnPhotoDataURL = null;
  pendingAnnPhotoError = null;
  const input = document.getElementById("announcement-photo-input");
  const preview = document.getElementById("announcement-photo-preview");
  const status = document.getElementById("announcement-photo-status");
  const removeBtn = document.getElementById("announcement-photo-remove");
  if (input) input.value = "";
  preview.innerHTML = "No photo";
  status.textContent = "";
  removeBtn.style.display = "none";
});

document.getElementById("announcement-poll-toggle")?.addEventListener("change", (e) => {
  const builder = document.getElementById("announcement-poll-builder");
  if (builder) builder.style.display = e.target.checked ? "block" : "none";
});

document.getElementById("poll-add-option")?.addEventListener("click", () => {
  const list = document.getElementById("poll-options-list");
  if (!list) return;
  const count = list.querySelectorAll(".poll-option-input").length;
  if (count >= 4) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "poll-option-input";
  input.maxLength = 80;
  input.placeholder = `Option ${count + 1}`;
  list.appendChild(input);
});

document.getElementById("announcement-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = document.getElementById("announcement-status");
  const btn = form.querySelector("button[type=submit]");
  const data = new FormData(form);

  btn.disabled = true;
  btn.textContent = "Posting…";

  try {
    if (pendingAnnPhotoError) {
      throw new Error(pendingAnnPhotoError);
    }

    const category = data.get("category") || "Announcement";
    let poll = null;
    if (document.getElementById("announcement-poll-toggle")?.checked) {
      const question = (document.getElementById("poll-question")?.value || "").trim();
      const options = Array.from(document.querySelectorAll(".poll-option-input"))
        .map((inp) => inp.value.trim())
        .filter(Boolean);
      if (!question) throw new Error("Add a question for your poll, or uncheck 'Include a poll'.");
      if (options.length < 2) throw new Error("A poll needs at least 2 options.");
      poll = { question, options, votes: options.map(() => 0) };
    }

    const payload = {
      title: (data.get("title") || "").trim(),
      body: (data.get("body") || "").trim(),
      pinned: data.get("pinned") === "on",
      category,
      authorId: currentUser.uid,
      authorName: currentLeader.name || "UB3 Leader",
      authorPosition: currentLeader.position || "",
      authorPhoto: currentLeader.photoURL || "",
      createdAt: serverTimestamp(),
      likeCount: 0,
      commentCount: 0,
    };
    if (pendingAnnPhotoDataURL) payload.imageUrl = pendingAnnPhotoDataURL;
    if (poll) payload.poll = poll;
    await addDoc(collection(db, "announcements"), payload);
    status.textContent = "Announcement posted — it's now live on the homepage.";
    status.className = "form-status success";
    form.reset();
    pendingAnnPhotoDataURL = null;
    pendingAnnPhotoError = null;
    const preview = document.getElementById("announcement-photo-preview");
    const removeBtn = document.getElementById("announcement-photo-remove");
    const photoStatus = document.getElementById("announcement-photo-status");
    if (preview) preview.innerHTML = "No photo";
    if (removeBtn) removeBtn.style.display = "none";
    if (photoStatus) photoStatus.textContent = "";
    const pollBuilder = document.getElementById("announcement-poll-builder");
    if (pollBuilder) pollBuilder.style.display = "none";
    const pollOptionsList = document.getElementById("poll-options-list");
    if (pollOptionsList) {
      pollOptionsList.innerHTML = `
        <input type="text" class="poll-option-input" placeholder="Option 1" maxlength="80">
        <input type="text" class="poll-option-input" placeholder="Option 2" maxlength="80">`;
    }
  } catch (err) {
    status.textContent = err?.message || "Couldn't post your announcement. Please try again.";
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
          ${a.imageUrl ? `<img class="ann-item-photo" src="${a.imageUrl}" alt="">` : ""}
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

/* ---------------------------------------------------------------------- */
/* Site Settings — Roadmap history (roadmapUpdates/*, shared by all 9      */
/* leaders). Posting a new update adds it to the top of the history        */
/* instead of overwriting a single value — every past update stays        */
/* visible and editable, and any leader can edit or delete any entry.      */
/* The newest-by-createdAt entry is always what's live on the homepage.    */
/* ---------------------------------------------------------------------- */
document.getElementById("roadmap-settings-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = document.getElementById("roadmap-settings-status");
  const btn = form.querySelector("button[type=submit]");
  const data = new FormData(form);

  const percent = Math.max(0, Math.min(100, parseInt(data.get("percent"), 10) || 0));
  const label = (data.get("label") || "").trim();
  if (!label) return;

  btn.disabled = true;
  btn.textContent = "Posting…";
  try {
    await addDoc(collection(db, "roadmapUpdates"), {
      percent,
      label,
      authorId: currentUser.uid,
      authorName: currentLeader?.name || "A leader",
      createdAt: serverTimestamp(),
    });
    form.reset();
    status.textContent = "Posted — now live on the homepage.";
    status.className = "form-status success";
  } catch (err) {
    status.textContent = "Couldn't post. Please try again.";
    status.className = "form-status error";
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Post Update";
  }
});

function watchRoadmapUpdates() {
  const list = document.getElementById("roadmap-history-list");
  if (!list) return;

  const q = query(collection(db, "roadmapUpdates"), orderBy("createdAt", "desc"));

  onSnapshot(
    q,
    (snap) => {
      if (snap.empty) {
        list.innerHTML = `<div class="empty-state">No roadmap updates posted yet.</div>`;
        return;
      }

      list.innerHTML = "";
      snap.docs.forEach((docSnap, i) => {
        const r = docSnap.data();
        const time = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString() : "";
        const item = document.createElement("div");
        item.className = "ann-item glass";
        item.innerHTML = `
          <div class="ann-item-top">
            <span class="ann-item-title">${escapeHtml(r.label || "")}${i === 0 ? `<span class="ann-pin-tag">LIVE</span>` : ""}</span>
            <span class="ann-item-time">${time}</span>
          </div>
          <div class="ann-item-body js-roadmap-view">${r.percent ?? 0}% overall — posted by ${escapeHtml(r.authorName || "a leader")}</div>
          <form class="roadmap-edit-form">
            <div class="field"><label>Status label</label><input type="text" name="label" maxlength="80" value="${escapeHtml(r.label || "")}" required></div>
            <div class="field"><label>Overall progress (%)</label><input type="number" name="percent" min="0" max="100" step="1" value="${r.percent ?? 0}" required></div>
            <div class="ann-item-actions">
              <button type="submit" class="btn btn-primary">Save</button>
              <button type="button" class="ann-pin-btn js-roadmap-cancel">Cancel</button>
            </div>
          </form>
          <div class="ann-item-actions">
            <button type="button" class="ann-pin-btn js-roadmap-edit">Edit</button>
            <button type="button" class="ann-delete-btn js-roadmap-delete">Delete</button>
          </div>
        `;

        const editForm = item.querySelector(".roadmap-edit-form");
        item.querySelector(".js-roadmap-edit").addEventListener("click", () => item.classList.add("editing"));
        item.querySelector(".js-roadmap-cancel").addEventListener("click", () => item.classList.remove("editing"));
        editForm.addEventListener("submit", async (evt) => {
          evt.preventDefault();
          const fd = new FormData(editForm);
          const percent = Math.max(0, Math.min(100, parseInt(fd.get("percent"), 10) || 0));
          const label = (fd.get("label") || "").trim();
          if (!label) return;
          const saveBtn = editForm.querySelector("button[type=submit]");
          saveBtn.disabled = true;
          try {
            await updateDoc(doc(db, "roadmapUpdates", docSnap.id), { label, percent });
            item.classList.remove("editing");
          } catch (err) {
            console.error(err);
            alert("Couldn't save this update. Please try again.");
          } finally {
            saveBtn.disabled = false;
          }
        });
        item.querySelector(".js-roadmap-delete").addEventListener("click", async () => {
          if (!confirm("Delete this roadmap update? This can't be undone.")) return;
          try {
            await deleteDoc(doc(db, "roadmapUpdates", docSnap.id));
          } catch (err) {
            console.error(err);
            alert("Couldn't delete this update. Please try again.");
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
      list.innerHTML = `<div class="empty-state">Couldn't load roadmap history.<br><small style="opacity:.7;word-break:break-word;">(${detailHtml})</small></div>`;
      console.error(err);
    }
  );
}

/* ---------------------------------------------------------------------- */
/* Roadmap Manager — full phase CMS (roadmapPhases/*, shared by all 9      */
/* leaders, same trust model as roadmapUpdates: any leader may create,     */
/* edit, delete, publish, or reorder ANY phase). The public site's         */
/* Roadmap timeline reads this collection directly (see the "Roadmap      */
/* phase timeline" block in js/main.js) — nothing on that page is         */
/* hardcoded, so every change here is instant on the live site.           */
/* ---------------------------------------------------------------------- */
const STATUS_OPTIONS = ["Planning", "In Progress", "Completed", "Paused", "Cancelled"];
const PUBLISH_OPTIONS = ["published", "draft", "hidden"];

function slugify(str) {
  return (str || "").toLowerCase().replace(/\s+/g, "-");
}

const phaseForm = document.getElementById("phase-form");
const phaseProgressRange = document.getElementById("phase-progress-range");
const phaseProgressOut = document.getElementById("phase-progress-out");
const phaseFormTitle = document.getElementById("phase-form-title");
const phaseFormSubmit = document.getElementById("phase-form-submit");
const phaseFormCancel = document.getElementById("phase-form-cancel");
const phaseFormStatus = document.getElementById("phase-form-status");
const phaseList = document.getElementById("phase-list");

phaseProgressRange?.addEventListener("input", () => {
  phaseProgressOut.textContent = phaseProgressRange.value;
});

function resetPhaseForm() {
  if (!phaseForm) return;
  phaseForm.reset();
  phaseForm.phaseId.value = "";
  phaseProgressRange.value = 0;
  phaseProgressOut.textContent = "0";
  phaseFormTitle.textContent = "Add Roadmap Phase";
  phaseFormSubmit.textContent = "Create Phase";
  phaseFormCancel.style.display = "none";
}

phaseFormCancel?.addEventListener("click", resetPhaseForm);

function populatePhaseFormForEdit(id, p) {
  if (!phaseForm) return;
  phaseForm.phaseId.value = id;
  phaseForm.phaseNumber.value = p.phaseNumber || "";
  phaseForm.phaseLabel.value = p.phaseLabel || "";
  phaseForm.title.value = p.title || "";
  phaseForm.description.value = p.description || "";
  phaseProgressRange.value = p.progress ?? 0;
  phaseProgressOut.textContent = String(p.progress ?? 0);
  phaseForm.status.value = STATUS_OPTIONS.includes(p.status) ? p.status : "Planning";
  phaseForm.displayOrder.value = p.displayOrder ?? "";
  phaseForm.published.value = PUBLISH_OPTIONS.includes(p.published) ? p.published : "draft";
  phaseFormTitle.textContent = `Editing Phase ${p.phaseNumber || ""} — ${p.phaseLabel || ""}`.trim();
  phaseFormSubmit.textContent = "Save Changes";
  phaseFormCancel.style.display = "inline-block";
  phaseForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

phaseForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = new FormData(phaseForm);
  const phaseId = (data.get("phaseId") || "").trim();

  const payload = {
    phaseNumber: (data.get("phaseNumber") || "").trim(),
    phaseLabel: (data.get("phaseLabel") || "").trim(),
    title: (data.get("title") || "").trim(),
    description: (data.get("description") || "").trim(),
    progress: Math.max(0, Math.min(100, parseInt(data.get("progressRange"), 10) || 0)),
    status: STATUS_OPTIONS.includes(data.get("status")) ? data.get("status") : "Planning",
    displayOrder: parseInt(data.get("displayOrder"), 10) || 0,
    published: PUBLISH_OPTIONS.includes(data.get("published")) ? data.get("published") : "draft",
    updatedBy: currentUser.uid,
    updatedByName: currentLeader?.name || "A leader",
    updatedAt: serverTimestamp(),
  };
  if (!payload.title) return;

  phaseFormSubmit.disabled = true;
  const originalLabel = phaseFormSubmit.textContent;
  phaseFormSubmit.textContent = "Saving…";
  try {
    if (phaseId) {
      await updateDoc(doc(db, "roadmapPhases", phaseId), payload);
    } else {
      await addDoc(collection(db, "roadmapPhases"), {
        ...payload,
        createdBy: currentUser.uid,
        createdByName: currentLeader?.name || "A leader",
        createdAt: serverTimestamp(),
        deleted: false,
      });
    }
    resetPhaseForm();
    phaseFormStatus.textContent = phaseId ? "Phase updated — now live wherever it's published." : "Phase created.";
    phaseFormStatus.className = "form-status success";
  } catch (err) {
    console.error(err);
    phaseFormStatus.textContent = "Couldn't save this phase. Please try again.";
    phaseFormStatus.className = "form-status error";
  } finally {
    phaseFormSubmit.disabled = false;
    phaseFormSubmit.textContent = originalLabel;
  }
});

const phasePreviewOverlay = document.getElementById("phase-preview-overlay");
const phasePreviewBody = document.getElementById("phase-preview-body");
document.getElementById("phase-preview-close")?.addEventListener("click", () => {
  phasePreviewOverlay.classList.remove("open");
});
phasePreviewOverlay?.addEventListener("click", (e) => {
  if (e.target === phasePreviewOverlay) phasePreviewOverlay.classList.remove("open");
});

function openPhasePreview(p) {
  const pct = Math.max(0, Math.min(100, Number(p.progress) || 0));
  const heading = [p.phaseNumber ? `Phase ${escapeHtml(p.phaseNumber)}` : "", escapeHtml(p.phaseLabel || "")]
    .filter(Boolean)
    .join(" — ");
  phasePreviewBody.innerHTML = `
    ${heading ? `<div class="r-phase">${heading}</div>` : ""}
    <h3>${escapeHtml(p.title || "")}</h3>
    ${p.description ? `<p>${escapeHtml(p.description)}</p>` : ""}
    <div class="roadmap-item-progress">
      <div class="roadmap-item-progress-track"><div class="roadmap-item-progress-fill" style="width:${pct}%"></div></div>
      <span class="roadmap-item-progress-pct">${pct}%</span>
    </div>
    ${p.published !== "published" ? `<p style="color:var(--silver-dim);font-size:12.5px;margin-top:16px;">This phase is currently <strong>${escapeHtml(p.published)}</strong> and won't show on the live site until it's Published.</p>` : ""}
  `;
  phasePreviewOverlay.classList.add("open");
}

let currentPhaseOrder = []; // [{id, data}] in the order currently rendered — used by drag-and-drop reorder

function watchRoadmapPhases() {
  if (!phaseList) return;

  onSnapshot(
    collection(db, "roadmapPhases"),
    (snap) => {
      if (snap.empty) {
        phaseList.innerHTML = `<div class="empty-state">No roadmap phases yet — create the first one above.</div>`;
        currentPhaseOrder = [];
        return;
      }

      const docs = snap.docs
        .map((d) => ({ id: d.id, data: d.data() }))
        .sort((a, b) => (a.data.displayOrder ?? 0) - (b.data.displayOrder ?? 0));
      currentPhaseOrder = docs;

      phaseList.innerHTML = "";
      docs.forEach(({ id, data: p }) => {
        const created = p.createdAt?.toDate ? p.createdAt.toDate().toLocaleDateString() : "—";
        const updated = p.updatedAt?.toDate ? p.updatedAt.toDate().toLocaleString() : "—";
        const pct = Math.max(0, Math.min(100, Number(p.progress) || 0));

        const item = document.createElement("div");
        item.className = "phase-item glass";
        item.draggable = true;
        item.dataset.phaseId = id;
        item.innerHTML = `
          <span class="phase-item-handle" title="Drag to reorder">⠿</span>
          <div class="phase-item-main">
            <div class="phase-item-top">
              <span class="phase-item-phase">Phase ${escapeHtml(p.phaseNumber || "")} — ${escapeHtml(p.phaseLabel || "")}</span>
              <span class="phase-pill status-${slugify(p.status)}">${escapeHtml(p.status || "Planning")}</span>
              <span class="phase-pill pub-${p.published || "draft"}">${escapeHtml((p.published || "draft").toUpperCase())}</span>
              <span class="phase-pill">${pct}%</span>
            </div>
            <div class="phase-item-title">${escapeHtml(p.title || "")}</div>
            ${p.description ? `<div class="phase-item-desc">${escapeHtml(p.description)}</div>` : ""}
            <div class="phase-item-meta">Order ${p.displayOrder ?? "—"} · Created by ${escapeHtml(p.createdByName || "—")} on ${created} · Last updated by ${escapeHtml(p.updatedByName || "—")} (${updated})</div>
            <div class="phase-item-actions">
              <button type="button" class="ann-pin-btn js-phase-preview">Preview</button>
              <button type="button" class="ann-pin-btn js-phase-edit">Edit</button>
              <button type="button" class="ann-pin-btn js-phase-duplicate">Duplicate</button>
              <button type="button" class="ann-pin-btn js-phase-toggle-publish">${p.published === "published" ? "Unpublish" : "Publish"}</button>
              <button type="button" class="ann-delete-btn js-phase-delete">Delete</button>
            </div>
          </div>
        `;

        item.querySelector(".js-phase-preview").addEventListener("click", () => openPhasePreview(p));
        item.querySelector(".js-phase-edit").addEventListener("click", () => populatePhaseFormForEdit(id, p));

        item.querySelector(".js-phase-duplicate").addEventListener("click", async () => {
          try {
            const maxOrder = currentPhaseOrder.reduce((m, x) => Math.max(m, x.data.displayOrder ?? 0), 0);
            await addDoc(collection(db, "roadmapPhases"), {
              phaseNumber: p.phaseNumber || "",
              phaseLabel: p.phaseLabel || "",
              title: `${p.title || ""} (Copy)`,
              description: p.description || "",
              progress: p.progress ?? 0,
              status: p.status || "Planning",
              displayOrder: maxOrder + 1,
              published: "draft",
              createdBy: currentUser.uid,
              createdByName: currentLeader?.name || "A leader",
              updatedBy: currentUser.uid,
              updatedByName: currentLeader?.name || "A leader",
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              deleted: false,
            });
          } catch (err) {
            console.error(err);
            alert("Couldn't duplicate this phase. Please try again.");
          }
        });

        item.querySelector(".js-phase-toggle-publish").addEventListener("click", async () => {
          try {
            await updateDoc(doc(db, "roadmapPhases", id), {
              published: p.published === "published" ? "draft" : "published",
              updatedBy: currentUser.uid,
              updatedByName: currentLeader?.name || "A leader",
              updatedAt: serverTimestamp(),
            });
          } catch (err) {
            console.error(err);
            alert("Couldn't update publish state. Please try again.");
          }
        });

        item.querySelector(".js-phase-delete").addEventListener("click", async () => {
          if (!confirm("Are you sure you want to permanently delete this roadmap?")) return;
          try {
            await deleteDoc(doc(db, "roadmapPhases", id));
            if (phaseForm.phaseId.value === id) resetPhaseForm();
          } catch (err) {
            console.error(err);
            alert("Couldn't delete this phase. Please try again.");
          }
        });

        // Drag-and-drop reorder — dropping a card onto another swaps their
        // position in currentPhaseOrder, then every displayOrder in the list
        // is rewritten in one batch so the public timeline (which sorts by
        // displayOrder) instantly reflects the new sequence.
        item.addEventListener("dragstart", () => item.classList.add("dragging"));
        item.addEventListener("dragend", () => {
          item.classList.remove("dragging");
          phaseList.querySelectorAll(".phase-item").forEach((el) => el.classList.remove("drag-over"));
        });
        item.addEventListener("dragover", (e) => {
          e.preventDefault();
          item.classList.add("drag-over");
        });
        item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
        item.addEventListener("drop", async (e) => {
          e.preventDefault();
          item.classList.remove("drag-over");
          const draggingEl = phaseList.querySelector(".phase-item.dragging");
          if (!draggingEl || draggingEl === item) return;

          const fromId = draggingEl.dataset.phaseId;
          const toId = item.dataset.phaseId;
          const ids = currentPhaseOrder.map((x) => x.id);
          const fromIdx = ids.indexOf(fromId);
          const toIdx = ids.indexOf(toId);
          if (fromIdx === -1 || toIdx === -1) return;
          const reordered = [...currentPhaseOrder];
          const [moved] = reordered.splice(fromIdx, 1);
          reordered.splice(toIdx, 0, moved);

          try {
            const batch = writeBatch(db);
            reordered.forEach((entry, idx) => {
              batch.update(doc(db, "roadmapPhases", entry.id), { displayOrder: idx + 1 });
            });
            await batch.commit();
          } catch (err) {
            console.error(err);
            alert("Couldn't save the new order. Please try again.");
          }
        });

        phaseList.appendChild(item);
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
      phaseList.innerHTML = `<div class="empty-state">Couldn't load roadmap phases.<br><small style="opacity:.7;word-break:break-word;">(${detailHtml})</small></div>`;
      console.error(err);
    }
  );
}
