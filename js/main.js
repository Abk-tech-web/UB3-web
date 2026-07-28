// ============================================================================
// UB3 — main.js
// Handles: navbar state, mobile menu, theme toggle, hero node-network canvas,
// scroll-reveal, animated stat counters, dynamic leadership grid + profile
// modal, FAQ accordion, partner marquee, and the visitor contact form
// (writes to Firestore `messages` collection).
// ============================================================================

import { db, auth } from "./firebase.js";
import {
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
  query,
  orderBy,
  limit,
  onSnapshot,
  where,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  increment,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  signInAnonymously,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { LEADERS, initials } from "./leaders-data.js";
import { ICONS } from "./icons.js";
import {
  verifiedMentionCandidates,
  findMentionedLeaders as findMentionedLeadersIn,
  renderMentions as renderMentionsIn,
} from "./mentions.js";

// Thin wrappers so the rest of this file can keep calling
// findMentionedLeaders(text) / renderMentions(escapedText, mentions) without
// threading LEADERS through every call site.
function findMentionedLeaders(text) {
  return findMentionedLeadersIn(text, LEADERS);
}
function renderMentions(escapedText, mentions) {
  return renderMentionsIn(escapedText, mentions, LEADERS);
}

/* ---------------------------------------------------------------------- */
/* Live leader accounts                                                    */
/* Each entry in LEADERS (leaders-data.js) reserves ONE position slot on   */
/* the team. When someone creates a portal account with a matching         */
/* position, their real profile (photo, bio, socials, and Firebase Auth    */
/* uid) is overlaid onto that slot here — so the public site automatically */
/* reflects whoever currently holds that position, and messages route to  */
/* their real account instead of a static placeholder id.                  */
/* ---------------------------------------------------------------------- */
function normalizePosition(pos) {
  return (pos || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function loadLiveLeaders() {
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
      slot.createdAt = live.createdAt || null;
      if (live.name) slot.name = live.name;
      if (live.photoURL) slot.photo = live.photoURL;
      if (live.bio) slot.bio = live.bio;
      if (live.email) slot.email = live.email;
      if (live.socials?.x) slot.socials = { ...slot.socials, x: live.socials.x };
      if (live.socials?.telegram) slot.socials = { ...slot.socials, telegram: live.socials.telegram };
    });
  } catch (err) {
    // If this fails (offline, rules issue, etc.) the public site still
    // works fine with the static roster — it just won't reflect live
    // profile edits until the next successful load.
    console.warn("Could not load live leader profiles:", err);
  }
}

const liveLeadersReady = loadLiveLeaders();

/* ---------------------------------------------------------------------- */
/* Theme                                                                   */
/* ---------------------------------------------------------------------- */
const root = document.documentElement;
const savedTheme = localStorage.getItem("ub3-theme") || "dark";
root.setAttribute("data-theme", savedTheme);

document.getElementById("theme-toggle")?.addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  localStorage.setItem("ub3-theme", next);
});

/* ---------------------------------------------------------------------- */
/* Navbar + mobile menu                                                    */
/* ---------------------------------------------------------------------- */
const navbar = document.getElementById("navbar");
const navToggle = document.getElementById("nav-toggle");
const navLinks = document.getElementById("nav-links");

window.addEventListener("scroll", () => {
  navbar.classList.toggle("scrolled", window.scrollY > 12);
});

navToggle?.addEventListener("click", () => {
  navToggle.classList.toggle("open");
  navLinks.classList.toggle("open");
});

navLinks?.querySelectorAll("a").forEach((a) =>
  a.addEventListener("click", () => {
    navToggle?.classList.remove("open");
    navLinks.classList.remove("open");
  })
);

