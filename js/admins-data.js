// ============================================================================
// UB3 — Admin roster (Admin Portal)
// Completely separate from js/leaders-data.js / the Leader Portal. Edit this
// file to add each admin slot's position label — real profile data (name,
// photo, bio, socials) lives in Firestore's `admins/{uid}` collection and is
// overlaid onto the matching slot here at runtime (same pattern main.js uses
// for LEADERS), so the public site always reflects whoever currently holds
// that admin position.
//
// `id` must be unique and stable — it routes the public Admin Card + modal.
// ============================================================================

export const ADMINS = [
  {
    id: "admin-01",
    name: "UB3 Administrator",
    position: "Admin 1",
    bio: "",
    photo: "",
    email: "",
    socials: { x: "", telegram: "" },
  },
  // To add a future admin, just add another slot here — e.g.:
  // { id: "admin-02", name: "UB3 Administrator", position: "Admin 2", bio: "", photo: "", email: "", socials: { x: "", telegram: "" } },
];

// ============================================================================
// Admin account cap — mirrors MAX_LEADER_ACCOUNTS in leaders-data.js, but for
// the Admin Portal. Currently locked at 1: only the very first person to
// complete Google Sign-In + "Create Admin Profile" (while no admin profile
// exists yet) can ever become an admin through the app. This is checked
// client-side in js/admin-auth.js for a fast, friendly message, AND enforced
// server-side by firestore.rules via the `meta/adminStats` counter document
// — the Firestore rule is what actually protects this lock (its `update` is
// disabled entirely, so this cap can only ever change via a manual rules
// edit in the future, matching the "lock admin registration automatically"
// requirement).
//
// To support a future Admin 2 (etc.), raise this number, add the matching
// slot to ADMINS above, AND update the `meta/adminStats` rule in
// firestore.rules to allow `update` up to the new cap — nothing else in the
// Admin Portal needs to change.
// ============================================================================
export const MAX_ADMIN_ACCOUNTS = 1;

export function adminInitials(name) {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
