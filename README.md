# UB3 — Unbound DAO 3

Official website and leadership management platform for UB3 (Unbound DAO 3), a Web3 research, education, and opportunities ecosystem.

This is a **static HTML/CSS/JS project** — there is no build step, no bundler, and no `node_modules` to install. It runs by opening `index.html` in a browser, or by pushing it straight to GitHub/Vercel. Firebase is loaded from Google's CDN as ES modules.

## Project structure

```
ub3-website/
├── index.html          Public website (all homepage sections)
├── portal.html          Leadership portal — log in / create account / reset password
├── dashboard.html        Leader dashboard — profile, inbox, security
├── firestore.rules       Firestore security rules
├── vercel.json           Vercel headers/routing config
├── package.json
├── css/
│   ├── style.css         Design tokens + all component styles
│   └── responsive.css    Breakpoints
├── js/
│   ├── firebase.js       Firebase init — put your project keys here
│   ├── leaders-data.js   The 8 leaders' public info (edit with real names/bios)
│   ├── icons.js          Inline SVG icon set (X, Telegram, Email, UI icons)
│   ├── main.js            Homepage interactions + contact form
│   ├── auth.js            Portal login / signup / reset
│   └── dashboard.js       Leader dashboard logic
└── assets/
    ├── img/               Leader photos go here
    └── icons/
```

## 1. Set up Firebase (required)

1. Create a project at https://console.firebase.google.com.
2. **Project settings → General → Your apps → Web app** — register an app and copy the `firebaseConfig` object.
3. Paste those values into `js/firebase.js` (`FIREBASE_CONFIG`).
4. **Authentication → Sign-in method** — enable **Email/Password**.
5. **Firestore Database** — create a database (start in production mode).
6. Deploy the included security rules:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase init firestore   # point it at this folder, use the existing firestore.rules
   firebase deploy --only firestore:rules
   ```
   (Or paste the contents of `firestore.rules` into the Firebase console's Rules editor.)
7. **Storage** — enable it if leaders should be able to upload real profile photos (used by `dashboard.js`).

## 2. Add real content

- `js/leaders-data.js` — replace the 8 placeholder leaders with real names, positions, bios, and social links. This file drives the public Leadership section.
- `assets/img/` — drop in real leader photos and point each leader's `photo` field at the file.
- Each leader creates their own login from **Leadership Portal → Create Account** on the live site; that account is what lets them edit their own profile and inbox from `dashboard.html`.

## 3. Run locally

No build tools needed:

```bash
npx serve .
```

or just open `index.html` directly in a browser (Firebase Auth popups work best when served over `http://localhost`, not `file://`).

## 4. Deploy

**GitHub → Vercel**
1. Push this folder to a new GitHub repository.
2. In Vercel, "Add New Project" → import the repo.
3. Framework preset: **Other** (no build command, no output directory needed — it's static).
4. Deploy.

**GitHub Pages** works the same way — no build step required.

## Security notes

- Firestore rules (`firestore.rules`) restrict leader profile edits to the signed-in owner, and restrict inbox reads to the addressed leader only.
- The security-question answer is currently stored in Firestore for account-recovery UX; for production hardening, verify it server-side (e.g. a Cloud Function) instead of trusting the client, and consider hashing it before storage.
- Add [Firebase App Check](https://firebase.google.com/docs/app-check) before launch to reduce abuse of the public contact-form write path.

## Roadmap-ready architecture

`leaders/`, `messages/`, and `notifications/` Firestore collections are structured so an admin dashboard, member accounts, events, blog, task management, and DAO governance/voting modules can be added later without restructuring the existing data.

---

Design and Architecture by **Abubakar** — Head of Technology, UB3.
