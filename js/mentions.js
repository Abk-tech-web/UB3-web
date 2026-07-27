// ============================================================================
// UB3 — shared @mention helpers
// Used by js/main.js (public homepage: posts + comments) and js/dashboard.js
// (leader post composer) so mention recognition, highlighting, permissions,
// and autocomplete behave identically everywhere a leader can be @-mentioned.
// ============================================================================

export function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Builds the regex source for one leader's name: matches their full name
// (tolerating any amount of whitespace between words, since a name typed
// into a post/comment and a name saved from a profile form don't always
// agree on spacing), OR just their first name on its own — a leader's live
// dashboard profile can change or add a surname at any time, so requiring
// an exact full-name match would silently break the moment that happens.
export function mentionPatternSource(name) {
  const words = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const full = words.map(escapeRegex).join("\\s+");
  const first = escapeRegex(words[0]);
  return words.length > 1 ? `(?:${full}|${first})` : full;
}

// Every roster leader with a name, longest name first — so "@Abdulkadeer"
// is never partially matched by a shorter name that happens to be one of
// its prefixes.
export function mentionCandidates(leaders) {
  return leaders.filter((l) => l.name).sort((a, b) => b.name.length - a.name.length);
}

// Only leaders with a claimed portal account (a real login, not just a
// reserved roster slot) count as "verified" — the same uid-based check
// used everywhere else on the site to gate a clickable profile. Only these
// leaders get an autocomplete entry, a highlighted mention, or a clickable
// profile link; everyone else stays plain text.
export function verifiedMentionCandidates(leaders) {
  return mentionCandidates(leaders).filter((l) => l.uid);
}

// Finds every verified leader @-mentioned in a post/comment body
// (case-insensitive, whole word), deduped by leader id. Used right after
// posting to decide who to notify, and to snapshot {id, name} pairs onto
// the post/comment so the mention keeps working even if that leader later
// changes their display name.
export function findMentionedLeaders(text, leaders) {
  if (!text) return [];
  const found = new Map();
  verifiedMentionCandidates(leaders).forEach((l) => {
    const pattern = mentionPatternSource(l.name);
    if (pattern && new RegExp(`@${pattern}\\b`, "i").test(text)) found.set(l.id, l);
  });
  return [...found.values()];
}

// Highlights + links every recognized @mention inside an already-escaped
// HTML string, same idea as the blue @mentions on Facebook/X.
//
// The mention is ALWAYS resolved by the leader's permanent roster id, never
// by the text that was typed:
//   - `mentions` is the {id, name} snapshot stored on the post/comment at
//     write time. The snapshot `name` is only used to locate WHERE in the
//     old text the mention is (matching against whatever text was actually
//     typed/stored) — it is never what gets displayed.
//   - Once a match is found, the id is looked up against the LIVE roster
//     and the leader's CURRENT display name is what actually renders.
//     Change a leader's name once, twice, a hundred times — every existing
//     mention of them, anywhere on the platform, updates automatically the
//     next time it renders. Nothing about the stored post/comment ever
//     needs to be touched.
//   - Verification (and therefore clickability) is also resolved live: if
//     a leader is no longer verified, their mentions stop being clickable
//     immediately, everywhere, without editing old content.
//   - The profile link itself uses the id, never the name, so it can never
//     point at the wrong (or a nonexistent) profile.
//
// Falls back to matching against the live roster directly for legacy
// content saved before `mentions` existed.
export function renderMentions(escapedText, mentions, leaders) {
  let out = escapedText;
  const list = mentions && mentions.length
    ? mentions
    : mentionCandidates(leaders).map((l) => ({ id: l.id, name: l.name }));

  list.forEach((m) => {
    // Permanent-id lookup against the live roster — this is the ONLY
    // source of truth for what gets displayed and where the link points.
    const slot = leaders.find((l) => l.id === m.id);
    if (!slot || !slot.uid) return; // not a verified leader (anymore) -> stays plain text

    // The snapshot name is used only to find the mention in the raw text;
    // it tolerates the leader having since changed their name.
    const pattern = mentionPatternSource(m.name);
    if (!pattern) return;
    const re = new RegExp(`@${pattern}\\b`, "gi");
    const currentLabel = `@${escapeHtml(slot.name)}`;
    out = out.replace(
      re,
      () => `<button type="button" class="comment-mention js-mention-link" data-open-profile="${slot.id}">${currentLabel}</button>`
    );
  });
  return out;
}

// Wires "@" autocomplete onto a single, static textarea (used by the
// dashboard's one-off post composer — js/main.js's many dynamically
// created comment forms instead delegate this at the list-container level
// using the same matching helpers above).
//
// opts: { getLeaders(): leader[], initials(name): string, escapeHtml(s): string }
export function attachMentionAutocomplete(textarea, opts) {
  if (!textarea) return;
  let dropdown = null;

  function close() {
    dropdown?.remove();
    dropdown = null;
  }

  function currentQuery() {
    const upToCursor = textarea.value.slice(0, textarea.selectionStart);
    const match = upToCursor.match(/@([A-Za-z]*)$/);
    return match ? match[1] : null;
  }

  function insert(name) {
    const pos = textarea.selectionStart;
    const before = textarea.value.slice(0, pos).replace(/@([A-Za-z]*)$/, `@${name} `);
    const after = textarea.value.slice(pos);
    textarea.value = before + after;
    textarea.focus();
    textarea.setSelectionRange(before.length, before.length);
    close();
  }

  function open(query) {
    const matches = verifiedMentionCandidates(opts.getLeaders())
      .filter((l) => l.name.toLowerCase().startsWith(query.toLowerCase()))
      .slice(0, 5);
    close();
    if (!matches.length) return;

    dropdown = document.createElement("div");
    dropdown.className = "mention-dropdown";
    dropdown.innerHTML = matches
      .map(
        (l) => `
        <button type="button" class="mention-dropdown-item" data-name="${opts.escapeHtml(l.name)}">
          <span class="mention-dropdown-avatar">${l.photo ? `<img src="${l.photo}" alt="">` : opts.initials(l.name)}</span>
          <span class="mention-dropdown-info">
            <span class="mention-dropdown-name">${opts.escapeHtml(l.name)}</span>
            ${l.position ? `<span class="mention-dropdown-role">${opts.escapeHtml(l.position)}</span>` : ""}
          </span>
        </button>`
      )
      .join("");
    dropdown.style.top = `${textarea.offsetTop + textarea.offsetHeight + 4}px`;
    dropdown.style.left = `${textarea.offsetLeft}px`;
    dropdown.style.width = `${textarea.offsetWidth}px`;
    textarea.parentElement.appendChild(dropdown);

    dropdown.addEventListener("mousedown", (e) => {
      const btn = e.target.closest(".mention-dropdown-item");
      if (!btn) return;
      e.preventDefault();
      insert(btn.dataset.name);
    });
  }

  textarea.addEventListener("input", () => {
    const query = currentQuery();
    if (query === null) close();
    else open(query);
  });
  textarea.addEventListener(
    "blur",
    () => close(),
    true
  );
}
