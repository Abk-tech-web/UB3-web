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
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  increment,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { LEADERS, initials } from "./leaders-data.js";
import { ICONS } from "./icons.js";

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
/* Visitor identity for comments (anonymous Firebase Auth)                 */
/* Every visitor — including ones who never log in — gets a lightweight    */
/* anonymous auth session. This gives each comment a real, unspoofable     */
/* owner (auth.uid) so we can safely let people edit/delete their own      */
/* comments later, without requiring an account. Requires the "Anonymous"  */
/* sign-in provider to be enabled in Firebase Console > Authentication.    */
/* ---------------------------------------------------------------------- */
let visitorUid = null;
const authReady = new Promise((resolve) => {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      visitorUid = user.uid;
      resolve(user.uid);
    } else {
      signInAnonymously(auth).catch((err) => {
        console.error("Anonymous sign-in failed (enable it in Firebase Console > Authentication > Sign-in method):", err);
        resolve(null);
      });
    }
  });
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

function getLikedPosts() {
  try {
    return new Set(JSON.parse(localStorage.getItem("ub3_liked_posts") || "[]"));
  } catch {
    return new Set();
  }
}

function saveLikedPosts(set) {
  localStorage.setItem("ub3_liked_posts", JSON.stringify([...set]));
}

// Announcement ids whose comment thread is currently expanded — preserved
// across re-renders so a visitor doesn't lose their open thread every time
// someone else likes/comments elsewhere in the feed.
const openCommentThreads = new Set();