/* ---------------------------------------------------------------------- */
/* Hero node-network canvas (signature element)                            */
/* ---------------------------------------------------------------------- */
const canvas = document.getElementById("hero-network");
if (canvas) {
  const ctx = canvas.getContext("2d");
  let w, h, nodes;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mouse = { x: -9999, y: -9999 };

  function resize() {
    w = canvas.width = canvas.offsetWidth * devicePixelRatio;
    h = canvas.height = canvas.offsetHeight * devicePixelRatio;
    const count = Math.min(70, Math.floor((canvas.offsetWidth * canvas.offsetHeight) / 16000));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.25 * devicePixelRatio,
      vy: (Math.random() - 0.5) * 0.25 * devicePixelRatio,
      r: (Math.random() * 1.4 + 0.8) * devicePixelRatio,
    }));
  }

  function step() {
    ctx.clearRect(0, 0, w, h);
    const linkDist = 140 * devicePixelRatio;

    for (const n of nodes) {
      if (!reduceMotion) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
      }
    }

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < linkDist) {
          ctx.strokeStyle = `rgba(56,189,248,${0.16 * (1 - d / linkDist)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    for (const n of nodes) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(199,205,214,0.55)";
      ctx.fill();
    }

    requestAnimationFrame(step);
  }

  resize();
  window.addEventListener("resize", resize);
  step();
}

/* ---------------------------------------------------------------------- */
/* Scroll reveal                                                           */
/* ---------------------------------------------------------------------- */
const revealEls = document.querySelectorAll(".reveal");
const io = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add("in-view");
        io.unobserve(e.target);
      }
    });
  },
  { threshold: 0.15 }
);
revealEls.forEach((el) => io.observe(el));

/* ---------------------------------------------------------------------- */
/* Animated stat counters                                                  */
/* ---------------------------------------------------------------------- */
document.querySelectorAll("[data-count]").forEach((el) => {
  const target = parseInt(el.dataset.count, 10);
  const suffix = el.dataset.suffix || "";
  let started = false;
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting && !started) {
        started = true;
        const duration = 1400;
        const start = performance.now();
        function tick(now) {
          const p = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - p, 3);
          el.textContent = Math.floor(eased * target) + suffix;
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        obs.disconnect();
      }
    });
  });
  obs.observe(el);
});

/* ---------------------------------------------------------------------- */
/* Leadership grid + profile modal                                         */
/* ---------------------------------------------------------------------- */
const leadersGrid = document.getElementById("leaders-grid");

// A leader's card gets a verified checkmark once a real portal account has
// claimed their position (i.e. main.js's live-data merge found a match —
// see slot.uid in loadLiveLeaders() above). The one reserved for
// "UNBOUND_DAO3" — UB3's official account — gets a gold badge instead of
// the usual blue one, matching X/Twitter's style for official orgs.
function verifiedBadge(leader) {
  if (!leader.uid) return "";
  const isOfficial = normalizePosition(leader.position) === normalizePosition("UNBOUND_DAO3");
  const fill = isOfficial ? "#f2b90c" : "#1d9bf0";
  const label = isOfficial ? "Official UB3 account" : "Verified leader account";
  const createdIso = leader.createdAt?.toDate ? leader.createdAt.toDate().toISOString() : "";
  return `<button type="button" class="badge-btn" data-badge-kind="verified" data-official="${isOfficial ? "1" : ""}" data-created="${createdIso}" aria-label="${label}"><svg class="verified-badge" viewBox="0 0 22 22" aria-hidden="true"><path fill="${fill}" d="M20.396 11c-.018-.646-.215-1.275-.57-1.816a3.4 3.4 0 0 0-1.5-1.3 3.6 3.6 0 0 0-.428-1.921 3.5 3.5 0 0 0-1.483-1.47 3.4 3.4 0 0 0-1.916-.435 3.6 3.6 0 0 0-1.279-1.482 3.5 3.5 0 0 0-1.94-.588c-.696 0-1.372.203-1.94.588a3.6 3.6 0 0 0-1.279 1.482 3.4 3.4 0 0 0-1.916.435 3.5 3.5 0 0 0-1.483 1.47 3.6 3.6 0 0 0-.428 1.921 3.4 3.4 0 0 0-1.5 1.3A3.6 3.6 0 0 0 1.164 11c.018.646.215 1.275.57 1.816a3.4 3.4 0 0 0 1.5 1.3 3.6 3.6 0 0 0 .428 1.921 3.5 3.5 0 0 0 1.483 1.47 3.4 3.4 0 0 0 1.916.435 3.6 3.6 0 0 0 1.279 1.482 3.5 3.5 0 0 0 1.94.588c.696 0 1.372-.203 1.94-.588a3.6 3.6 0 0 0 1.279-1.482 3.4 3.4 0 0 0 1.916-.435 3.5 3.5 0 0 0 1.483-1.47 3.6 3.6 0 0 0 .428-1.921 3.4 3.4 0 0 0 1.5-1.3c.355-.541.552-1.17.57-1.816Z"/><path fill="#fff" d="m9.653 14.487-3.28-3.28 1.084-1.084 2.196 2.196 4.688-4.688 1.084 1.084z"/></svg></button>`;
}

// A small "affiliated with UB3" badge (mirrors X's little org-logo badge
// shown next to affiliated accounts, e.g. next to @elonmusk's name it
// shows a small X logo). Shown for the 8 regular leader slots once
// claimed — not for the official UNBOUND_DAO3 account itself, since an
// org doesn't affiliate with itself.
function affiliateBadge(leader) {
  if (!leader.uid) return "";
  const isOfficial = normalizePosition(leader.position) === normalizePosition("UNBOUND_DAO3");
  if (isOfficial) return "";
  return `<button type="button" class="badge-btn affiliate-badge" data-badge-kind="affiliate" aria-label="Affiliated with UB3"><img src="assets/logo-nav.png" alt="UB3"></button>`;
}

/* ---------------------------------------------------------------------- */
/* Badge info popovers                                                     */
/* Tapping a verified or affiliate badge explains what it means, matching  */
/* the little info sheet X shows when you tap its own badges.              */
/* ---------------------------------------------------------------------- */
let badgeInfoOverlay = null;

function ensureBadgeInfoOverlay() {
  if (badgeInfoOverlay) return badgeInfoOverlay;
  badgeInfoOverlay = document.createElement("div");
  badgeInfoOverlay.className = "badge-info-overlay";
  badgeInfoOverlay.innerHTML = `
    <div class="badge-info-card" role="dialog" aria-modal="true">
      <button type="button" class="badge-info-close" aria-label="Close">${ICONS.close}</button>
      <div class="badge-info-row">
        <span class="badge-info-icon"></span>
        <p class="badge-info-text"></p>
      </div>
      <div class="badge-info-row badge-info-date" hidden>
        <span class="badge-info-icon badge-info-calendar">📅</span>
        <p class="badge-info-text badge-info-date-text"></p>
      </div>
    </div>`;
  document.body.appendChild(badgeInfoOverlay);
  badgeInfoOverlay.addEventListener("click", (e) => {
    if (e.target === badgeInfoOverlay) closeBadgeInfo();
  });
  badgeInfoOverlay.querySelector(".badge-info-close").addEventListener("click", closeBadgeInfo);
  return badgeInfoOverlay;
}

function closeBadgeInfo() {
  badgeInfoOverlay?.classList.remove("open");
}

function showBadgeInfo({ iconHtml, text, sinceText }) {
  const el = ensureBadgeInfoOverlay();
  el.querySelector(".badge-info-icon").innerHTML = iconHtml;
  el.querySelector(".badge-info-text").textContent = text;
  const dateRow = el.querySelector(".badge-info-date");
  if (sinceText) {
    dateRow.hidden = false;
    el.querySelector(".badge-info-date-text").textContent = sinceText;
  } else {
    dateRow.hidden = true;
  }
  el.classList.add("open");
}

const VERIFIED_ICON_BLUE = `<svg viewBox="0 0 22 22" aria-hidden="true"><path fill="#1d9bf0" d="M20.396 11c-.018-.646-.215-1.275-.57-1.816a3.4 3.4 0 0 0-1.5-1.3 3.6 3.6 0 0 0-.428-1.921 3.5 3.5 0 0 0-1.483-1.47 3.4 3.4 0 0 0-1.916-.435 3.6 3.6 0 0 0-1.279-1.482 3.5 3.5 0 0 0-1.94-.588c-.696 0-1.372.203-1.94.588a3.6 3.6 0 0 0-1.279 1.482 3.4 3.4 0 0 0-1.916.435 3.5 3.5 0 0 0-1.483 1.47 3.6 3.6 0 0 0-.428 1.921 3.4 3.4 0 0 0-1.5 1.3A3.6 3.6 0 0 0 1.164 11c.018.646.215 1.275.57 1.816a3.4 3.4 0 0 0 1.5 1.3 3.6 3.6 0 0 0 .428 1.921 3.5 3.5 0 0 0 1.483 1.47 3.4 3.4 0 0 0 1.916.435 3.6 3.6 0 0 0 1.279 1.482 3.5 3.5 0 0 0 1.94.588c.696 0 1.372-.203 1.94-.588a3.6 3.6 0 0 0 1.279-1.482 3.4 3.4 0 0 0 1.916-.435 3.5 3.5 0 0 0 1.483-1.47 3.6 3.6 0 0 0 .428-1.921 3.4 3.4 0 0 0 1.5-1.3c.355-.541.552-1.17.57-1.816Z"/><path fill="#fff" d="m9.653 14.487-3.28-3.28 1.084-1.084 2.196 2.196 4.688-4.688 1.084 1.084z"/></svg>`;
const VERIFIED_ICON_GOLD = VERIFIED_ICON_BLUE.replace("#1d9bf0", "#f2b90c");

function formatVerifiedSince(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `Verified since ${d.toLocaleDateString(undefined, { month: "long", year: "numeric" })}.`;
}

document.addEventListener("click", (e) => {
  const badgeBtn = e.target.closest("[data-badge-kind]");
  if (!badgeBtn) return;
  e.preventDefault();
  e.stopPropagation();

  if (badgeBtn.dataset.badgeKind === "verified") {
    const isOfficial = badgeBtn.dataset.official === "1";
    if (isOfficial) {
      showBadgeInfo({
        iconHtml: VERIFIED_ICON_GOLD,
        text: "This account is verified because it's an official organisation on UB3.",
        sinceText: formatVerifiedSince(badgeBtn.dataset.created),
      });
    } else {
      showBadgeInfo({
        iconHtml: VERIFIED_ICON_BLUE,
        text: "This account is verified because it's an affiliate with UB3.",
        sinceText: formatVerifiedSince(badgeBtn.dataset.created),
      });
    }
  } else if (badgeBtn.dataset.badgeKind === "affiliate") {
    showBadgeInfo({
      iconHtml: `<img src="assets/logo-nav.png" alt="UB3" style="width:100%;height:100%;object-fit:contain;">`,
      text: "This account is affiliated with UB3.",
    });
  }
});

function socialLinks(leader) {
  const items = [];
  if (leader.socials?.x) items.push(`<a href="${leader.socials.x}" target="_blank" rel="noopener" aria-label="${leader.name} on X">${ICONS.x}</a>`);
  if (leader.socials?.telegram) items.push(`<a href="${leader.socials.telegram}" target="_blank" rel="noopener" aria-label="${leader.name} on Telegram">${ICONS.telegram}</a>`);
  if (leader.email) items.push(`<a href="mailto:${leader.email}" aria-label="Email ${leader.name}">${ICONS.email}</a>`);
  return items.join("");
}

async function renderLeadersGrid() {
  if (!leadersGrid) return;
  await liveLeadersReady;

  leadersGrid.innerHTML = LEADERS.map(
    (l, idx) => `
    <article class="leader-card glass reveal" style="transition-delay:${idx * 0.05}s">
      <div class="leader-photo">
        ${l.photo ? `<img src="${l.photo}" alt="${l.name}" loading="lazy">` : initials(l.name)}
      </div>
      <div class="leader-body">
        <h3>${l.name}${verifiedBadge(l)}${affiliateBadge(l)}</h3>
        <div class="l-role">${l.position}</div>
        <div class="l-dept">${l.department}</div>
        <p class="l-bio">${l.bio}</p>
        <div class="leader-actions">
          <div class="l-socials">${socialLinks(l)}</div>
          <button class="btn btn-ghost btn-sm" data-open-profile="${l.id}">View Profile</button>
        </div>
      </div>
    </article>`
  ).join("");

  leadersGrid.querySelectorAll("[data-open-profile]").forEach((btn) =>
    btn.addEventListener("click", () => openLeaderModal(btn.dataset.openProfile))
  );

  // re-observe newly injected reveal cards
  leadersGrid.querySelectorAll(".reveal").forEach((el) => io.observe(el));
}

renderLeadersGrid();

const modalOverlay = document.getElementById("leader-modal");
const modalContent = document.getElementById("leader-modal-content");

function openLeaderModal(id) {
  const leader = LEADERS.find((l) => l.id === id);
  if (!leader || !modalOverlay) return;

  modalContent.innerHTML = `
    <button class="modal-close" data-close-modal aria-label="Close profile">${ICONS.close}</button>
    <div class="modal-head">
      <div class="leader-photo">${leader.photo ? `<img src="${leader.photo}" alt="${leader.name}">` : initials(leader.name)}</div>
      <div>
        <h3>${leader.name}${verifiedBadge(leader)}${affiliateBadge(leader)}</h3>
        <div class="l-role">${leader.position}</div>
        <div class="l-dept">${leader.department}</div>
      </div>
    </div>
    <div class="modal-body">
      <p class="l-bio">${leader.bio}</p>
      <div class="l-socials" style="margin-bottom:22px;">${socialLinks(leader)}</div>
      <form id="leader-message-form" data-leader-id="${leader.uid || leader.id}" data-leader-name="${leader.name}">
        <div class="field"><label>Your name</label><input type="text" name="name" required></div>
        <div class="field"><label>Your email</label><input type="email" name="email" required></div>
        <div class="field"><label>Message</label><textarea name="message" rows="4" required></textarea></div>
        <button type="submit" class="btn btn-primary btn-block">Send Message</button>
        <p class="form-status" id="leader-message-status"></p>
      </form>
    </div>
  `;

  modalOverlay.classList.add("open");
  modalContent.querySelector("[data-close-modal]").addEventListener("click", () => closeLeaderModal());
  modalContent.querySelector("#leader-message-form").addEventListener("submit", handleLeaderMessage);

  // Push a history entry so the phone/browser back button closes the modal
  // instead of navigating away from the page.
  if (!(history.state && history.state.ub3Modal)) {
    history.pushState({ ub3Modal: true }, "");
  }
}

function closeLeaderModal(fromPopState) {
  if (!modalOverlay || !modalOverlay.classList.contains("open")) return;
  modalOverlay.classList.remove("open");
  // If we're closing via the X button / backdrop / Escape (not via the back
  // button itself), unwind the history entry we pushed on open so back
  // behaves normally afterwards.
  if (!fromPopState && history.state && history.state.ub3Modal) {
    history.back();
  }
}

window.addEventListener("popstate", () => {
  closeLeaderModal(true);
});

modalOverlay?.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeLeaderModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLeaderModal();
});

/* -- announcement media gallery — tap a photo to view it full-size, ---- */
/*    with next/prev, swipe, and zoom, matching X's image viewer -------- */
const imgLightbox = document.getElementById("img-lightbox");
const imgLightboxImg = document.getElementById("img-lightbox-img");
const imgLightboxPrev = document.getElementById("img-lightbox-prev");
const imgLightboxNext = document.getElementById("img-lightbox-next");
const imgLightboxCounter = document.getElementById("img-lightbox-counter");

let lightboxImages = [];
let lightboxIndex = 0;
let lightboxZoomed = false;

function renderLightboxImage() {
  if (!imgLightboxImg) return;
  imgLightboxImg.src = lightboxImages[lightboxIndex] || "";
  lightboxZoomed = false;
  imgLightboxImg.classList.remove("zoomed");
  imgLightboxImg.style.transform = "";
  const multi = lightboxImages.length > 1;
  if (imgLightboxPrev) imgLightboxPrev.style.display = multi ? "flex" : "none";
  if (imgLightboxNext) imgLightboxNext.style.display = multi ? "flex" : "none";
  if (imgLightboxCounter) {
    imgLightboxCounter.style.display = multi ? "block" : "none";
    imgLightboxCounter.textContent = multi ? `${lightboxIndex + 1} / ${lightboxImages.length}` : "";
  }
}

function openImgLightbox(images, startIndex = 0) {
  if (!imgLightbox || !imgLightboxImg) return;
  lightboxImages = Array.isArray(images) ? images : [images];
  lightboxIndex = Math.max(0, Math.min(startIndex, lightboxImages.length - 1));
  renderLightboxImage();
  imgLightbox.classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeImgLightbox() {
  if (!imgLightbox) return;
  imgLightbox.classList.remove("open");
  imgLightboxImg.src = "";
  lightboxImages = [];
  document.body.style.overflow = "";
}
function lightboxShowPrev() {
  if (lightboxImages.length < 2) return;
  lightboxIndex = (lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length;
  renderLightboxImage();
}
function lightboxShowNext() {
  if (lightboxImages.length < 2) return;
  lightboxIndex = (lightboxIndex + 1) % lightboxImages.length;
  renderLightboxImage();
}

document.getElementById("announcements-list")?.addEventListener("click", (e) => {
  const photo = e.target.closest(".gallery-img[data-ann-id]");
  if (!photo) return;
  const annId = photo.getAttribute("data-ann-id");
  const idx = Number(photo.getAttribute("data-idx") || 0);
  const images = galleryImagesByAnnId.get(annId) || [photo.src];
  openImgLightbox(images, idx);
});
imgLightbox?.addEventListener("click", (e) => {
  if (e.target === imgLightbox) closeImgLightbox();
});
document.getElementById("img-lightbox-close")?.addEventListener("click", closeImgLightbox);
imgLightboxPrev?.addEventListener("click", (e) => {
  e.stopPropagation();
  lightboxShowPrev();
});
imgLightboxNext?.addEventListener("click", (e) => {
  e.stopPropagation();
  lightboxShowNext();
});
document.addEventListener("keydown", (e) => {
  if (!imgLightbox?.classList.contains("open")) return;
  if (e.key === "Escape") closeImgLightbox();
  if (e.key === "ArrowLeft") lightboxShowPrev();
  if (e.key === "ArrowRight") lightboxShowNext();
});

// Double-click / double-tap to toggle a simple zoom.
imgLightboxImg?.addEventListener("dblclick", () => {
  lightboxZoomed = !lightboxZoomed;
  imgLightboxImg.classList.toggle("zoomed", lightboxZoomed);
  imgLightboxImg.style.transform = lightboxZoomed ? "scale(2)" : "";
});

// Touch swipe (left/right to navigate when not zoomed, drag to pan when
// zoomed) — a lightweight alternative to a full gesture library.
let lbTouchStartX = 0;
let lbTouchStartY = 0;
imgLightbox?.addEventListener(
  "touchstart",
  (e) => {
    if (e.touches.length !== 1) return;
    lbTouchStartX = e.touches[0].clientX;
    lbTouchStartY = e.touches[0].clientY;
  },
  { passive: true }
);
imgLightbox?.addEventListener(
  "touchend",
  (e) => {
    if (lightboxZoomed) return;
    const dx = e.changedTouches[0].clientX - lbTouchStartX;
    const dy = e.changedTouches[0].clientY - lbTouchStartY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) lightboxShowPrev();
      else lightboxShowNext();
    }
  },
  { passive: true }
);

// Announcement id -> ordered array of image URLs, used to feed the gallery
// viewer with the full set (not just the one image that was clicked).
const galleryImagesByAnnId = new Map();

async function handleLeaderMessage(e) {
  e.preventDefault();
  const form = e.target;
  const status = form.querySelector("#leader-message-status");
  const btn = form.querySelector("button[type=submit]");
  const data = new FormData(form);

  btn.disabled = true;
  btn.textContent = "Sending…";

  try {
    await addDoc(collection(db, "messages"), {
      toLeaderId: form.dataset.leaderId,
      toLeaderName: form.dataset.leaderName,
      fromName: data.get("name"),
      fromEmail: data.get("email"),
      body: data.get("message"),
      read: false,
      createdAt: serverTimestamp(),
    });
    status.textContent = "Message sent — thank you! The leader will get back to you soon.";
    status.className = "form-status success";
    form.reset();
  } catch (err) {
    status.textContent = "Couldn't send your message. Please try again shortly.";
    status.className = "form-status error";
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Send Message";
  }
}

/* ---------------------------------------------------------------------- */
/* FAQ accordion                                                           */
/* ---------------------------------------------------------------------- */
document.querySelectorAll(".faq-item").forEach((item) => {
  const q = item.querySelector(".faq-q");
  const a = item.querySelector(".faq-a");
  q.addEventListener("click", () => {
    const isOpen = item.classList.contains("open");
    document.querySelectorAll(".faq-item.open").forEach((el) => {
      el.classList.remove("open");
      el.querySelector(".faq-a").style.maxHeight = null;
    });
    if (!isOpen) {
      item.classList.add("open");
      a.style.maxHeight = a.scrollHeight + "px";
    }
  });
});

/* ---------------------------------------------------------------------- */
/* Contact form (general inbox — not tied to a specific leader)            */
/* ---------------------------------------------------------------------- */
const contactForm = document.getElementById("contact-form");
contactForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("contact-status");
  const btn = contactForm.querySelector("button[type=submit]");
  const data = new FormData(contactForm);

  btn.disabled = true;
  btn.textContent = "Sending…";

  try {
    await addDoc(collection(db, "messages"), {
      toLeaderId: "general",
      toLeaderName: "General Inbox",
      fromName: data.get("name"),
      fromEmail: data.get("email"),
      subject: data.get("subject"),
      body: data.get("message"),
      read: false,
      createdAt: serverTimestamp(),
    });
    status.textContent = "Message sent — we'll be in touch soon.";
    status.className = "form-status success";
    contactForm.reset();
  } catch (err) {
    status.textContent = "Something went wrong. Please try again.";
    status.className = "form-status error";
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Send Message";
  }
});

/* ---------------------------------------------------------------------- */
/* Footer year                                                             */
/* ---------------------------------------------------------------------- */
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

/* ---------------------------------------------------------------------- */
/* Visitor identity for comments (Firebase Auth)                           */
/* Every visitor gets a lightweight anonymous session on load — that's     */
/* enough to like posts/comments (no name attached, nothing to spoof).     */
/* Commenting, though, requires signing in for real: with Google, or by    */
/* already being logged into a leader's dashboard account on this browser. */
/* That's what lets a comment safely show a real name instead of a         */
/* free-typed one anybody could fake. Requires the "Anonymous" AND         */
/* "Google" sign-in providers enabled in Firebase Console > Authentication,*/
/* and this site's domain added under Authentication > Settings >          */
/* Authorized domains (needed for the Google sign-in popup to work).       */
/* ---------------------------------------------------------------------- */
let visitorUid = null;
let visitorIsAnonymous = true;
let visitorDisplayName = "";
let visitorPhotoURL = "";
let authResolve;
const authReady = new Promise((resolve) => {
  authResolve = resolve;
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    visitorUid = user.uid;
    visitorIsAnonymous = user.isAnonymous;
    visitorDisplayName = user.displayName || "";
    visitorPhotoURL = user.photoURL || "";
    authResolve(user.uid);
    refreshCommentAuthUI();
  } else {
    signInAnonymously(auth).catch((err) => {
      console.error("Anonymous sign-in failed (enable it in Firebase Console > Authentication > Sign-in method):", err);
      authResolve(null);
    });
  }
});

async function googleSignIn() {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) {
    console.error("Google sign-in failed:", err);
    alert("Couldn't sign in with Google. Please try again.");
  }
}

async function commentSignOut() {
  try {
    await signOut(auth);
    // onAuthStateChanged fires with user === null next, which re-signs
    // back into a fresh anonymous session automatically.
  } catch (err) {
    console.error("Sign out failed:", err);
  }
}

// The little "sign in to comment" / "commenting as X" block shown at the
// top of every comment box. Re-rendered into every currently-open form
// whenever the sign-in state changes (see refreshCommentAuthUI below), so
// a visitor who signs in partway through never has to reopen the box.
function commentAuthStatusHtml() {
  if (visitorIsAnonymous) {
    return `<button type="button" class="comment-google-btn js-google-signin">Sign in with Google to comment</button>`;
  }
  const leaderSlot = LEADERS.find((l) => l.uid && l.uid === visitorUid);
  const displayName = leaderSlot?.name || visitorDisplayName || "you";
  return `
    <div class="commenting-as">
      ${visitorPhotoURL ? `<img class="commenting-as-avatar" src="${visitorPhotoURL}" alt="">` : ""}
      <span>Commenting as <strong>${escapeHtml(displayName)}</strong></span>
      <button type="button" class="comment-signout-btn js-comment-signout">Not you?</button>
    </div>`;
}

// Called on every sign-in/sign-out — updates any comment forms already in
// the DOM in place, without needing a full feed re-render.
function refreshCommentAuthUI() {
  document.querySelectorAll(".js-comment-form").forEach((form) => {
    const statusEl = form.querySelector(".comment-auth-status");
    if (statusEl) statusEl.innerHTML = commentAuthStatusHtml();
    form.classList.toggle("signed-out", visitorIsAnonymous);
  });
}

document.addEventListener("click", (e) => {
  if (e.target.closest(".js-google-signin")) googleSignIn();
  if (e.target.closest(".js-comment-signout")) commentSignOut();
});

/* ---------------------------------------------------------------------- */
/* Announcements feed (public — reads the `announcements` collection)      */
/* Any of the 9 leader accounts (8 leads + the UB3 Official Account) can   */
/* publish a post from their dashboard; this renders them live on the      */
/* homepage, pinned posts first. Signed-out visitors can like and comment  */
/* on any post — no login required.                                       */
/* ---------------------------------------------------------------------- */
const announcementsList = document.getElementById("announcements-list");

function announcementAvatar(a) {
  return a.authorPhoto
    ? `<img src="${a.authorPhoto}" alt="${a.authorName || "UB3"}">`
    : initials(a.authorName || "UB3");
}

// Every post author is guaranteed to be one of the 9 leader accounts (only
// they can create announcements — enforced in firestore.rules). Rather than
// build a second badge design, this looks up the matching LEADERS slot (by
// uid) and reuses the SAME verifiedBadge()/affiliateBadge() functions and
// CSS classes as the leadership grid + profile modal — gold badge only for
// the UB3 Official Account, blue badge + UB3 logo for the other 8 — so the
// badges are pixel-identical everywhere they appear on the site.
function authorBadgeHtml(a) {
  const slot = LEADERS.find((l) => l.uid && l.uid === a.authorId);
  if (!slot) return "";
  return `${verifiedBadge(slot)}${affiliateBadge(slot)}`;
}

function timeAgo(date) {
  if (!date) return "";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  const units = [
    ["year", 31536000], ["month", 2592000], ["week", 604800],
    ["day", 86400], ["hour", 3600], ["minute", 60],
  ];
  for (const [name, secs] of units) {
    const val = Math.floor(seconds / secs);
    if (val >= 1) return `${val} ${name}${val > 1 ? "s" : ""} ago`;
  }
  return "Just now";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

/* -- anonymous visitor identity (device-scoped, no login) ---------------- */
function getDeviceId() {
  let id = localStorage.getItem("ub3_device_id");
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("ub3_device_id", id);
  }
  return id;
}

// A visitor's reaction on a post is now Facebook-style: exactly one type
// at a time (love/fire/clap/laugh/angry), stored under one key instead of
// the old separate "liked posts" set + "my reactions" map. This migrates
// anyone's existing data once so their prior likes/reactions aren't lost.
function getMyReaction(annId) {
  try {
    return (JSON.parse(localStorage.getItem("ub3_my_reaction") || "{}"))[annId] || null;
  } catch {
    return null;
  }
}

function setMyReactionLocal(annId, type) {
  let map = {};
  try {
    map = JSON.parse(localStorage.getItem("ub3_my_reaction") || "{}");
  } catch {
    map = {};
  }
  if (type) map[annId] = type;
  else delete map[annId];
  localStorage.setItem("ub3_my_reaction", JSON.stringify(map));
}

(function migrateLegacyReactions() {
  if (localStorage.getItem("ub3_my_reaction_migrated")) return;
  const unified = {};
  try {
    JSON.parse(localStorage.getItem("ub3_liked_posts") || "[]").forEach((id) => {
      unified[id] = "love";
    });
  } catch {
    /* ignore */
  }
  try {
    const legacy = JSON.parse(localStorage.getItem("ub3_my_reactions") || "{}");
    Object.entries(legacy).forEach(([id, types]) => {
      if (!unified[id] && Array.isArray(types) && types.length) unified[id] = types[0];
    });
  } catch {
    /* ignore */
  }
  localStorage.setItem("ub3_my_reaction", JSON.stringify(unified));
  localStorage.setItem("ub3_my_reaction_migrated", "1");
})();

function getLikedComments() {
  try {
    return new Set(JSON.parse(localStorage.getItem("ub3_liked_comments") || "[]"));
  } catch {
    return new Set();
  }
}

function saveLikedComments(set) {
  localStorage.setItem("ub3_liked_comments", JSON.stringify([...set]));
}

// Announcement ids whose comment thread is currently expanded — preserved
// across re-renders so a visitor doesn't lose their open thread every time
// someone else likes/comments elsewhere in the feed.
const openCommentThreads = new Set();

// id -> { authorId, title } for every announcement currently rendered, kept
// up to date on every feed render. Lets a like/comment notification look up
// who to notify and what post it was about without an extra Firestore read.
const announcementMeta = new Map();

// Writes a notification for a leader as a side effect of a visitor action
// (like, comment, reply). Never notifies someone about their own action.
// Failures here are logged but never surfaced to the visitor — a
// notification not landing shouldn't block or error out their like/comment.
async function notifyLeader({ leaderId, type, actorName, body, announcementId, commentId }) {
  if (!leaderId) return;
  const uid = visitorUid || (await authReady);
  if (uid && uid === leaderId) return;
  try {
    await addDoc(collection(db, "notifications"), {
      leaderId,
      type,
      actorName: actorName || "Someone",
      body,
      announcementId: announcementId || null,
      commentId: commentId || null,
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("Notification failed (non-fatal):", err);
  }
}

function getVotedPolls() {
  try {
    return JSON.parse(localStorage.getItem("ub3_poll_votes") || "{}");
  } catch {
    return {};
  }
}

function saveVotedPolls(obj) {
  localStorage.setItem("ub3_poll_votes", JSON.stringify(obj));
}

// Bookmarks are saved locally to this browser only — no account needed,
// but that also means they won't follow a visitor to a different device.
function getBookmarks() {
  try {
    return new Set(JSON.parse(localStorage.getItem("ub3_bookmarks") || "[]"));
  } catch {
    return new Set();
  }
}

function saveBookmarks(set) {
  localStorage.setItem("ub3_bookmarks", JSON.stringify([...set]));
}

// Cached from the last successful feed read, and the currently-selected
// category pill — filtering by category re-renders from this cache
// instead of re-querying Firestore. A post's deep link (?post=<id>) only
// ever gets scrolled-to and highlighted once per page load.
let lastAnnouncementsSnap = null;
let activeCategoryFilter = "All";
let searchQuery = "";
let showBookmarkedOnly = false;
let deepLinkHandled = false;

// Real emoji for every type but "love" (which keeps using the heart
// SVG/outline, same as before) — shown in the long-press picker, Facebook
// style: exactly one of these is ever active per person per post.
const REACTION_TYPES = [
  { key: "love", emoji: "❤️" },
  { key: "like", emoji: "👍" },
  { key: "fire", emoji: "🔥" },
  { key: "clap", emoji: "👏" },
  { key: "laugh", emoji: "😂" },
  { key: "sad", emoji: "😔" },
  { key: "angry", emoji: "😡" },
];
const REACTION_EMOJI = { love: "❤️", like: "👍", fire: "🔥", clap: "👏", laugh: "😂", sad: "😔", angry: "😡" };
// Order the breakdown is checked in — doesn't affect which ones show, only
// tie-breaking when counts are equal.
const REACTION_ORDER = ["love", "like", "fire", "clap", "laugh", "sad", "angry"];

// Pulls the per-type counts (likeCount is "love", everything else lives in
// a.reactions) into one plain object so the rest of the code doesn't have
// to know about that historical split.
function reactionCounts(a) {
  return {
    love: Math.max(0, a?.likeCount || 0),
    like: Math.max(0, a?.reactions?.like || 0),
    fire: Math.max(0, a?.reactions?.fire || 0),
    clap: Math.max(0, a?.reactions?.clap || 0),
    laugh: Math.max(0, a?.reactions?.laugh || 0),
    sad: Math.max(0, a?.reactions?.sad || 0),
    angry: Math.max(0, a?.reactions?.angry || 0),
  };
}

// Facebook-style breakdown: every distinct reaction type that's actually
// been used shows its own icon (most-used first, stacked on top), instead
// of the old bug where the button only ever showed ONE icon — either the
// current visitor's own reaction, or a generic heart — even when several
// different reaction types had been left on the post. Returns null when
// nobody has reacted yet, so the caller can fall back to a plain heart.
function reactionBreakdownHtml(counts) {
  const top = REACTION_ORDER.map((key) => ({ key, count: counts[key] || 0 }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  if (!top.length) return null;
  return `<span class="reaction-stack">${top
    .map((r, i) => `<span class="reaction-stack-icon" style="z-index:${top.length - i}">${REACTION_EMOJI[r.key]}</span>`)
    .join("")}</span>`;
}

function reactionButtonHtml(a, id) {
  const current = getMyReaction(id);
  const counts = reactionCounts(a);
  const total = counts.love + counts.like + counts.fire + counts.clap + counts.laugh + counts.sad + counts.angry;
  const iconHtml = reactionBreakdownHtml(counts) || ICONS.heart;

  return `
    <button type="button" class="announcement-action-btn js-reaction-main${current ? " liked" : ""}" data-ann-id="${id}" data-counts='${JSON.stringify(counts)}' title="Tap to love — hold for more reactions">
      <span class="announcement-action-icon">${iconHtml}</span>
      <span class="js-reaction-total">${total}</span>
    </button>`;
}

function pollHtml(a, id) {
  if (!a.poll || !Array.isArray(a.poll.options)) return "";
  const votedPolls = getVotedPolls();
  const votedIndex = Object.prototype.hasOwnProperty.call(votedPolls, id) ? votedPolls[id] : null;
  const hasVoted = votedIndex !== null;
  const votes = a.poll.votes || [];
  const totalVotes = votes.reduce((sum, v) => sum + (v || 0), 0);

  const optionsHtml = a.poll.options
    .map((opt, i) => {
      if (hasVoted) {
        const count = votes[i] || 0;
        const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        const chosen = votedIndex === i;
        return `
          <div class="poll-option-result${chosen ? " chosen" : ""}">
            <div class="poll-option-bar" style="width:${pct}%"></div>
            <span class="poll-option-label">${chosen ? ICONS.check : ""}${escapeHtml(opt)}</span>
            <span class="poll-option-pct">${pct}%</span>
          </div>`;
      }
      if (visitorIsAnonymous) {
        return `<button type="button" class="poll-option-btn js-poll-signin" data-ann-id="${id}">${escapeHtml(opt)}</button>`;
      }
      return `<button type="button" class="poll-option-btn js-poll-vote" data-ann-id="${id}" data-option-index="${i}">${escapeHtml(opt)}</button>`;
    })
    .join("");

  return `
    <div class="announcement-poll">
      <div class="poll-question">${ICONS.poll}<span>${escapeHtml(a.poll.question)}</span></div>
      <div class="poll-options">${optionsHtml}</div>
      <div class="poll-meta">${totalVotes} vote${totalVotes === 1 ? "" : "s"}${visitorIsAnonymous && !hasVoted ? " · Sign in with Google to vote" : ""}</div>
    </div>`;
}

function handleDeepLink() {
  if (deepLinkHandled) return;
  const postId = new URLSearchParams(location.search).get("post");
  if (!postId) return;
  const card = announcementsList.querySelector(`.announcement-card[data-ann-id="${postId}"]`);
  if (!card) return;
  deepLinkHandled = true;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("highlight-flash");
  setTimeout(() => card.classList.remove("highlight-flash"), 2500);
}

function renderFilterPills() {
  const container = document.getElementById("announcement-filters");
  if (!container || !lastAnnouncementsSnap) return;
  const categories = new Set();
  lastAnnouncementsSnap.docs.forEach((d) => {
    const cat = d.data().category;
    if (cat) categories.add(cat);
  });
  const cats = categories.size > 0 ? ["All", ...Array.from(categories).sort()] : [];
  const pillsHtml = cats
    .map(
      (cat) =>
        `<button type="button" class="filter-pill${activeCategoryFilter === cat ? " active" : ""}" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`
    )
    .join("");
  const savedPillHtml = `<button type="button" class="filter-pill filter-pill-saved${showBookmarkedOnly ? " active" : ""}" id="filter-saved-toggle">${ICONS.bookmark} Saved</button>`;
  container.innerHTML = pillsHtml + savedPillHtml;
}

document.getElementById("announcement-filters")?.addEventListener("click", (e) => {
  const catBtn = e.target.closest(".filter-pill[data-cat]");
  if (catBtn) {
    activeCategoryFilter = catBtn.dataset.cat;
    renderFilterPills();
    renderAnnouncementsFeed();
    return;
  }
  if (e.target.closest("#filter-saved-toggle")) {
    showBookmarkedOnly = !showBookmarkedOnly;
    renderFilterPills();
    renderAnnouncementsFeed();
  }
});

document.getElementById("announcement-search")?.addEventListener("input", (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  renderAnnouncementsFeed();
});

const searchIconEl = document.querySelector(".announcement-search-icon");
if (searchIconEl) searchIconEl.innerHTML = ICONS.search;

// ----------------------------------------------------------------------
// Photo gallery — 1 image shown normally, 2 side by side, 3 in a grid,
// 4+ in a responsive grid with a "+X more" overlay on the last tile.
// Every tile opens the full gallery viewer via the click delegate above.
// ----------------------------------------------------------------------
function galleryHtml(images, annId) {
  const n = images.length;
  const tile = (src, idx, extraClass = "", overlay = "") => `
    <div class="gallery-tile ${extraClass}">
      <img class="gallery-img" src="${src}" data-ann-id="${annId}" data-idx="${idx}" alt="" loading="lazy">
      ${overlay}
    </div>`;

  if (n === 1) {
    return `<div class="announcement-gallery gallery-1">${tile(images[0], 0)}</div>`;
  }
  if (n === 2) {
    return `<div class="announcement-gallery gallery-2">${images.map((src, i) => tile(src, i)).join("")}</div>`;
  }
  if (n === 3) {
    return `<div class="announcement-gallery gallery-3">${images.map((src, i) => tile(src, i)).join("")}</div>`;
  }
  // 4 or more: show the first 4 tiles, with a "+X more" overlay on the 4th.
  const shown = images.slice(0, 4);
  const remaining = n - 4;
  return `<div class="announcement-gallery gallery-4plus">
    ${shown
      .map((src, i) => {
        const overlay = i === 3 && remaining > 0 ? `<div class="gallery-more-overlay">+${remaining} more</div>` : "";
        return tile(src, i, "", overlay);
      })
      .join("")}
  </div>`;
}

// ----------------------------------------------------------------------
// Custom video player — play/pause, progress bar (scrub), fullscreen,
// mute/volume, playback speed, and picture-in-picture where supported.
// Autoplays muted only while visible (wired up via IntersectionObserver
// in initVideoPlayers, called after every feed render).
// ----------------------------------------------------------------------
function videoPlayerHtml(videoUrl, annId) {
  return `
    <div class="ub3-video-player" data-ann-id="${annId}">
      <video class="ub3-video-el" src="${videoUrl}" playsinline muted loop preload="metadata"></video>
      <button type="button" class="ub3-video-bigplay" aria-label="Play video"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
      <div class="ub3-video-controls">
        <button type="button" class="ub3-video-btn ub3-video-play" aria-label="Play/Pause">
          <svg class="icon-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          <svg class="icon-pause" viewBox="0 0 24 24" fill="currentColor" style="display:none;"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>
        </button>
        <span class="ub3-video-time">0:00</span>
        <input type="range" class="ub3-video-seek" min="0" max="100" value="0" step="0.1" aria-label="Seek">
        <span class="ub3-video-duration">0:00</span>
        <button type="button" class="ub3-video-btn ub3-video-mute" aria-label="Mute/Unmute">
          <svg class="icon-vol-on" viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9H4z"/></svg>
          <svg class="icon-vol-off" viewBox="0 0 24 24" fill="currentColor" style="display:none;"><path d="M4 9v6h4l5 5V4L8 9H4zm12.7-3.3l-1.4 1.4L17.6 9.4l-2.3 2.3 1.4 1.4 2.3-2.3 2.3 2.3 1.4-1.4-2.3-2.3 2.3-2.3-1.4-1.4-2.3 2.3z"/></svg>
        </button>
        <input type="range" class="ub3-video-volume" min="0" max="1" step="0.05" value="1" aria-label="Volume">
        <div class="ub3-video-speed-wrap">
          <button type="button" class="ub3-video-btn ub3-video-speed" aria-label="Playback speed">1x</button>
          <div class="ub3-video-speed-menu">
            ${[0.5, 1, 1.25, 1.5, 2].map((s) => `<button type="button" class="ub3-video-speed-opt" data-speed="${s}">${s}x</button>`).join("")}
          </div>
        </div>
        <button type="button" class="ub3-video-btn ub3-video-pip" aria-label="Picture in picture">PiP</button>
        <button type="button" class="ub3-video-btn ub3-video-fullscreen" aria-label="Fullscreen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
        </button>
      </div>
    </div>`;
}

function formatVideoTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

let videoIO = null;
// Wires up every custom video player currently in the DOM: control bar
// behavior plus muted-autoplay-only-while-visible via IntersectionObserver.
// Safe to call repeatedly (each feed re-render replaces the DOM nodes).
function initVideoPlayers() {
  const players = document.querySelectorAll(".ub3-video-player");
  if (videoIO) videoIO.disconnect();
  videoIO = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const video = entry.target.querySelector(".ub3-video-el");
        if (!video) return;
        if (entry.isIntersecting && video.muted) {
          video.play().catch(() => {});
        } else if (!entry.isIntersecting) {
          video.pause();
        }
      });
    },
    { threshold: 0.5 }
  );

  players.forEach((player) => {
    const video = player.querySelector(".ub3-video-el");
    const bigPlay = player.querySelector(".ub3-video-bigplay");
    const playBtn = player.querySelector(".ub3-video-play");
    const iconPlay = player.querySelector(".icon-play");
    const iconPause = player.querySelector(".icon-pause");
    const seek = player.querySelector(".ub3-video-seek");
    const time = player.querySelector(".ub3-video-time");
    const duration = player.querySelector(".ub3-video-duration");
    const muteBtn = player.querySelector(".ub3-video-mute");
    const iconVolOn = player.querySelector(".icon-vol-on");
    const iconVolOff = player.querySelector(".icon-vol-off");
    const volume = player.querySelector(".ub3-video-volume");
    const speedBtn = player.querySelector(".ub3-video-speed");
    const speedMenu = player.querySelector(".ub3-video-speed-menu");
    const pipBtn = player.querySelector(".ub3-video-pip");
    const fsBtn = player.querySelector(".ub3-video-fullscreen");
    if (!video) return;

    const syncPlayIcon = () => {
      const playing = !video.paused && !video.ended;
      if (iconPlay) iconPlay.style.display = playing ? "none" : "";
      if (iconPause) iconPause.style.display = playing ? "" : "none";
      if (bigPlay) bigPlay.style.display = playing ? "none" : "flex";
    };
    const togglePlay = () => (video.paused ? video.play().catch(() => {}) : video.pause());
    playBtn?.addEventListener("click", togglePlay);
    bigPlay?.addEventListener("click", togglePlay);
    video.addEventListener("click", togglePlay);
    video.addEventListener("play", syncPlayIcon);
    video.addEventListener("pause", syncPlayIcon);
    syncPlayIcon();

    video.addEventListener("loadedmetadata", () => {
      if (duration) duration.textContent = formatVideoTime(video.duration);
    });
    video.addEventListener("timeupdate", () => {
      if (time) time.textContent = formatVideoTime(video.currentTime);
      if (seek && video.duration) seek.value = String((video.currentTime / video.duration) * 100);
    });
    seek?.addEventListener("input", () => {
      if (video.duration) video.currentTime = (Number(seek.value) / 100) * video.duration;
    });

    const syncMuteIcon = () => {
      const muted = video.muted || video.volume === 0;
      if (iconVolOn) iconVolOn.style.display = muted ? "none" : "";
      if (iconVolOff) iconVolOff.style.display = muted ? "" : "none";
    };
    muteBtn?.addEventListener("click", () => {
      video.muted = !video.muted;
      if (!video.muted && video.volume === 0) video.volume = 1;
      syncMuteIcon();
    });
    volume?.addEventListener("input", () => {
      video.volume = Number(volume.value);
      video.muted = video.volume === 0;
      syncMuteIcon();
    });
    syncMuteIcon();

    speedBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      speedMenu?.classList.toggle("open");
    });
    speedMenu?.querySelectorAll(".ub3-video-speed-opt").forEach((opt) => {
      opt.addEventListener("click", (e) => {
        e.stopPropagation();
        const rate = Number(opt.getAttribute("data-speed"));
        video.playbackRate = rate;
        if (speedBtn) speedBtn.textContent = `${rate}x`;
        speedMenu.classList.remove("open");
      });
    });

    pipBtn?.addEventListener("click", async () => {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (document.pictureInPictureEnabled) {
          await video.requestPictureInPicture();
        }
      } catch (err) {
        console.warn("Picture-in-picture unavailable:", err?.message || err);
      }
    });

    fsBtn?.addEventListener("click", () => {
      if (video.requestFullscreen) video.requestFullscreen();
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    });

    videoIO.observe(player);
  });

  document.addEventListener("click", () => {
    document.querySelectorAll(".ub3-video-speed-menu.open").forEach((m) => m.classList.remove("open"));
  });
}

// ----------------------------------------------------------------------
// Click-to-expand video viewer — YouTube/Instagram/X-style large overlay.
// Purely additive: does not alter videoPlayerHtml(), initVideoPlayers(),
// or any existing playback/upload/data logic. Adds a small always-visible
// expand button to every rendered player, and opens a fresh copy of the
// same custom player (same markup, same controls) inside a centered,
// fade + zoom overlay. Playback position, volume, mute, and speed are
// carried over in both directions so the feed video picks up exactly
// where the enlarged one left off, and the page never scrolls.
// ----------------------------------------------------------------------
function injectVideoExpandButtons() {
  document.getElementById("announcements-list")?.querySelectorAll(".ub3-video-player").forEach((player) => {
    if (player.querySelector(".ub3-video-expand")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ub3-video-expand";
    btn.setAttribute("aria-label", "Expand video");
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`;
    player.appendChild(btn);
  });
}

