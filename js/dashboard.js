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
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
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
import { LEADERS, initials } from "./leaders-data.js";
import { attachMentionAutocomplete, findMentionedLeaders } from "./mentions.js";
import {
  MAX_IMAGES_PER_POST,
  compressImageFile,
  validateVideoFile,
  uploadFileWithProgress,
  deleteFileByURL,
  postMediaPath,
} from "./media-upload.js";

// Max size we allow the final base64 photo string to be. Photos are stored
// directly inside the leader's Firestore document (no Firebase Storage /
// Blaze plan required), so this must stay well under Firestore's 1MB
// per-document limit, leaving plenty of room for the rest of the profile.
const MAX_PHOTO_DATA_URL_BYTES = 300 * 1024; // ~300KB final encoded size
const PHOTO_MAX_DIMENSION = 480; // px, longest side

// Note: post images/video no longer go through this data-URL path — they
// upload to Firebase Storage via js/media-upload.js. Kept here only for
// the profile-photo picker below, which still stores a small inline photo.

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

// Hydrates the LEADERS roster (from leaders-data.js) with each slot's live
// uid/photo/etc, same merge main.js does for the public site — needed here
// so the post composer's @mention autocomplete only ever offers verified
// leaders (a claimed portal account), never an unclaimed roster slot.
function normalizePosition(pos) {
  return (pos || "").trim().toLowerCase().replace(/\s+/g, " ");
}
async function loadLeaderRoster() {
  try {
    const snap = await getDocs(collection(db, "leaders"));
    const byPosition = new Map();
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const key = normalizePosition(data.position);
      if (key) byPosition.set(key, { ...data, uid: docSnap.id });
    });
    LEADERS.forEach((slot) => {
      const live = byPosition.get(normalizePosition(slot.position));
      if (!live) return;
      slot.uid = live.uid;
      if (live.name) slot.name = live.name;
      if (live.photoURL) slot.photo = live.photoURL;
    });
  } catch (err) {
    console.warn("Could not load leader roster for @mention autocomplete:", err);
  }
}

// Wires "@" autocomplete + role-aware suggestions onto the post composer's
// message box — same recognition rules used on the public site, so a post
// created here highlights + links its mentions identically once published.
function setupAnnouncementMentionAutocomplete() {
  const textarea = document.querySelector("#announcement-form textarea[name='body']");
  attachMentionAutocomplete(textarea, { getLeaders: () => LEADERS, initials, escapeHtml });
}

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
    loadLeaderRoster().then(setupAnnouncementMentionAutocomplete);
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

// ---------------------------------------------------------------------
// Multi-image / video composer for a new post.
// pendingImages: [{ id, file }] in selection/display order.
// pendingVideo:  { file, duration } | null
// Images and video are mutually exclusive per post (matches the existing
// single-attachment post structure — a post is text, text+images, or
// text+video, never images+video together).
// ---------------------------------------------------------------------
let pendingImages = [];
let pendingVideo = null;
let composerUploading = false;

function annEls() {
  return {
    imagesInput: document.getElementById("announcement-images-input"),
    videoInput: document.getElementById("announcement-video-input"),
    dropzone: document.getElementById("ann-dropzone"),
    pickImagesBtn: document.getElementById("ann-pick-images-btn"),
    pickVideoBtn: document.getElementById("ann-pick-video-btn"),
    previewGrid: document.getElementById("ann-image-previews"),
    videoPreview: document.getElementById("ann-video-preview"),
    status: document.getElementById("announcement-media-status"),
    progressWrap: document.getElementById("ann-upload-progress"),
    progressFill: document.getElementById("ann-upload-progress-fill"),
    progressPct: document.getElementById("ann-upload-progress-pct"),
  };
}

function setMediaStatus(statusEl, text, kind) {
  if (!statusEl) return;
  statusEl.textContent = text || "";
  statusEl.className = "ann-photo-status" + (kind ? ` ${kind}` : "");
}

