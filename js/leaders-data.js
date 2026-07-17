// ============================================================================
// UB3 — Leadership roster
// Edit this file to add each leader's real name, photo, bio, and links.
// `id` must be unique and stable — it is used to route profile pages and to
// match a leader's Firebase Authentication account to their Firestore
// document (leaders/{id}).
// `photo` can be a path like "assets/img/leader-01.jpg" once real photos are
// added to assets/img/ — until then the initials avatar is shown instead.
// ============================================================================

export const LEADERS = [
  {
    id: "leader-01",
    name: "Aisha",
    position: "Team Lead & Growth Coordinator",
    department: "Leadership",
    bio: "Leads team coordination, oversees overall growth, builds strategic partnerships, manages key relationships, and ensures the team stays aligned with its vision and goals.",
    photo: "",
    email: "",
    socials: { x: "", telegram: "" },
  },
  {
    id: "leader-02",
    name: "Anas",
    position: "Head of Strategy & Negotiations",
    department: "Strategy",
    bio: "Develops innovative ideas and long-term growth strategies, leads negotiations, and helps shape the project's strategic direction.",
    photo: "",
    email: "",
    socials: { x: "", telegram: "" },
  },
  {
    id: "leader-03",
    name: "Abubakar",
    position: "Head of Technology",
    department: "Technology",
    bio: "Leads technical development, programming, platform infrastructure, and manages X Spaces operations.",
    photo: "",
    email: "",
    socials: { x: "", telegram: "" },
  },
  {
    id: "leader-04",
    name: "Abdulkadeer",
    position: "Head of Community & Social Media",
    department: "Community",
    bio: "Leads community management, oversees social media operations, and drives audience engagement and growth.",
    photo: "",
    email: "",
    socials: { x: "", telegram: "" },
  },
  {
    id: "leader-05",
    name: "Ameer",
    position: "Creative Lead",
    department: "Creative",
    bio: "Oversees video production, editing, and graphic design to maintain a strong and consistent visual identity.",
    photo: "",
    email: "",
    socials: { x: "", telegram: "" },
  },
  {
    id: "leader-06",
    name: "Babagana",
    position: "Strategic Advisor",
    department: "Advisory",
    bio: "Provides strategic guidance, mentorship, and long-term insights to support the team's vision and decision-making.",
    photo: "",
    email: "",
    socials: { x: "", telegram: "" },
  },
  {
    id: "leader-07",
    name: "Musty",
    position: "Head of Content & Partnerships",
    department: "Content",
    bio: "Leads content strategy, creates engaging content, and builds partnerships while identifying new opportunities for growth.",
    photo: "",
    email: "",
    socials: { x: "", telegram: "" },
  },
  {
    id: "leader-08",
    name: "Muhammad",
    position: "Head of Graphics & Community Growth",
    department: "Graphics",
    bio: "Creates high-quality visual content and develops initiatives to expand and strengthen the community.",
    photo: "",
    email: "",
    socials: { x: "", telegram: "" },
  },
];

// ============================================================================
// Allowlist — only these email addresses are permitted to create a portal
// account. Fill in each leader's real email below (lowercase). This list is
// checked in js/auth.js before signup, AND enforced server-side by
// firestore.rules via the `allowlist` collection (see README for the
// one-time step of adding matching documents there — the client-side check
// alone can be bypassed by anyone calling the Firebase SDK directly, so the
// Firestore rule is what actually protects your data).
// ============================================================================
export const ALLOWED_LEADER_EMAILS = [
  "leader1@example.com", // TODO: replace with real email
  "leader2@example.com", // TODO: replace with real email
  "leader3@example.com", // TODO: replace with real email
  "leader4@example.com", // TODO: replace with real email
  "leader5@example.com", // TODO: replace with real email
  "leader6@example.com", // TODO: replace with real email
  "leader7@example.com", // TODO: replace with real email
  "leader8@example.com", // TODO: replace with real email
];

export function initials(name) {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