// Wires play/pause, seek, volume/mute, and speed controls for a single
// player element rendered inside the lightbox stage. Mirrors the behavior
// wired up in initVideoPlayers() for the feed copy, kept separate so the
// existing function above is never touched.
function wireLightboxVideoPlayer(player) {
  const video = player.querySelector(".ub3-video-el");
  if (!video) return null;
  const bigPlay = player.querySelector(".ub3-video-bigplay");
  const playBtn = player.querySelector(".ub3-video-play");
  const iconPlay = player.querySelector(".icon-play");
  const iconPause = player.querySelector(".icon-pause");
  const seek = player.querySelector(".ub3-video-seek");
  const time = player.querySelector(".ub3-video-time");
  const duration = player.querySelector(".ub3-video-duration");
  const muteBtn = player.querySelector(".ub3-video-mute");
  const iconVolOn = player.querySelector(".icon-vol-on");
  const iconVolOff = player.querySelector(".icon-vol-off");
  const volume = player.querySelector(".ub3-video-volume");
  const speedBtn = player.querySelector(".ub3-video-speed");
  const speedMenu = player.querySelector(".ub3-video-speed-menu");
  const pipBtn = player.querySelector(".ub3-video-pip");
  const fsBtn = player.querySelector(".ub3-video-fullscreen");

  const syncPlayIcon = () => {
    const playing = !video.paused && !video.ended;
    if (iconPlay) iconPlay.style.display = playing ? "none" : "";
    if (iconPause) iconPause.style.display = playing ? "" : "none";
    if (bigPlay) bigPlay.style.display = playing ? "none" : "flex";
  };
  const togglePlay = () => (video.paused ? video.play().catch(() => {}) : video.pause());
  playBtn?.addEventListener("click", togglePlay);
  bigPlay?.addEventListener("click", togglePlay);
  video.addEventListener("click", togglePlay);
  video.addEventListener("play", syncPlayIcon);
  video.addEventListener("pause", syncPlayIcon);
  syncPlayIcon();

  video.addEventListener("loadedmetadata", () => {
    if (duration) duration.textContent = formatVideoTime(video.duration);
  });
  video.addEventListener("timeupdate", () => {
    if (time) time.textContent = formatVideoTime(video.currentTime);
    if (seek && video.duration) seek.value = String((video.currentTime / video.duration) * 100);
  });
  seek?.addEventListener("input", () => {
    if (video.duration) video.currentTime = (Number(seek.value) / 100) * video.duration;
  });

  const syncMuteIcon = () => {
    const muted = video.muted || video.volume === 0;
    if (iconVolOn) iconVolOn.style.display = muted ? "none" : "";
    if (iconVolOff) iconVolOff.style.display = muted ? "" : "none";
  };
  muteBtn?.addEventListener("click", () => {
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = 1;
    syncMuteIcon();
  });
  volume?.addEventListener("input", () => {
    video.volume = Number(volume.value);
    video.muted = video.volume === 0;
    syncMuteIcon();
  });
  syncMuteIcon();

  speedBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    speedMenu?.classList.toggle("open");
  });
  speedMenu?.querySelectorAll(".ub3-video-speed-opt").forEach((opt) => {
    opt.addEventListener("click", (e) => {
      e.stopPropagation();
      const rate = Number(opt.getAttribute("data-speed"));
      video.playbackRate = rate;
      if (speedBtn) speedBtn.textContent = `${rate}x`;
      speedMenu.classList.remove("open");
    });
  });

  pipBtn?.addEventListener("click", async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.warn("Picture-in-picture unavailable:", err?.message || err);
    }
  });

  // Native fullscreen stays available here too (pre-existing behavior on
  // this control), but opening the lightbox itself never triggers it.
  fsBtn?.addEventListener("click", () => {
    if (video.requestFullscreen) video.requestFullscreen();
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  });

  return video;
}