function renderComposerImagePreviews() {
  const { previewGrid } = annEls();
  if (!previewGrid) return;
  previewGrid.innerHTML = pendingImages
    .map(
      (item, i) => `
      <div class="media-preview-item" data-id="${item.id}">
        <img src="${item.previewUrl}" alt="Preview ${i + 1}">
        <span class="media-preview-badge">${i + 1}</span>
        <button type="button" class="media-preview-remove" data-remove-id="${item.id}" aria-label="Remove image">&times;</button>
      </div>`
    )
    .join("");
  previewGrid.querySelectorAll(".media-preview-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-remove-id");
      pendingImages = pendingImages.filter((it) => it.id !== id);
      renderComposerImagePreviews();
      const { imagesInput } = annEls();
      if (imagesInput) imagesInput.value = "";
    });
  });
}

function renderComposerVideoPreview() {
  const { videoPreview } = annEls();
  if (!videoPreview) return;
  if (!pendingVideo) {
    videoPreview.style.display = "none";
    videoPreview.innerHTML = "";
    return;
  }
  videoPreview.style.display = "block";
  videoPreview.innerHTML = `
    <video src="${pendingVideo.previewUrl}" controls muted></video>
    <button type="button" class="media-preview-remove" id="ann-video-remove" aria-label="Remove video" style="top:10px; right:10px;">&times;</button>`;
  document.getElementById("ann-video-remove")?.addEventListener("click", () => {
    pendingVideo = null;
    const { videoInput } = annEls();
    if (videoInput) videoInput.value = "";
    renderComposerVideoPreview();
  });
}

async function addComposerImages(fileList) {
  const { status, imagesInput } = annEls();
  if (pendingVideo) {
    setMediaStatus(status, "A post can't have both images and a video — remove the video first.", "error");
    return;
  }
  const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  const room = MAX_IMAGES_PER_POST - pendingImages.length;
  if (room <= 0) {
    setMediaStatus(status, `You can attach up to ${MAX_IMAGES_PER_POST} photos per post.`, "error");
    if (imagesInput) imagesInput.value = "";
    return;
  }
  const toAdd = files.slice(0, room);
  if (files.length > toAdd.length) {
    setMediaStatus(status, `Only added ${toAdd.length} — a post can have up to ${MAX_IMAGES_PER_POST} photos.`, "error");
  } else {
    setMediaStatus(status, "", "");
  }
  toAdd.forEach((file) => {
    pendingImages.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file, previewUrl: URL.createObjectURL(file) });
  });
  renderComposerImagePreviews();
  if (imagesInput) imagesInput.value = "";
}

async function setComposerVideo(file) {
  const { status, videoInput } = annEls();
  if (!file) return;
  if (pendingImages.length) {
    setMediaStatus(status, "A post can't have both images and a video — remove the photos first.", "error");
    if (videoInput) videoInput.value = "";
    return;
  }
  setMediaStatus(status, "Checking video…", "");
  try {
    const duration = await validateVideoFile(file);
    pendingVideo = { file, duration, previewUrl: URL.createObjectURL(file) };
    renderComposerVideoPreview();
    setMediaStatus(status, "Video ready — it'll be attached when you post.", "success");
  } catch (err) {
    if (videoInput) videoInput.value = "";
    setMediaStatus(status, err?.message || "Couldn't use that video.", "error");
  }
}

function resetComposerMedia() {
  pendingImages = [];
  pendingVideo = null;
  const { imagesInput, videoInput, status } = annEls();
  if (imagesInput) imagesInput.value = "";
  if (videoInput) videoInput.value = "";
  renderComposerImagePreviews();
  renderComposerVideoPreview();
  setMediaStatus(status, "", "");
}

