# Switching on sign-in and backup

Trailcraft works fully without this. Until it is done, sign-in simply stays
hidden and everything lives on the phone, as it always has.

About 15 minutes. You need your Google account. Nothing here costs money —
Firebase's free plan is far more than one handler will ever use.

---

## 1. Create the Firebase project

1. Go to **console.firebase.google.com** and sign in with your Google account.
2. **Create a project** → name it `Trailcraft`.
3. When asked about **Google Analytics**, switch it **off**. The app does not
   need it, and it is tracking you would then have to explain to clients.
4. **Create project**, wait, then **Continue**.

## 2. Register the web app

1. On the project overview, click the **`</>`** (Web) icon.
2. Nickname: `Trailcraft web`. Leave **Firebase Hosting unticked** — the app
   stays on GitHub Pages.
3. **Register app**. Firebase shows a block of code containing
   `const firebaseConfig = { apiKey: ..., authDomain: ..., projectId: ..., ... }`.
4. **Copy that `firebaseConfig` object and send it to me**, or paste it into
   `public/firebase-config.js` in place of `null`.

   These values are **not secret**. They only say which project to talk to;
   who can read what is decided by the rules in step 5. That is also why this
   file is committed, unlike `token.js`.

## 3. Switch on Google sign-in

1. Left menu → **Build → Authentication** → **Get started**.
2. **Sign-in method** tab → **Google** → switch **Enable** on.
3. Pick your email as the **support email** → **Save**.

## 3b. Switch on email and password

This is the sign-in the iPhone app uses: Google refuses to sign anyone in
from inside an app's built-in browser, so the app hides that button there.

1. Still in **Authentication → Sign-in method** → **Add new provider** →
   **Email/Password** → switch the first **Enable** on. Leave **Email link
   (passwordless sign-in)** off → **Save**.
2. **Settings** tab → **User actions**: leave **Email enumeration
   protection** on. It stops anyone using the sign-up form to find out who
   has an account.
3. Optional: **Templates** tab → **Email address verification** and
   **Password reset** → set the sender name to **Trailcraft**, so those
   emails don't arrive from a string of letters.

## 4. Allow the app's address to sign in

1. Still in Authentication → **Settings** tab → **Authorised domains**.
2. **Add domain** → `sydrouxba5.github.io` → **Add**.

   (`localhost` is already there, which is what lets it work while I test it.)

## 5. Create the database and lock it down

1. Left menu → **Build → Firestore Database** → **Create database**.
2. **Location: `europe-west2 (London)`**. This is permanent and cannot be
   changed later — London keeps your clients' records in the UK.
3. Start in **production mode** → **Create**.
4. Open the **Rules** tab, delete what is there, paste in the contents of
   `firestore.rules` from the project, and **Publish**.

   Those rules mean a signed-in account can read and write its own records
   and nothing else. Skip this step and the database refuses everything.

That's it for Google. Send me the config from step 2 and I will switch it on,
test it, and deploy.

---

## Later: Sign in with Apple

Apple requires a paid **Apple Developer Program** membership — $99 a year,
approval can take a day or two. When you have it:

1. **developer.apple.com → Certificates, IDs & Profiles**.
2. **Identifiers → +** → *App IDs* → enable **Sign in with Apple**.
3. **Identifiers → +** → *Services IDs* → create one (e.g.
   `com.elitecanine.trailcraft.web`) → enable **Sign in with Apple** →
   **Configure**:
   - Domain: `YOUR-PROJECT.firebaseapp.com`
   - Return URL: `https://YOUR-PROJECT.firebaseapp.com/__/auth/handler`
4. **Keys → +** → enable **Sign in with Apple** → download the `.p8` file.
   **This one IS secret.** It goes into Firebase only — never into the app,
   never into GitHub, never into a message.
5. Firebase → Authentication → Sign-in method → **Apple** → enable, and fill
   in the Services ID, your Team ID, the Key ID, and the contents of the
   `.p8` file.
6. Tell me, and I set `appleSignInEnabled = true`.

---

## If sign-in bounces straight back without signing you in

This can happen **only in the Home Screen app on an iPhone**. Safari blocks
the cross-site storage that Firebase's redirect sign-in relies on when the
sign-in page lives on a different domain (`firebaseapp.com`) from the app
(`github.io`).

Test in a normal Safari tab first — that path uses a popup and is not
affected. If the Home Screen app is the problem, tell me: the fix is to serve
Firebase's sign-in helper from your own domain, and it depends on how your
GitHub Pages site is set up, so it is worth doing only if it actually bites.

---

## Live sharing — two more switches

Sharing a run live (the "Share live" button on the run screen) uses the same
Firebase project. It works as soon as you are signed in, with two things set
up once:

1. **Rules.** `firestore.rules` in this repo has grown a `live` section.
   Firestore → **Rules** → paste the whole file again → **Publish**.

   The rules check what a live run holds, and they expect a `deleteAt`
   field, which only builds after 24 September 2026 write. Put the new
   build on the website and on every phone first, then publish the rules. A phone still
   on an older build is refused when it shares live ("Missing or
   insufficient permissions") until it is updated.
2. **Clean-up.** A live run is readable for 24 hours after it ends, then it
   should be deleted. Firestore → **Time-to-live (TTL)** → **Create policy**,
   twice:
   - Collection group `live`, timestamp field `deleteAt`
   - Collection group `chunks`, timestamp field `deleteAt`

   The field is `deleteAt`, not `expiresAt`. A TTL policy only deletes by a
   Timestamp field, and `expiresAt` is a number (the rules and the viewers
   read it), so a policy on `expiresAt` deletes nothing. If you made those
   two earlier, delete them and make these instead.

   Without these the links still stop working after 24 hours (the rules
   refuse them), but the data sits there, unreadable, until deleted. Runs
   shared before `deleteAt` existed have no such field, so the policy never
   reaches them: delete those by hand in Firestore → Data if you want them
   gone, with the `chunks` under each.

What a viewer sees: the laid trail and the dog's track as it happens, on a
plain web page, no app and no account needed. The link is 20 random
characters — nobody can guess it, and nothing is ever listed.