const videoLightbox = document.getElementById("video-lightbox");
const videoLightboxStage = document.getElementById("video-lightbox-stage");

let vlbSourceVideo = null; // the feed <video> that was expanded, for state handoff back on close
let vlbWasPlaying = false;

function openVideoLightbox(sourceVideo) {
  if (!videoLightbox || !videoLightboxStage || !sourceVideo) return;
  const src = sourceVideo.currentSrc || sourceVideo.getAttribute("src");
  if (!src) return;

  videoLightboxStage.innerHTML = videoPlayerHtml(src, "lightbox");
  const player = videoLightboxStage.querySelector(".ub3-video-player");
  const video = player ? wireLightboxVideoPlayer(player) : null;
  if (!video) return;

  vlbSourceVideo = sourceVideo;
  vlbWasPlaying = !sourceVideo.paused && !sourceVideo.ended;
  sourceVideo.pause(); // avoid two copies of the same audio playing at once

  video.muted = sourceVideo.muted;
  video.volume = sourceVideo.volume;
  video.playbackRate = sourceVideo.playbackRate;

  const resume = () => {
    video.currentTime = sourceVideo.currentTime || 0;
    if (vlbWasPlaying) video.play().catch(() => {});
  };
  if (video.readyState >= 1) resume();
  else video.addEventListener("loadedmetadata", resume, { once: true });

  // Body scroll is locked (not scrolled to a new position), so the feed
  // is exactly where it was left the moment the overlay is closed.
  document.body.style.overflow = "hidden";
  videoLightbox.classList.add("open");
  requestAnimationFrame(() => videoLightbox.classList.add("visible"));
}

