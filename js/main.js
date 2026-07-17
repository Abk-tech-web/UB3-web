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
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { LEADERS, initials } from "./leaders-data.js";
import { ICONS } from "./icons.js";

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

function socialLinks(leader) {
  const items = [];
  if (leader.socials?.x) items.push(`<a href="${leader.socials.x}" target="_blank" rel="noopener" aria-label="${leader.name} on X">${ICONS.x}</a>`);
  if (leader.socials?.telegram) items.push(`<a href="${leader.socials.telegram}" target="_blank" rel="noopener" aria-label="${leader.name} on Telegram">${ICONS.telegram}</a>`);
  if (leader.email) items.push(`<a href="mailto:${leader.email}" aria-label="Email ${leader.name}">${ICONS.email}</a>`);
  return items.join("");
}

if (leadersGrid) {
  leadersGrid.innerHTML = LEADERS.map(
    (l, idx) => `
    <article class="leader-card glass reveal" style="transition-delay:${idx * 0.05}s">
      <div class="leader-photo">
        ${l.photo ? `<img src="${l.photo}" alt="${l.name}" loading="lazy">` : initials(l.name)}
      </div>
      <div class="leader-body">
        <h3>${l.name}</h3>
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
        <h3>${leader.name}</h3>
        <div class="l-role">${leader.position}</div>
        <div class="l-dept">${leader.department}</div>
      </div>
    </div>
    <div class="modal-body">
      <p class="l-bio">${leader.bio}</p>
      <div class="l-socials" style="margin-bottom:22px;">${socialLinks(leader)}</div>
      <form id="leader-message-form" data-leader-id="${leader.id}" data-leader-name="${leader.name}">
        <div class="field"><label>Your name</label><input type="text" name="name" required></div>
        <div class="field"><label>Your email</label><input type="email" name="email" required></div>
        <div class="field"><label>Message</label><textarea name="message" rows="4" required></textarea></div>
        <button type="submit" class="btn btn-primary btn-block">Send Message</button>
        <p class="form-status" id="leader-message-status"></p>
      </form>
    </div>
  `;

  modalOverlay.classList.add("open");
  modalContent.querySelector("[data-close-modal]").addEventListener("click", closeLeaderModal);
  modalContent.querySelector("#leader-message-form").addEventListener("submit", handleLeaderMessage);
}

function closeLeaderModal() {
  modalOverlay?.classList.remove("open");
}

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