function wireMediaDropzone({ dropzone, pickImagesBtn, pickVideoBtn, imagesInput, videoInput, onImages, onVideo }) {
  if (!dropzone) return;
  pickImagesBtn?.addEventListener("click", () => imagesInput?.click());
  pickVideoBtn?.addEventListener("click", () => videoInput?.click());
  dropzone.addEventListener("click", (e) => {
    if (e.target === dropzone || e.target.closest(".media-dropzone-copy") === e.target) imagesInput?.click();
  });
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      imagesInput?.click();
    }
  });
  imagesInput?.addEventListener("change", (e) => onImages(e.target.files));
  videoInput?.addEventListener("change", (e) => onVideo(e.target.files?.[0]));

  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("drag-active");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag-active");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    const videoFile = files.find((f) => f.type.startsWith("video/"));
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (videoFile && !imageFiles.length) {
      onVideo(videoFile);
    } else if (imageFiles.length) {
      onImages(imageFiles);
    }
  });
}

wireMediaDropzone({
  ...annEls(),
  onImages: addComposerImages,
  onVideo: setComposerVideo,
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
  if (composerUploading) return;
  const form = e.target;
  const status = document.getElementById("announcement-status");
  const btn = form.querySelector("button[type=submit]");
  const data = new FormData(form);
  const { progressWrap, progressFill, progressPct, status: mediaStatus } = annEls();

  composerUploading = true;
  btn.disabled = true;
  btn.textContent = "Posting…";

  const showProgress = (pct) => {
    if (progressWrap) progressWrap.style.display = "flex";
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressPct) progressPct.textContent = `${pct}%`;
  };
  const hideProgress = () => {
    if (progressWrap) progressWrap.style.display = "none";
    if (progressFill) progressFill.style.width = "0%";
  };

  try {
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

    const bodyVal = (data.get("body") || "").trim();
    // Snapshot {id, name} for every verified leader @-mentioned in this
    // post, so the mention keeps working (and pointing at the right
    // profile) even if that leader later changes their display name.
    const mentionedNow = findMentionedLeaders(bodyVal, LEADERS).map((l) => ({ id: l.id, name: l.name }));

    const payload = {
      title: (data.get("title") || "").trim(),
      body: bodyVal,
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
    if (poll) payload.poll = poll;
    if (mentionedNow.length) payload.mentions = mentionedNow;

    // Pre-generate the doc ID so uploaded media can live under a stable
    // announcement-media/{uid}/{postId}/… path before the doc itself
    // exists.
    const postRef = doc(collection(db, "announcements"));

    if (pendingImages.length) {
      const uploadedUrls = [];
      showProgress(0);
      for (let i = 0; i < pendingImages.length; i++) {
        setMediaStatus(mediaStatus, `Uploading photo ${i + 1} of ${pendingImages.length}…`, "");
        const blob = await compressImageFile(pendingImages[i].file);
        const path = postMediaPath(currentUser.uid, postRef.id, "img", i, "jpg");
        const url = await uploadFileWithProgress(path, blob, (pct) => {
          const overall = Math.round(((i + pct / 100) / pendingImages.length) * 100);
          showProgress(overall);
        });
        uploadedUrls.push(url);
      }
      payload.images = uploadedUrls;
    } else if (pendingVideo) {
      setMediaStatus(mediaStatus, "Uploading video…", "");
      showProgress(0);
      const ext = (pendingVideo.file.name.split(".").pop() || "mp4").toLowerCase();
      const path = postMediaPath(currentUser.uid, postRef.id, "video", 0, ext);
      const url = await uploadFileWithProgress(path, pendingVideo.file, showProgress);
      payload.video = url;
    }

    await setDoc(postRef, payload);
    status.textContent = "Announcement posted — it's now live on the homepage.";
    status.className = "form-status success";
    form.reset();
    resetComposerMedia();
    hideProgress();
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
    hideProgress();
    console.error(err);
  } finally {
    composerUploading = false;
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
        // Legacy single-image posts only ever set imageUrl; newer posts use
        // the images[] array. Normalize to one list so both render the same.
        const images = Array.isArray(a.images) && a.images.length ? a.images : a.imageUrl ? [a.imageUrl] : [];
        const MAX_STRIP = 4;
        const mediaStripHtml = images.length
          ? `<div class="ann-item-media-strip">
              ${images
                .slice(0, MAX_STRIP)
                .map((url) => `<img src="${url}" alt="">`)
                .join("")}
              ${images.length > MAX_STRIP ? `<div class="ann-item-media-more">+${images.length - MAX_STRIP}</div>` : ""}
            </div>`
          : a.video
          ? `<div class="ann-item-media-strip"><video src="${a.video}" muted></video></div>`
          : "";

        const item = document.createElement("div");
        item.className = "ann-item glass";
        item.innerHTML = `
          <div class="ann-item-top">
            <span class="ann-item-title">${escapeHtml(a.title)}${a.pinned ? `<span class="ann-pin-tag">PINNED</span>` : ""}</span>
            <span class="ann-item-time">${time}</span>
          </div>
          <div class="ann-item-body">${escapeHtml(a.body)}</div>
          ${mediaStripHtml}
          <div class="ann-item-actions">
            <button type="button" class="ann-edit-btn" data-id="${docSnap.id}">Edit</button>
            <button type="button" class="ann-pin-btn" data-id="${docSnap.id}">${a.pinned ? "Unpin" : "Pin to top"}</button>
            <button type="button" class="ann-delete-btn" data-id="${docSnap.id}">Delete</button>
          </div>
        `;
        item.querySelector(".ann-edit-btn").addEventListener("click", () => openEditPostModal(docSnap.id, a));
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
            // Best-effort cleanup of this post's media in Storage — never
            // blocks the delete itself if a file is already gone.
            await Promise.all([...images.map((url) => deleteFileByURL(url)), a.video ? deleteFileByURL(a.video) : null]);
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
/* Edit Post modal — add/remove/replace images, remove/replace video,     */
/* without deleting and recreating the whole post.                        */
/* ---------------------------------------------------------------------- */

let editingPostId = null;
// Each entry: { id, kind: 'existing'|'new', url? (existing), file?/previewUrl? (new) }
let editImageItems = [];
// { kind: 'existing'|'new'|'removed', url? (existing), file? (new) } | null if post never had a video
let editVideoState = null;
let editUploading = false;
// Existing (already-uploaded) image URLs removed during this edit session —
// deleted from Storage only once the edit is actually saved.
let editRemovedImageUrls = [];

function editEls() {
  return {
    overlay: document.getElementById("edit-post-overlay"),
    form: document.getElementById("edit-post-form"),
    titleInput: document.getElementById("edit-post-title"),
    bodyInput: document.getElementById("edit-post-body"),
    imagesInput: document.getElementById("edit-images-input"),
    videoInput: document.getElementById("edit-video-input"),
    dropzone: document.getElementById("edit-dropzone"),
    pickImagesBtn: document.getElementById("edit-pick-images-btn"),
    pickVideoBtn: document.getElementById("edit-pick-video-btn"),
    previewGrid: document.getElementById("edit-image-previews"),
    videoPreview: document.getElementById("edit-video-preview"),
    status: document.getElementById("edit-media-status"),
    progressWrap: document.getElementById("edit-upload-progress"),
    progressFill: document.getElementById("edit-upload-progress-fill"),
    progressPct: document.getElementById("edit-upload-progress-pct"),
    saveBtn: document.getElementById("edit-post-save"),
  };
}

function openEditPostModal(id, a) {
  editingPostId = id;
  const existingImages = Array.isArray(a.images) && a.images.length ? a.images : a.imageUrl ? [a.imageUrl] : [];
  editImageItems = existingImages.map((url, i) => ({ id: `existing-${i}-${Math.random().toString(36).slice(2, 6)}`, kind: "existing", url }));
  editVideoState = a.video ? { kind: "existing", url: a.video } : null;
  editRemovedImageUrls = [];

  const { overlay, titleInput, bodyInput, status, imagesInput, videoInput } = editEls();
  if (titleInput) titleInput.value = a.title || "";
  if (bodyInput) bodyInput.value = a.body || "";
  if (imagesInput) imagesInput.value = "";
  if (videoInput) videoInput.value = "";
  setMediaStatus(status, "", "");
  renderEditImagePreviews();
  renderEditVideoPreview();
  overlay?.classList.add("open");
}

function closeEditPostModal() {
  const { overlay } = editEls();
  overlay?.classList.remove("open");
  editingPostId = null;
  editImageItems = [];
  editVideoState = null;
  editRemovedImageUrls = [];
}

document.getElementById("edit-post-close")?.addEventListener("click", closeEditPostModal);
document.getElementById("edit-post-overlay")?.addEventListener("click", (e) => {
  if (e.target.id === "edit-post-overlay") closeEditPostModal();
});

function renderEditImagePreviews() {
  const { previewGrid } = editEls();
  if (!previewGrid) return;
  previewGrid.innerHTML = editImageItems
    .map((item, i) => {
      const src = item.kind === "existing" ? item.url : item.previewUrl;
      return `
      <div class="media-preview-item" data-id="${item.id}">
        <img src="${src}" alt="Preview ${i + 1}">
        <span class="media-preview-badge">${i + 1}</span>
        <button type="button" class="media-preview-remove" data-remove-id="${item.id}" aria-label="Remove image">&times;</button>
      </div>`;
    })
    .join("");
  previewGrid.querySelectorAll(".media-preview-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-remove-id");
  const removedItem = editImageItems.find((it) => it.id === id);
      if (removedItem && removedItem.kind === "existing") editRemovedImageUrls.push(removedItem.url);
      editImageItems = editImageItems.filter((it) => it.id !== id);
      renderEditImagePreviews();
    });
  });
}