function closeVideoLightbox() {
  if (!videoLightbox || !videoLightbox.classList.contains("open")) return;
  const video = videoLightboxStage?.querySelector(".ub3-video-el");
  if (video && vlbSourceVideo) {
    vlbSourceVideo.currentTime = video.currentTime;
    vlbSourceVideo.muted = video.muted;
    vlbSourceVideo.volume = video.volume;
    vlbSourceVideo.playbackRate = video.playbackRate;
  }
  const resumeSource = vlbWasPlaying ? vlbSourceVideo : null;

  videoLightbox.classList.remove("visible");
  document.body.style.overflow = "";
  setTimeout(() => {
    videoLightbox.classList.remove("open");
    if (videoLightboxStage) videoLightboxStage.innerHTML = "";
    resumeSource?.play().catch(() => {});
  }, 220); // matches the CSS fade/zoom-out duration

  vlbSourceVideo = null;
  vlbWasPlaying = false;
}

document.getElementById("announcements-list")?.addEventListener("click", (e) => {
  const expandBtn = e.target.closest(".ub3-video-expand");
  if (!expandBtn) return;
  e.stopPropagation();
  const sourceVideo = expandBtn.closest(".ub3-video-player")?.querySelector(".ub3-video-el");
  if (sourceVideo) openVideoLightbox(sourceVideo);
});
videoLightbox?.addEventListener("click", (e) => {
  if (e.target === videoLightbox) closeVideoLightbox();
});
document.getElementById("video-lightbox-close")?.addEventListener("click", closeVideoLightbox);
document.addEventListener("keydown", (e) => {
  if (!videoLightbox?.classList.contains("open")) return;
  if (e.key === "Escape") closeVideoLightbox();
});

function renderAnnouncementsFeed() {
  if (!lastAnnouncementsSnap) return;

  const docs =
    activeCategoryFilter === "All"
      ? lastAnnouncementsSnap.docs
      : lastAnnouncementsSnap.docs.filter((d) => (d.data().category || "") === activeCategoryFilter);

  const bookmarks = getBookmarks();
  const filteredDocs = docs.filter((d) => {
    if (showBookmarkedOnly && !bookmarks.has(d.id)) return false;
    if (searchQuery) {
      const data = d.data();
      const haystack = `${data.title || ""} ${data.body || ""}`.toLowerCase();
      if (!haystack.includes(searchQuery)) return false;
    }
    return true;
  });

  if (filteredDocs.length === 0) {
    const reason = showBookmarkedOnly
      ? "You haven't saved any posts yet."
      : searchQuery
      ? `No posts match "${escapeHtml(searchQuery)}".`
      : `No "${escapeHtml(activeCategoryFilter)}" posts yet.`;
    announcementsList.innerHTML = `<div class="announcements-empty glass">${reason}</div>`;
    return;
  }

  const BODY_PREVIEW_LEN = 340;

  announcementsList.innerHTML = filteredDocs
    .map((docSnap, idx) => {
      const id = docSnap.id;
      const a = docSnap.data();
      announcementMeta.set(id, { authorId: a.authorId, title: a.title || "" });
      const time = a.createdAt?.toDate ? timeAgo(a.createdAt.toDate()) : "";
      const commentCount = Math.max(0, a.commentCount || 0);
      const bodyText = a.body || "";
      const needsTruncate = bodyText.length > BODY_PREVIEW_LEN;
      const commentsOpen = openCommentThreads.has(id);
      const bookmarked = bookmarks.has(id);

      // Every post author is one of the 9 leader accounts, but only shows
      // as clickable once their portal account has actually claimed the
      // slot (leaderSlot.uid) — same verified-only gate used for comments
      // and mentions everywhere else on the site.
      // Legacy posts only ever set imageUrl (one image); newer posts use
      // the images[] array. Normalize to one ordered list either way.
      const images = Array.isArray(a.images) && a.images.length ? a.images : a.imageUrl ? [a.imageUrl] : [];
      if (images.length) galleryImagesByAnnId.set(id, images);
      const mediaHtml = images.length ? galleryHtml(images, id) : a.video ? videoPlayerHtml(a.video, id) : "";

      const leaderSlot = LEADERS.find((l) => l.uid && l.uid === a.authorId);
      const avatarHtml = leaderSlot
        ? `<button type="button" class="announcement-avatar js-comment-leader-link" data-open-profile="${leaderSlot.id}" aria-label="View ${escapeHtml(leaderSlot.name)}'s profile">${announcementAvatar(a)}</button>`
        : `<div class="announcement-avatar">${announcementAvatar(a)}</div>`;
      const authorNameHtml = leaderSlot
        ? `<button type="button" class="announcement-name js-comment-leader-link" data-open-profile="${leaderSlot.id}" aria-label="View ${escapeHtml(leaderSlot.name)}'s profile">${escapeHtml(a.authorName || "UB3")}</button>`
        : `<span class="announcement-name">${escapeHtml(a.authorName || "UB3")}</span>`;

      return `
        <article class="announcement-card glass reveal${a.pinned ? " pinned" : ""}" data-ann-id="${id}" style="transition-delay:${Math.min(idx, 6) * 0.04}s">
          <div class="announcement-top">
            ${avatarHtml}
            <div class="announcement-who">
              <div class="announcement-name-row">
                ${authorNameHtml}
                ${authorBadgeHtml(a)}
              </div>
              ${a.authorPosition ? `
              <div class="announcement-role-row">
                <span class="announcement-role-badge">${escapeHtml(a.authorPosition)}</span>
              </div>` : ""}
              <div class="announcement-submeta">
                <span class="announcement-meta-posted">Posted in Announcements</span>
                <span class="announcement-meta-dot">•</span>
                <span class="announcement-meta-time">${time}</span>
              </div>
              ${a.pinned || a.category ? `
              <div class="announcement-top-badges">
                ${a.pinned ? `<span class="announcement-pin-badge">${ICONS.pin}Pinned</span>` : ""}
                ${a.category ? `<span class="announcement-tag">${escapeHtml(a.category)}</span>` : ""}
              </div>` : ""}
            </div>
          </div>

          <h3 class="announcement-title">${escapeHtml(a.title)}</h3>
          <p class="announcement-body${needsTruncate ? " clamped js-ann-body" : ""}">${renderMentions(escapeHtml(bodyText), a.mentions)}</p>
          ${needsTruncate ? `<button type="button" class="announcement-see-more js-see-more">See more</button>` : ""}
          ${mediaHtml}
          ${pollHtml(a, id)}

          <div class="announcement-actions">
            ${reactionButtonHtml(a, id)}
            <button type="button" class="announcement-action-btn js-comment-toggle${commentsOpen ? " comments-open" : ""}" data-ann-id="${id}">
              <span class="announcement-action-icon">${ICONS.comment}</span>
              <span class="js-comment-count">${commentCount}</span>
            </button>
            <button type="button" class="announcement-action-btn js-share-btn" data-ann-id="${id}">
              <span class="announcement-action-icon">${ICONS.share}</span>
            </button>
            <button type="button" class="announcement-action-btn announcement-bookmark-btn js-bookmark-btn${bookmarked ? " active" : ""}" data-ann-id="${id}" title="${bookmarked ? "Remove bookmark" : "Save for later"}">
              <span class="announcement-action-icon">${bookmarked ? ICONS.bookmarkFilled : ICONS.bookmark}</span>
            </button>
          </div>

          <div class="announcement-comments${commentsOpen ? " open" : ""}" data-ann-id="${id}">
            <form class="comment-form js-comment-form${visitorIsAnonymous ? " signed-out" : ""}" data-ann-id="${id}">
              <div class="comment-auth-status">${commentAuthStatusHtml()}</div>
              <textarea name="body" rows="2" maxlength="1000" placeholder="Write a comment…" required></textarea>
              <button type="submit" class="comment-form-submit">${ICONS.send} Post</button>
              <p class="comment-form-status"></p>
            </form>
            <div class="comment-list js-comment-list"><div class="comment-empty">Loading comments…</div></div>
          </div>
        </article>`;
    })
    .join("");

  announcementsList.querySelectorAll(".reveal").forEach((el) => io.observe(el));
  initVideoPlayers();
  injectVideoExpandButtons();

  // Restore any open comment threads (re-fetch their comments since the
  // whole list HTML was just replaced by this snapshot).
  openCommentThreads.forEach((id) => loadComments(id));

  handleDeepLink();
}

