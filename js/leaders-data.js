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
    name: "Add Leader Name",
    position: "Founder & Chief Executive Officer",
    department: "Executive",
    bio: "Sets UB3's direction across research, education, and opportunities, and represents the DAO to partners and the community.",
    photo: "",
    email: "",
    socials: { x: "", telegram: "" },
  },
  {
    id: "leader-02",
    name: "Add Leader Name",
    position: "Chief Operating Officer",
    department: "Operations",
    bio: "Runs day-to-day operations across UB3's teams, keeping programs, partnerships, and delivery on track.",
    photo: "",
    email: "",
    socials: { x: "", telegram: "" },
  },
  {
    id: "leader-03",
    name: "Add Leader Name",
    position: "Head of Research & Intelligence",
    department: "Research",
    bio: "Leads market research, ecosystem reports, and token analysis that UB3 publishes for builders and investors.",
    photo: "",
    email: "",
    socials: { x: "", telegram: "" },
  },
  {
    id: "leader-04",
    name: "Add Leader Name",
    position: "Head of Education",
    department: "Education",
    bio: "Builds UB3's Web3 guides, tutorials, and workshops that turn beginners into confident builders.",
    photo: "",
    email: "",
    socials: { x: "", telegram: "" },
  },
  {
    id: "leader-05",
    name: "Add Leader Name",
    position: "Head of Opportunities",
    department: "Opportunities",
    bio: "Curates ambassador programs, jobs, internships, grants, bounties, and hackathons for the UB3 community.",
    photo: "",
    email: "",
    socials: { x: "", telegram: "" },
  },
  {
    id: "leader-06",
    name: "Add Leader Name",
    position: "Head of Community",
    department: "Community",
    bio: "Manages and moderates UB3's community spaces, keeping them welcoming, active, and useful.",
    photo: "",
    email: "",
    socials: { x: "", telegram: "" },
  },
  {
    id: "leader-07",
    name: "Add Leader Name",
    position: "Head of Growth & Partnerships",
    department: "Growth",
    bio: "Drives marketing strategy, content, and partnership support that grow UB3's reach across Web3.",
    photo: "",
    email: "",
    socials: { x: "", telegram: "" },
  },
  {
    id: "leader-08",
    name: "Add Leader Name",
    position: "Head of Technology",
    department: "Technology",
    bio: "Oversees the platforms and tools UB3 builds for its team and community, including this website.",
    photo: "",
    email: "",
    socials: { x: "", telegram: "" },
  },
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