function renderEditVideoPreview() {
  const { videoPreview } = editEls();
  if (!videoPreview) return;
  if (!editVideoState || editVideoState.kind === "removed") {
    videoPreview.style.display = "none";
    videoPreview.innerHTML = "";
    return;
  }
  const src = editVideoState.kind === "existing" ? editVideoState.url : editVideoState.previewUrl;
  videoPreview.style.display = "block";
  videoPreview.innerHTML = `
    <video src="${src}" controls muted></video>
    <button type="button" class="media-preview-remove" id="edit-video-remove" aria-label="Remove video" style="top:10px; right:10px;">&times;</button>`;
  document.getElementById("edit-video-remove")?.addEventListener("click", () => {
    editVideoState = editVideoState.kind === "existing" ? { kind: "removed", url: editVideoState.url } : null;
    renderEditVideoPreview();
  });
}

function addEditImages(fileList) {
  const { status, imagesInput } = editEls();
  if (editVideoState && editVideoState.kind !== "removed") {
    setMediaStatus(status, "A post can't have both images and a video — remove the video first.", "error");
    return;
  }
  const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  const room = MAX_IMAGES_PER_POST - editImageItems.length;
  if (room <= 0) {
    setMediaStatus(status, `You can attach up to ${MAX_IMAGES_PER_POST} photos per post.`, "error");
    if (imagesInput) imagesInput.value = "";
    return;
  }
  const toAdd = files.slice(0, room);
  if (files.length > toAdd.length) {
    setMediaStatus(status, `Only added ${toAdd.length} — a post can have up to ${MAX_IMAGES_PER_POST} photos.`, "error");
  } else {
    setMediaStatus(status, "", "");
  }
  toAdd.forEach((file) => {
    editImageItems.push({ id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind: "new", file, previewUrl: URL.createObjectURL(file) });
  });
  renderEditImagePreviews();
  if (imagesInput) imagesInput.value = "";
}

