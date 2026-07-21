// ============================================================================
// UB3 — main.js
// Handles: navbar state, mobile menu, theme toggle, hero node-network canvas,
// scroll-reveal, animated stat counters, dynamic leadership grid + profile
// modal, FAQ accordion, partner marquee, and the visitor contact form
// (writes to Firestore `messages` collection).
// ============================================================================

import { db } from "./firebase.js";
import {
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
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