if (announcementsList) {
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

      const likedPosts = getLikedPosts();
      const BODY_PREVIEW_LEN = 340;

      announcementsList.innerHTML = snap.docs
        .map((docSnap, idx) => {
          const id = docSnap.id;
          const a = docSnap.data();
          const time = a.createdAt?.toDate ? timeAgo(a.createdAt.toDate()) : "";
          const liked = likedPosts.has(id);
          const likeCount = Math.max(0, a.likeCount || 0);
          const commentCount = Math.max(0, a.commentCount || 0);
          const bodyText = a.body || "";
          const needsTruncate = bodyText.length > BODY_PREVIEW_LEN;
          const commentsOpen = openCommentThreads.has(id);

          return `
            <article class="announcement-card glass reveal${a.pinned ? " pinned" : ""}" data-ann-id="${id}" style="transition-delay:${Math.min(idx, 6) * 0.04}s">
              <div class="announcement-top">
                <div class="announcement-author">
                  <div class="announcement-avatar">${announcementAvatar(a)}</div>
                  <div class="announcement-who">
                    <div class="announcement-name-row">
                      <span class="announcement-name">${escapeHtml(a.authorName || "UB3")}</span>
                      ${a.authorPosition ? `<span class="announcement-role-badge">${escapeHtml(a.authorPosition)}</span>` : ""}
                    </div>
                    <div class="announcement-meta">Posted in Announcements<span class="dot">&middot;</span>${time}</div>
                  </div>
                </div>
                ${a.pinned ? `<span class="announcement-pin-badge">${ICONS.pin}Pinned</span>` : ""}
              </div>
              <h3 class="announcement-title">${escapeHtml(a.title)}</h3>
              <p class="announcement-body${needsTruncate ? " clamped js-ann-body" : ""}">${escapeHtml(bodyText)}</p>
              ${needsTruncate ? `<button type="button" class="announcement-see-more js-see-more">See more</button>` : ""}

              <div class="announcement-actions">
                <button type="button" class="announcement-action-btn js-like-btn${liked ? " liked" : ""}" data-ann-id="${id}">
                  ${liked ? ICONS.heartFilled : ICONS.heart}
                  <span class="js-like-count">${likeCount}</span> <span>${likeCount === 1 ? "like" : "likes"}</span>
                </button>
                <button type="button" class="announcement-action-btn js-comment-toggle${commentsOpen ? " comments-open" : ""}" data-ann-id="${id}">
                  ${ICONS.comment}
                  <span class="js-comment-count">${commentCount}</span> <span>${commentCount === 1 ? "comment" : "comments"}</span>
                </button>
              </div>

              <div class="announcement-comments${commentsOpen ? " open" : ""}" data-ann-id="${id}">
                <form class="comment-form js-comment-form" data-ann-id="${id}">
                  <div class="comment-form-row">
                    <input type="text" name="name" placeholder="Your name" maxlength="80" required>
                  </div>
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

      // Prefill remembered commenter name
      const savedName = localStorage.getItem("ub3_commenter_name") || "";
      if (savedName) {
        announcementsList.querySelectorAll('.comment-form input[name="name"]').forEach((inp) => {
          inp.value = savedName;
        });
      }

      // Restore any open comment threads (re-fetch their comments since the
      // whole list HTML was just replaced by this snapshot).
      openCommentThreads.forEach((id) => loadComments(id));
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

  /* -- see more / see less -------------------------------------------- */
  announcementsList.addEventListener("click", (e) => {
    const btn = e.target.closest(".js-see-more");
    if (!btn) return;
    const body = btn.previousElementSibling;
    const expanded = body.classList.toggle("clamped") === false;
    btn.textContent = expanded ? "See less" : "See more";
  });

  /* -- like / unlike ----------------------------------------------------- */
  announcementsList.addEventListener("click", async (e) => {
    const btn = e.target.closest(".js-like-btn");
    if (!btn || btn.dataset.busy === "1") return;
    btn.dataset.busy = "1";

    const id = btn.dataset.annId;
    const likedPosts = getLikedPosts();
    const alreadyLiked = likedPosts.has(id);
    const annRef = doc(db, "announcements", id);
    const likeRef = doc(db, "announcements", id, "likes", getDeviceId());

    // Optimistic UI update
    const currentCount = parseInt(btn.querySelector(".js-like-count")?.textContent, 10) || 0;
    const newCount = Math.max(0, currentCount + (!alreadyLiked ? 1 : -1));
    btn.classList.toggle("liked", !alreadyLiked);
    btn.innerHTML = `${!alreadyLiked ? ICONS.heartFilled : ICONS.heart} <span class="js-like-count">${newCount}</span> <span>${newCount === 1 ? "like" : "likes"}</span>`;

    try {
      if (alreadyLiked) {
        await deleteDoc(likeRef);
        await updateDoc(annRef, { likeCount: increment(-1) });
        likedPosts.delete(id);
      } else {
        await setDoc(likeRef, { createdAt: serverTimestamp() });
        await updateDoc(annRef, { likeCount: increment(1) });
        likedPosts.add(id);
      }
      saveLikedPosts(likedPosts);
    } catch (err) {
      console.error("Like failed:", err);
      // Re-sync will happen on the next onSnapshot fire regardless.
    } finally {
      btn.dataset.busy = "";
    }
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

  /* -- post a comment ------------------------------------------------- */
  announcementsList.addEventListener("submit", async (e) => {
    const form = e.target.closest(".js-comment-form");
    if (!form) return;
    e.preventDefault();
    const id = form.dataset.annId;
    const status = form.querySelector(".comment-form-status");
    const submitBtn = form.querySelector(".comment-form-submit");
    const nameVal = form.name.value.trim();
    const bodyVal = form.body.value.trim();
    if (!nameVal || !bodyVal) return;

    submitBtn.disabled = true;
    try {
      const uid = visitorUid || (await authReady);
      if (!uid) throw new Error("Not signed in — comment ownership couldn't be established.");
      await addDoc(collection(db, "announcements", id, "comments"), {
        uid,
        name: nameVal,
        body: bodyVal,
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "announcements", id), { commentCount: increment(1) });
      localStorage.setItem("ub3_commenter_name", nameVal);
      form.body.value = "";
      status.textContent = "";
      loadComments(id);
    } catch (err) {
      status.textContent = "Couldn't post your comment. Please try again.";
      console.error("Comment failed:", err);
    } finally {
      submitBtn.disabled = false;
    }
  });

  /* -- edit / delete / save / cancel a comment (event delegation) ------ */
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
        await updateDoc(doc(db, "announcements", annId, "comments", commentId), {
          body: newBody,
          editedAt: serverTimestamp(),
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
}

/* -- fetch + render a post's comment list (one-time read, refreshed on   */
/*    open/post rather than a live listener, to keep reads modest) -------- */
async function loadComments(annId) {
  const list = announcementsList?.querySelector(`.announcement-comments[data-ann-id="${annId}"] .js-comment-list`);
  if (!list) return;
  list.innerHTML = `<div class="comment-empty">Loading comments…</div>`;
  try {
    const ownUid = visitorUid || (await authReady);
    const q = query(collection(db, "announcements", annId, "comments"), orderBy("createdAt", "asc"), limit(100));
    const snap = await getDocs(q);
    if (snap.empty) {
      list.innerHTML = `<div class="comment-empty">No comments yet — be the first to reply.</div>`;
      return;
    }
    list.innerHTML = snap.docs
      .map((d) => {
        const c = d.data();
        const time = c.createdAt?.toDate ? timeAgo(c.createdAt.toDate()) : "";
        const isOwner = ownUid && c.uid && c.uid === ownUid;
        return `
          <div class="comment-item" data-ann-id="${annId}" data-comment-id="${d.id}">
            <div class="comment-avatar">${initials(c.name || "?")}</div>
            <div class="comment-body-wrap">
              <div class="comment-name">${escapeHtml(c.name || "Visitor")}</div>
              <div class="comment-text js-comment-text">${escapeHtml(c.body || "")}</div>
              <textarea class="js-comment-edit-input" maxlength="1000">${escapeHtml(c.body || "")}</textarea>
              <div class="comment-time">${time}${c.editedAt ? " · edited" : ""}</div>
              ${isOwner ? `
                <div class="comment-owner-actions">
                  <button type="button" class="comment-mini-btn js-comment-edit">Edit</button>
                  <button type="button" class="comment-mini-btn js-comment-delete">Delete</button>
                </div>
                <div class="comment-edit-actions">
                  <button type="button" class="comment-mini-btn js-comment-cancel">Cancel</button>
                  <button type="button" class="comment-mini-btn primary js-comment-save">Save</button>
                </div>` : ""}
            </div>
          </div>`;
      })
      .join("");
  } catch (err) {
    list.innerHTML = `<div class="comment-empty">Couldn't load comments.</div>`;
    console.error("Load comments failed:", err);
  }
}