if (announcementsList) {
  await liveLeadersReady.catch(() => {});
  await authReady.catch(() => {});
  const annQuery = query(
    collection(db, "announcements"),
    orderBy("pinned", "desc"),
    orderBy("createdAt", "desc"),
    limit(20)
  );

  onSnapshot(
    annQuery,
    (snap) => {
      if (snap.empty) {
        announcementsList.innerHTML = `<div class="announcements-empty glass">No announcements yet — check back soon for updates from the UB3 team.</div>`;
        return;
      }
      lastAnnouncementsSnap = snap;
      renderFilterPills();
      renderAnnouncementsFeed();
    },
    (err) => {
      const detail = err?.message || err?.code || "unknown error";
      const urlMatch = detail.match(/https:\/\/console\.firebase\.google\.com\S+/);
      const detailHtml = urlMatch
        ? detail.slice(0, urlMatch.index) +
          `<a href="${urlMatch[0]}" target="_blank" rel="noopener" style="color:#7dd3fc;text-decoration:underline;">Tap here to create the required index</a>` +
          detail.slice(urlMatch.index + urlMatch[0].length)
        : "Couldn't load announcements right now. Please refresh the page.";
      announcementsList.innerHTML = `<div class="announcements-empty glass">${detailHtml}</div>`;
      console.error("Announcements feed error:", err);
    }
  );

  /* -- click a verified leader's avatar/name (on a post OR a comment), or */
  /*    a highlighted @mention of one, -> their public profile (same modal */
  /*    as "View Profile" in the Leadership grid). No sign-in required —   */
  /*    anyone who can see the post/comment can view it.                   */
  announcementsList.addEventListener("click", (e) => {
    const btn = e.target.closest(".js-comment-leader-link, .js-mention-link");
    if (!btn) return;
    openLeaderModal(btn.dataset.openProfile);
  });

  /* -- see more / see less -------------------------------------------- */
  announcementsList.addEventListener("click", (e) => {
    const btn = e.target.closest(".js-see-more");
    if (!btn) return;
    const body = btn.previousElementSibling;
    const expanded = body.classList.toggle("clamped") === false;
    btn.textContent = expanded ? "See less" : "See more";
  });

  /* -- vote on a poll ------------------------------------------------------ */
  announcementsList.addEventListener("click", async (e) => {
    const btn = e.target.closest(".js-poll-vote");
    if (!btn || btn.dataset.busy === "1") return;
    btn.dataset.busy = "1";

    const annId = btn.dataset.annId;
    const optionIndex = parseInt(btn.dataset.optionIndex, 10);
    const uid = visitorUid || (await authReady);
    if (!uid || visitorIsAnonymous) {
      btn.dataset.busy = "";
      return;
    }

    try {
      const docSnap = lastAnnouncementsSnap?.docs.find((d) => d.id === annId);
      const a = docSnap?.data();
      if (!a?.poll) throw new Error("Poll not found");
      const newVotes = a.poll.votes.slice();
      newVotes[optionIndex] = (newVotes[optionIndex] || 0) + 1;

      await setDoc(doc(db, "announcements", annId, "pollVotes", uid), {
        optionIndex,
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "announcements", annId), {
        poll: { question: a.poll.question, options: a.poll.options, votes: newVotes },
      });

      const voted = getVotedPolls();
      voted[annId] = optionIndex;
      saveVotedPolls(voted);
      // The write above re-triggers the feed's onSnapshot, which re-renders
      // this card showing the results view.
    } catch (err) {
      console.error("Poll vote failed:", err);
    } finally {
      btn.dataset.busy = "";
    }
  });

  /* -- tapping a poll option while signed out prompts Google sign-in ------- */
  announcementsList.addEventListener("click", (e) => {
    const btn = e.target.closest(".js-poll-signin");
    if (!btn) return;
    googleSignIn();
  });

  /* -- share a post ---------------------------------------------------- */
  announcementsList.addEventListener("click", async (e) => {
    const btn = e.target.closest(".js-share-btn");
    if (!btn) return;
    const annId = btn.dataset.annId;
    const meta = announcementMeta.get(annId);
    const url = `${location.origin}${location.pathname}?post=${annId}#announcements`;

    if (navigator.share) {
      try {
        await navigator.share({ title: meta?.title || "UB3 Announcement", url });
      } catch {
        // User cancelled the native share sheet — nothing to do.
      }
      return;
    }

    const originalHtml = btn.innerHTML;
    try {
      await navigator.clipboard.writeText(url);
      btn.innerHTML = `${ICONS.check}<span>Link copied</span>`;
    } catch {
      window.prompt("Copy this link:", url);
      return;
    }
    setTimeout(() => {
      btn.innerHTML = originalHtml;
    }, 1800);
  });

  /* -- unified single reaction per person (Facebook-style): tap the main  */
  /*    button to love/un-react; long-press for the full picker, where     */
  /*    picking a different type replaces whatever was active before ----- */
  async function addReactionOfType(annId, type) {
    const docSnap = lastAnnouncementsSnap?.docs.find((d) => d.id === annId);
    const a = docSnap?.data();
    if (type === "love") {
      await setDoc(doc(db, "announcements", annId, "likes", getDeviceId()), { createdAt: serverTimestamp() });
      const current = Math.max(0, a?.likeCount || 0);
      await updateDoc(doc(db, "announcements", annId), { likeCount: current + 1 });
    } else {
      await setDoc(doc(db, "announcements", annId, "reactions", `${getDeviceId()}_${type}`), { type, createdAt: serverTimestamp() });
      const current = { like: 0, fire: 0, clap: 0, laugh: 0, sad: 0, angry: 0, ...(a?.reactions || {}) };
      current[type] = Math.max(0, (current[type] || 0) + 1);
      await updateDoc(doc(db, "announcements", annId), { reactions: current });
    }
  }

  async function removeReactionOfType(annId, type) {
    const docSnap = lastAnnouncementsSnap?.docs.find((d) => d.id === annId);
    const a = docSnap?.data();
    if (type === "love") {
      await deleteDoc(doc(db, "announcements", annId, "likes", getDeviceId()));
      const current = Math.max(0, a?.likeCount || 0);
      await updateDoc(doc(db, "announcements", annId), { likeCount: Math.max(0, current - 1) });
    } else {
      await deleteDoc(doc(db, "announcements", annId, "reactions", `${getDeviceId()}_${type}`));
      const current = { like: 0, fire: 0, clap: 0, laugh: 0, sad: 0, angry: 0, ...(a?.reactions || {}) };
      current[type] = Math.max(0, (current[type] || 0) - 1);
      await updateDoc(doc(db, "announcements", annId), { reactions: current });
    }
  }

  function updateReactionButtonUI(btn, previousType, newType) {
    if (!btn) return;
    let counts;
    try {
      counts = JSON.parse(btn.dataset.counts || "{}");
    } catch {
      counts = {};
    }
    counts = { love: 0, like: 0, fire: 0, clap: 0, laugh: 0, sad: 0, angry: 0, ...counts };
    if (previousType) counts[previousType] = Math.max(0, (counts[previousType] || 0) - 1);
    if (newType) counts[newType] = (counts[newType] || 0) + 1;
    btn.dataset.counts = JSON.stringify(counts);

    const newTotal = counts.love + counts.like + counts.fire + counts.clap + counts.laugh + counts.sad + counts.angry;
    const iconHtml = reactionBreakdownHtml(counts) || ICONS.heart;
    btn.classList.toggle("liked", !!newType);
    btn.innerHTML = `${iconHtml}<span class="js-reaction-total">${newTotal}</span> <span>${newTotal === 1 ? "reaction" : "reactions"}</span>`;
  }

  async function setReaction(annId, type, btn) {
    if (btn?.dataset.busy === "1") return;
    if (btn) btn.dataset.busy = "1";

    const previous = getMyReaction(annId);
    const removing = previous === type;
    const newType = removing ? null : type;

    // Apply local state + the button's own UI immediately, before either
    // network round trip — not after. Waiting until the writes resolved is
    // what caused the delay/"doesn't look checked until I refresh" bug:
    // Firestore's onSnapshot can fire (and re-render this button from
    // still-stale localStorage) while those awaits are in flight.
    setMyReactionLocal(annId, newType);
    updateReactionButtonUI(btn, previous, newType);

    try {
      if (previous) await removeReactionOfType(annId, previous);
      if (newType) {
        await addReactionOfType(annId, newType);
        if (newType === "love") {
          const meta = announcementMeta.get(annId);
          notifyLeader({
            leaderId: meta?.authorId,
            type: "post_like",
            body: `Someone reacted to your post "${meta?.title || "your announcement"}".`,
            announcementId: annId,
          });
        }
      }
      // The write(s) above also re-trigger the feed's onSnapshot shortly
      // after, which re-renders this card from the server-confirmed state —
      // by then localStorage already agrees, so there's no flicker back.
    } catch (err) {
      console.error("Reaction failed:", err);
      // Roll back the optimistic update so the UI matches reality.
      setMyReactionLocal(annId, previous);
      updateReactionButtonUI(btn, newType, previous);
    } finally {
      if (btn) btn.dataset.busy = "";
    }
  }

  let activeReactionPicker = null;
  let reactionPressTimer = null;
  let reactionLongPressFired = false;

  function closeReactionPicker() {
    if (activeReactionPicker) {
      activeReactionPicker.remove();
      activeReactionPicker = null;
    }
  }

  function openReactionPicker(mainBtn) {
    closeReactionPicker();
    const annId = mainBtn.dataset.annId;
    const current = getMyReaction(annId);
    const picker = document.createElement("div");
    picker.className = "reaction-picker";
    picker.innerHTML = REACTION_TYPES.map(
      (t) => `<button type="button" class="reaction-picker-btn${current === t.key ? " active" : ""}" data-type="${t.key}">${t.emoji}</button>`
    ).join("");
    picker.addEventListener("click", (e) => {
      const pickerBtn = e.target.closest(".reaction-picker-btn");
      if (!pickerBtn) return;
      setReaction(annId, pickerBtn.dataset.type, mainBtn);
      closeReactionPicker();
    });
    mainBtn.appendChild(picker);
    activeReactionPicker = picker;
    requestAnimationFrame(() => picker.classList.add("open"));
  }

  announcementsList.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest(".js-reaction-main");
    if (!btn) return;
    reactionLongPressFired = false;
    reactionPressTimer = setTimeout(() => {
      reactionLongPressFired = true;
      openReactionPicker(btn);
    }, 450);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((evt) => {
    announcementsList.addEventListener(evt, () => clearTimeout(reactionPressTimer));
  });
  document.addEventListener("click", (e) => {
    if (activeReactionPicker && !e.target.closest(".reaction-picker") && !e.target.closest(".js-reaction-main")) {
      closeReactionPicker();
    }
  });

  /* -- a plain tap on the main button toggles your current reaction off, */
  /*    or sets love if you haven't reacted yet ---------------------------- */
  announcementsList.addEventListener("click", (e) => {
    const btn = e.target.closest(".js-reaction-main");
    if (!btn) return;
    if (reactionLongPressFired) {
      reactionLongPressFired = false;
      return;
    }
    const annId = btn.dataset.annId;
    setReaction(annId, getMyReaction(annId) || "love", btn);
  });

  /* -- bookmark a post (local to this browser, no account needed) ------- */
  announcementsList.addEventListener("click", (e) => {
    const btn = e.target.closest(".js-bookmark-btn");
    if (!btn) return;
    const annId = btn.dataset.annId;
    const bookmarks = getBookmarks();
    const bookmarked = bookmarks.has(annId);
    if (bookmarked) {
      bookmarks.delete(annId);
    } else {
      bookmarks.add(annId);
    }
    saveBookmarks(bookmarks);
    btn.classList.toggle("active", !bookmarked);
    btn.innerHTML = !bookmarked ? ICONS.bookmarkFilled : ICONS.bookmark;
    btn.title = !bookmarked ? "Remove bookmark" : "Save for later";
    if (showBookmarkedOnly) renderAnnouncementsFeed();
  });

  /* -- toggle comment thread --------------------------------------------- */
  announcementsList.addEventListener("click", (e) => {
    const btn = e.target.closest(".js-comment-toggle");
    if (!btn) return;
    const id = btn.dataset.annId;
    const panel = announcementsList.querySelector(`.announcement-comments[data-ann-id="${id}"]`);
    if (!panel) return;
    const willOpen = !panel.classList.contains("open");
    panel.classList.toggle("open", willOpen);
    btn.classList.toggle("comments-open", willOpen);
    if (willOpen) {
      openCommentThreads.add(id);
      loadComments(id);
    } else {
      openCommentThreads.delete(id);
    }
  });

  /* -- post a comment or a reply (same form class; replies carry a       */
  /*    data-parent-id pointing at the comment they're replying to) ----- */
  announcementsList.addEventListener("submit", async (e) => {
    const form = e.target.closest(".js-comment-form");
    if (!form) return;
    e.preventDefault();
    const id = form.dataset.annId;
    const parentId = form.dataset.parentId || null;
    const status = form.querySelector(".comment-form-status");
    const submitBtn = form.querySelector(".comment-form-submit");
    const bodyVal = form.body.value.trim();
    if (!bodyVal) return;

    if (visitorIsAnonymous) {
      status.textContent = "Please sign in with Google above to comment.";
      return;
    }

    submitBtn.disabled = true;
    try {
      const uid = visitorUid || (await authReady);
      if (!uid) throw new Error("Not signed in — comment ownership couldn't be established.");
      // A leader's real name lives in their Firestore profile (LEADERS,
      // populated by loadLiveLeaders), not necessarily on their Firebase
      // Auth account's displayName field — so for a registered leader,
      // prefer that over the (possibly empty) Auth displayName.
      const leaderSlot = LEADERS.find((l) => l.uid && l.uid === uid);
      const nameVal = leaderSlot?.name || visitorDisplayName || "Visitor";
      // Snapshot {id, name} for every verified leader @-mentioned right
      // now, so the mention keeps rendering (and pointing at the right
      // profile) even if that leader later changes their display name.
      const mentionedNow = findMentionedLeaders(bodyVal).map((l) => ({ id: l.id, name: l.name }));
      const payload = { uid, name: nameVal, body: bodyVal, createdAt: serverTimestamp() };
      if (parentId) payload.parentId = parentId;
      if (visitorPhotoURL) payload.photoURL = visitorPhotoURL;
      if (mentionedNow.length) payload.mentions = mentionedNow;
      await addDoc(collection(db, "announcements", id, "comments"), payload);
      await updateDoc(doc(db, "announcements", id), { commentCount: increment(1) });

      const excerpt = bodyVal.length > 100 ? `${bodyVal.slice(0, 100)}…` : bodyVal;
      if (parentId) {
        const parentOwnerUid = form.closest(".comment-item")?.dataset.ownerUid;
        notifyLeader({
          leaderId: parentOwnerUid,
          type: "comment_reply",
          actorName: nameVal,
          body: `${nameVal} replied to your comment: "${excerpt}"`,
          announcementId: id,
          commentId: parentId,
        });
      } else {
        const meta = announcementMeta.get(id);
        notifyLeader({
          leaderId: meta?.authorId,
          type: "post_comment",
          actorName: nameVal,
          body: `${nameVal} commented on your post "${meta?.title || "your announcement"}": "${excerpt}"`,
          announcementId: id,
        });
      }

      // Anyone @-mentioned in the comment gets their own "mentioned you"
      // notification, in addition to whatever post/reply notification
      // already fired above — mirrors the two separate notifications
      // Facebook/X send for "commented" vs "tagged you".
      findMentionedLeaders(bodyVal).forEach((leader) => {
        if (!leader.uid || leader.uid === uid) return; // no account yet, or mentioned themselves
        notifyLeader({
          leaderId: leader.uid,
          type: "mention",
          actorName: nameVal,
          body: `${nameVal} mentioned you in a comment: "${excerpt}"`,
          announcementId: id,
          commentId: parentId || null,
        });
      });

      form.body.value = "";
      status.textContent = "";
      if (parentId) form.classList.remove("open");
      loadComments(id);
    } catch (err) {
      status.textContent = "Couldn't post your comment. Please try again.";
      console.error("Comment failed:", err);
    } finally {
      submitBtn.disabled = false;
    }
  });

  /* -- @mention autocomplete: typing "@" in a comment/reply box shows a  */
  /*    live dropdown of leader names to tap, so you don't have to get     */
  /*    their exact name right for the tag/notification to work ---------- */
  let activeMentionDropdown = null;

  function closeMentionDropdown() {
    activeMentionDropdown?.remove();
    activeMentionDropdown = null;
  }

  // Returns the partial name being typed after the nearest "@" before the
  // cursor (e.g. "Abu" for "hey @Abu"), or null if the cursor isn't
  // currently inside a mention.
  function currentMentionQuery(textarea) {
    const upToCursor = textarea.value.slice(0, textarea.selectionStart);
    const match = upToCursor.match(/@([A-Za-z]*)$/);
    return match ? match[1] : null;
  }

  function insertMention(textarea, name) {
    const pos = textarea.selectionStart;
    const before = textarea.value.slice(0, pos).replace(/@([A-Za-z]*)$/, `@${name} `);
    const after = textarea.value.slice(pos);
    textarea.value = before + after;
    textarea.focus();
    textarea.setSelectionRange(before.length, before.length);
    closeMentionDropdown();
  }

  function openMentionDropdown(textarea, query) {
    // Only verified leaders (a claimed portal account) ever show up in the
    // autocomplete — matches the same gate used to decide whether a
    // mention gets highlighted + linked once posted.
    const matches = verifiedMentionCandidates(LEADERS)
      .filter((l) => l.name.toLowerCase().startsWith(query.toLowerCase()))
      .slice(0, 5);
    closeMentionDropdown();
    if (!matches.length) return;

    const dropdown = document.createElement("div");
    dropdown.className = "mention-dropdown";
    dropdown.innerHTML = matches
      .map(
        (l) => `
        <button type="button" class="mention-dropdown-item" data-name="${escapeHtml(l.name)}">
          <span class="mention-dropdown-avatar">${l.photo ? `<img src="${l.photo}" alt="">` : initials(l.name)}</span>
          <span class="mention-dropdown-info">
            <span class="mention-dropdown-name">${escapeHtml(l.name)}</span>
            ${l.position ? `<span class="mention-dropdown-role">${escapeHtml(l.position)}</span>` : ""}
          </span>
        </button>`
      )
      .join("");
    dropdown.style.top = `${textarea.offsetTop + textarea.offsetHeight + 4}px`;
    dropdown.style.left = `${textarea.offsetLeft}px`;
    dropdown.style.width = `${textarea.offsetWidth}px`;
    textarea.parentElement.appendChild(dropdown);
    activeMentionDropdown = dropdown;

    // mousedown (not click) so this fires before the textarea's blur
    // event would otherwise close the dropdown first.
    dropdown.addEventListener("mousedown", (e) => {
      const btn = e.target.closest(".mention-dropdown-item");
      if (!btn) return;
      e.preventDefault();
      insertMention(textarea, btn.dataset.name);
    });
  }

  announcementsList.addEventListener("input", (e) => {
    const textarea = e.target.closest(".js-comment-form textarea[name='body']");
    if (!textarea) return;
    const query = currentMentionQuery(textarea);
    if (query === null) closeMentionDropdown();
    else openMentionDropdown(textarea, query);
  });

  announcementsList.addEventListener(
    "blur",
    (e) => {
      if (e.target.closest(".js-comment-form textarea[name='body']")) closeMentionDropdown();
    },
    true
  );
  announcementsList.addEventListener("click", async (e) => {
    const editBtn = e.target.closest(".js-comment-edit");
    const deleteBtn = e.target.closest(".js-comment-delete");
    const cancelBtn = e.target.closest(".js-comment-cancel");
    const saveBtn = e.target.closest(".js-comment-save");

    if (editBtn) {
      const item = editBtn.closest(".comment-item");
      item?.classList.add("editing");
      const textarea = item?.querySelector(".js-comment-edit-input");
      textarea?.focus();
      return;
    }

    if (cancelBtn) {
      cancelBtn.closest(".comment-item")?.classList.remove("editing");
      return;
    }

    if (saveBtn) {
      if (saveBtn.dataset.busy === "1") return;
      const item = saveBtn.closest(".comment-item");
      const annId = item.dataset.annId;
      const commentId = item.dataset.commentId;
      const textarea = item.querySelector(".js-comment-edit-input");
      const newBody = (textarea?.value || "").trim();
      if (!newBody) return;
      saveBtn.dataset.busy = "1";
      saveBtn.disabled = true;
      try {
        // Recompute the mentions snapshot too, so editing in a new
        // @mention (or removing one) updates who it links to right away.
        const mentionedNow = findMentionedLeaders(newBody).map((l) => ({ id: l.id, name: l.name }));
        await updateDoc(doc(db, "announcements", annId, "comments", commentId), {
          body: newBody,
          editedAt: serverTimestamp(),
          mentions: mentionedNow,
        });
        loadComments(annId);
      } catch (err) {
        console.error("Comment edit failed:", err);
        alert("Couldn't save your changes. Please try again.");
      } finally {
        saveBtn.disabled = false;
        saveBtn.dataset.busy = "";
      }
      return;
    }

    if (deleteBtn) {
      if (deleteBtn.dataset.busy === "1") return;
      const item = deleteBtn.closest(".comment-item");
      const annId = item.dataset.annId;
      const commentId = item.dataset.commentId;
      if (!confirm("Delete this comment? This can't be undone.")) return;
      deleteBtn.dataset.busy = "1";
      try {
        await deleteDoc(doc(db, "announcements", annId, "comments", commentId));
        await updateDoc(doc(db, "announcements", annId), { commentCount: increment(-1) });
        loadComments(annId);
      } catch (err) {
        console.error("Comment delete failed:", err);
        alert("Couldn't delete this comment. Please try again.");
        deleteBtn.dataset.busy = "";
      }
      return;
    }
  });

  /* -- toggle a reply form under a top-level comment -------------------- */
  announcementsList.addEventListener("click", (e) => {
    const btn = e.target.closest(".js-comment-reply-toggle");
    if (!btn) return;
    const item = btn.closest(".comment-item");
    const form = item?.querySelector(".comment-reply-form");
    if (!form) return;
    const willOpen = !form.classList.contains("open");
    form.classList.toggle("open", willOpen);
    if (willOpen && !visitorIsAnonymous) form.body.focus();
  });

  /* -- react (like) to a comment or reply -------------------------------- */
  announcementsList.addEventListener("click", async (e) => {
    const btn = e.target.closest(".js-comment-like");
    if (!btn || btn.dataset.busy === "1") return;
    btn.dataset.busy = "1";

    const item = btn.closest(".comment-item");
    const annId = item.dataset.annId;
    const commentId = item.dataset.commentId;
    const key = `${annId}:${commentId}`;
    const likedComments = getLikedComments();
    const alreadyLiked = likedComments.has(key);

    const uid = visitorUid || (await authReady);
    if (!uid) {
      btn.dataset.busy = "";
      return;
    }

    const commentRef = doc(db, "announcements", annId, "comments", commentId);
    const likeRef = doc(db, "announcements", annId, "comments", commentId, "likes", uid);

    // Optimistic UI update
    const currentCount = parseInt(btn.querySelector(".js-comment-like-count")?.textContent, 10) || 0;
    const newCount = Math.max(0, currentCount + (!alreadyLiked ? 1 : -1));
    btn.classList.toggle("liked", !alreadyLiked);
    btn.innerHTML = `${!alreadyLiked ? ICONS.heartFilled : ICONS.heart}<span class="js-comment-like-count">${newCount}</span>`;

    try {
      if (alreadyLiked) {
        await deleteDoc(likeRef);
        // Literal value (not increment()) — same self-healing reasoning as post likes.
        await updateDoc(commentRef, { likeCount: newCount });
        likedComments.delete(key);
      } else {
        await setDoc(likeRef, { createdAt: serverTimestamp() });
        await updateDoc(commentRef, { likeCount: newCount });
        likedComments.add(key);
        const commentText = item.querySelector(".js-comment-text")?.textContent || "";
        const excerpt = commentText.length > 100 ? `${commentText.slice(0, 100)}…` : commentText;
        notifyLeader({
          leaderId: item.dataset.ownerUid,
          type: "comment_like",
          body: `Someone liked your comment: "${excerpt}"`,
          announcementId: annId,
          commentId,
        });
      }
      saveLikedComments(likedComments);
    } catch (err) {
      console.error("Comment like failed:", err);
    } finally {
      btn.dataset.busy = "";
    }
  });
}