async function setEditVideo(file) {
  const { status, videoInput } = editEls();
  if (!file) return;
  if (editImageItems.length) {
    setMediaStatus(status, "A post can't have both images and a video — remove the photos first.", "error");
    if (videoInput) videoInput.value = "";
    return;
  }
  setMediaStatus(status, "Checking video…", "");
  try {
    await validateVideoFile(file);
    editVideoState = { kind: "new", file, previewUrl: URL.createObjectURL(file) };
    renderEditVideoPreview();
    setMediaStatus(status, "Video ready — it'll replace the current video when you save.", "success");
  } catch (err) {
    if (videoInput) videoInput.value = "";
    setMediaStatus(status, err?.message || "Couldn't use that video.", "error");
  }
}

wireMediaDropzone({
  ...editEls(),
  onImages: addEditImages,
  onVideo: setEditVideo,
});

document.getElementById("edit-post-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (editUploading || !editingPostId) return;
  const { titleInput, bodyInput, status, saveBtn, progressWrap, progressFill, progressPct } = editEls();
  const postId = editingPostId;

  const showProgress = (pct) => {
    if (progressWrap) progressWrap.style.display = "flex";
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressPct) progressPct.textContent = `${pct}%`;
  };
  const hideProgress = () => {
    if (progressWrap) progressWrap.style.display = "none";
    if (progressFill) progressFill.style.width = "0%";
  };

  editUploading = true;
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
  }

  const urlsToDelete = [];

  try {
    const bodyVal = (bodyInput?.value || "").trim();
    const mentionedNow = findMentionedLeaders(bodyVal, LEADERS).map((l) => ({ id: l.id, name: l.name }));
    const update = {
      title: (titleInput?.value || "").trim(),
      body: bodyVal,
      mentions: mentionedNow.length ? mentionedNow : deleteField(),
    };

    // Upload any newly-added images, in their current display order.
    if (editImageItems.length) {
      const finalUrls = [];
      const newCount = editImageItems.filter((it) => it.kind === "new").length;
      let uploadedSoFar = 0;
      for (const item of editImageItems) {
        if (item.kind === "existing") {
          finalUrls.push(item.url);
        } else {
          setMediaStatus(status, `Uploading photo ${uploadedSoFar + 1} of ${newCount}…`, "");
          const blob = await compressImageFile(item.file);
          const path = postMediaPath(currentUser.uid, postId, "img", finalUrls.length, "jpg");
          const url = await uploadFileWithProgress(path, blob, (pct) => {
            showProgress(Math.round(((uploadedSoFar + pct / 100) / newCount) * 100));
          });
          finalUrls.push(url);
          uploadedSoFar++;
        }
      }
      update.images = finalUrls;
      update.imageUrl = deleteField();
      update.video = deleteField();
    } else {
      update.images = deleteField();
      update.imageUrl = deleteField();
    }

    if (editVideoState?.kind === "new") {
      setMediaStatus(status, "Uploading video…", "");
      showProgress(0);
      const ext = (editVideoState.file.name.split(".").pop() || "mp4").toLowerCase();
      const path = postMediaPath(currentUser.uid, postId, "video", 0, ext);
      const url = await uploadFileWithProgress(path, editVideoState.file, showProgress);
      update.video = url;
      update.images = deleteField();
      update.imageUrl = deleteField();
      // Fetch the pre-edit doc's video URL for cleanup below.
      const snap = await getDoc(doc(db, "announcements", postId));
      const prevVideo = snap.exists() ? snap.data().video : null;
      if (prevVideo) urlsToDelete.push(prevVideo);
    } else if (editVideoState?.kind === "removed" && editVideoState.url) {
      update.video = deleteField();
      urlsToDelete.push(editVideoState.url);
    } else if (!editImageItems.length && !editVideoState) {
      update.video = deleteField();
    }

    // Any existing image that was removed in this edit gets cleaned up too.
    urlsToDelete.push(...editRemovedImageUrls);

    await updateDoc(doc(db, "announcements", postId), update);

    // Clean up removed/replaced media in Storage (best-effort).
    await Promise.all(urlsToDelete.map((url) => deleteFileByURL(url)));

    hideProgress();
    setMediaStatus(status, "", "");
    closeEditPostModal();
  } catch (err) {
    console.error(err);
    setMediaStatus(status, err?.message || "Couldn't save changes. Please try again.", "error");
    hideProgress();
  } finally {
    editUploading = false;
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Changes";
    }
  }
});

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