/* -- fetch + render a post's comment list (one-time read, refreshed on   */
/*    open/post rather than a live listener, to keep reads modest) -------- */
async function loadComments(annId) {
  const list = announcementsList?.querySelector(`.announcement-comments[data-ann-id="${annId}"] .js-comment-list`);
  if (!list) return;
  list.innerHTML = `<div class="comment-empty">Loading comments…</div>`;
  try {
    const ownUid = visitorUid || (await authReady);
    const likedComments = getLikedComments();
    const q = query(collection(db, "announcements", annId, "comments"), orderBy("createdAt", "asc"), limit(200));
    const snap = await getDocs(q);
    if (snap.empty) {
      list.innerHTML = `<div class="comment-empty">No comments yet — be the first to reply.</div>`;
      return;
    }

    // Comments are stored flat, with an optional `parentId` marking a
    // reply — grouped here into top-level comments + their replies so the
    // whole thread only needs one Firestore read.
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const topLevel = all.filter((c) => !c.parentId);
    const repliesByParent = new Map();
    all.forEach((c) => {
      if (!c.parentId) return;
      if (!repliesByParent.has(c.parentId)) repliesByParent.set(c.parentId, []);
      repliesByParent.get(c.parentId).push(c);
    });

    list.innerHTML = topLevel
      .map((c) => {
        const repliesHtml = (repliesByParent.get(c.id) || [])
          .map((r) => renderCommentHtml(r, annId, ownUid, likedComments, true))
          .join("");
        return renderCommentHtml(c, annId, ownUid, likedComments, false, repliesHtml);
      })
      .join("");
  } catch (err) {
    list.innerHTML = `<div class="comment-empty">Couldn't load comments.</div>`;
    console.error("Load comments failed:", err);
  }
}

function renderCommentHtml(c, annId, ownUid, likedComments, isReply, repliesHtml = "") {
  const id = c.id;
  const time = c.createdAt?.toDate ? timeAgo(c.createdAt.toDate()) : "";
  const isOwner = ownUid && c.uid && c.uid === ownUid;
  const likeCount = Math.max(0, c.likeCount || 0);
  const liked = likedComments.has(`${annId}:${id}`);

  // If this commenter is one of the 9 leader accounts, show their real
  // name + position + the same verified/affiliate badges used on their
  // posts — instead of just a plain visitor name — so it's obvious when a
  // leader is speaking. Reuses LEADERS[].uid, the same lookup as posts.
  // A match here IS the verification check: only the 9 real leader
  // accounts can ever have `c.uid` equal a LEADERS[].uid (enforced by
  // firestore.rules on account creation), so leaderSlot doubles as "this
  // comment is from a verified UB3 leader" — that's what gates the
  // clickable avatar/name below, not just visual styling.
  const leaderSlot = LEADERS.find((l) => l.uid && l.uid === c.uid);
  const avatarInner = leaderSlot?.photo
    ? `<img src="${leaderSlot.photo}" alt="">`
    : c.photoURL
    ? `<img src="${c.photoURL}" alt="">`
    : initials(c.name || "?");
  const hasPhoto = c.photoURL || leaderSlot?.photo;

  // Verified leaders get a clickable avatar + name that open their public
  // profile (the same leader-modal used everywhere else on the site);
  // everyone else's avatar/name stays plain, non-interactive markup.
  const avatarHtml = leaderSlot
    ? `<button type="button" class="comment-avatar${hasPhoto ? " has-photo" : ""} js-comment-leader-link" data-open-profile="${leaderSlot.id}" aria-label="View ${escapeHtml(leaderSlot.name)}'s profile">${avatarInner}</button>`
    : `<div class="comment-avatar${hasPhoto ? " has-photo" : ""}">${avatarInner}</div>`;
  const nameHtml = leaderSlot
    ? `
      <div class="comment-name-row">
        <button type="button" class="comment-name js-comment-leader-link" data-open-profile="${leaderSlot.id}" aria-label="View ${escapeHtml(leaderSlot.name)}'s profile">${escapeHtml(leaderSlot.name || c.name || "Visitor")}</button>
        ${verifiedBadge(leaderSlot)}${affiliateBadge(leaderSlot)}
      </div>
      ${leaderSlot.position ? `<span class="comment-role-badge">${escapeHtml(leaderSlot.position)}</span>` : ""}`
    : `<div class="comment-name">${escapeHtml(c.name || "Visitor")}</div>`;

  return `
    <div class="comment-item${isReply ? " is-reply" : ""}" data-ann-id="${annId}" data-comment-id="${id}" data-owner-uid="${c.uid || ""}">
      ${avatarHtml}
      <div class="comment-body-wrap">
        ${nameHtml}
        <div class="comment-text js-comment-text">${renderMentions(escapeHtml(c.body || ""), c.mentions)}</div>
        <textarea class="js-comment-edit-input" maxlength="1000">${escapeHtml(c.body || "")}</textarea>

        <div class="comment-meta-row">
          <span class="comment-time">${time}${c.editedAt ? " · edited" : ""}</span>
          <button type="button" class="comment-mini-btn js-comment-like${liked ? " liked" : ""}">${liked ? ICONS.heartFilled : ICONS.heart}<span class="js-comment-like-count">${likeCount}</span></button>
          ${!isReply ? `<button type="button" class="comment-mini-btn js-comment-reply-toggle">Reply</button>` : ""}
          ${isOwner ? `
            <button type="button" class="comment-mini-btn js-comment-edit">Edit</button>
            <button type="button" class="comment-mini-btn js-comment-delete">Delete</button>` : ""}
        </div>
        <div class="comment-edit-actions">
          <button type="button" class="comment-mini-btn js-comment-cancel">Cancel</button>
          <button type="button" class="comment-mini-btn primary js-comment-save">Save</button>
        </div>

        ${!isReply ? `
          <form class="comment-form comment-reply-form js-comment-form${visitorIsAnonymous ? " signed-out" : ""}" data-ann-id="${annId}" data-parent-id="${id}">
            <div class="comment-auth-status">${commentAuthStatusHtml()}</div>
            <textarea name="body" rows="2" maxlength="1000" placeholder="Write a reply…" required></textarea>
            <button type="submit" class="comment-form-submit">${ICONS.send} Reply</button>
            <p class="comment-form-status"></p>
          </form>
          <div class="comment-replies">${repliesHtml}</div>` : ""}
      </div>
    </div>`;
}

/* ---------------------------------------------------------------------- */
/* Roadmap progress bar (public — reads roadmapUpdates, newest first)      */
/* Leaders post updates from the dashboard, building a history instead of  */
/* overwriting a single value. The newest one is the live progress bar;   */
/* everything older is listed underneath. Hidden entirely until at least   */
/* one update has ever been posted.                                       */
/* ---------------------------------------------------------------------- */
const roadmapProgressEl = document.getElementById("roadmap-progress");
if (roadmapProgressEl) {
  onSnapshot(
    query(collection(db, "roadmapUpdates"), orderBy("createdAt", "desc")),
    (snap) => {
      if (snap.empty) return;
      const docs = snap.docs.map((d) => d.data());
      const [current, ...history] = docs;
      const pct = Math.max(0, Math.min(100, Number(current.percent) || 0));

      roadmapProgressEl.style.display = "block";
      document.getElementById("roadmap-progress-label").textContent = current.label || "Overall progress";
      document.getElementById("roadmap-progress-pct").textContent = `${pct}%`;
      document.getElementById("roadmap-progress-fill").style.width = `${pct}%`;

      const historyEl = document.getElementById("roadmap-history");
      if (historyEl) {
        historyEl.innerHTML = history
          .map((r) => {
            const p = Math.max(0, Math.min(100, Number(r.percent) || 0));
            return `
              <div class="roadmap-history-item">
                <span class="roadmap-history-label">${escapeHtml(r.label || "")}</span>
                <span class="roadmap-history-pct">${p}%</span>
              </div>`;
          })
          .join("");
      }
    },
    (err) => console.error("Roadmap progress load failed:", err)
  );
}

/* ---------------------------------------------------------------------- */
/* Roadmap phase timeline (public — reads roadmapPhases, CMS-managed from  */
/* the Leadership Dashboard's Roadmap Manager). Only published phases are  */
/* shown, sorted by displayOrder client-side (avoids needing a composite   */
/* Firestore index for an equality filter + a different sort field).      */
/* Nothing here is hardcoded — an empty collection just renders nothing.   */
/* ---------------------------------------------------------------------- */
const roadmapTrackEl = document.getElementById("roadmap-track");
if (roadmapTrackEl) {
  onSnapshot(
    query(collection(db, "roadmapPhases"), where("published", "==", "published")),
    (snap) => {
      const phases = snap.docs
        .map((d) => d.data())
        .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));

      if (!phases.length) {
        roadmapTrackEl.innerHTML = `<div class="roadmap-track-loading">Roadmap phases coming soon.</div>`;
        return;
      }

      roadmapTrackEl.innerHTML = phases
        .map((p, idx) => {
          const pct = Math.max(0, Math.min(100, Number(p.progress) || 0));
          const phaseHeading = [p.phaseNumber ? `Phase ${escapeHtml(p.phaseNumber)}` : "", escapeHtml(p.phaseLabel || "")]
            .filter(Boolean)
            .join(" — ");
          return `
            <div class="roadmap-item reveal" style="transition-delay:${Math.min(idx, 6) * 0.06}s">
              ${phaseHeading ? `<div class="r-phase">${phaseHeading}</div>` : ""}
              <h3>${escapeHtml(p.title || "")}</h3>
              ${p.description ? `<p>${escapeHtml(p.description)}</p>` : ""}
              <div class="roadmap-item-progress">
                <div class="roadmap-item-progress-track"><div class="roadmap-item-progress-fill" style="width:${pct}%"></div></div>
                <span class="roadmap-item-progress-pct">${pct}%</span>
              </div>
            </div>`;
        })
        .join("");

      roadmapTrackEl.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    },
    (err) => {
      console.error("Roadmap phases load failed:", err);
      roadmapTrackEl.innerHTML = `<div class="roadmap-track-loading">Couldn't load the roadmap right now.</div>`;
    }
  );
}
