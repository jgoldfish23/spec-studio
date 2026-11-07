# Going live: owner setup guide

This guide takes Spec Studio from the demo (saved only in one browser) to a live site where your deals are saved online and you sign in with an emailed link. You do it once. It takes about 30 minutes and needs no coding.

**Read this first: never paste a secret value into a chat, an issue, a commit or a document.** GitHub stores your secrets, and the deploy workflow reads them by name. Nobody, including Claude, ever needs to see them.

You will use three websites: Supabase (the database and sign-in), Cloudflare (hosts the site) and GitHub (runs the deploy). The words in **bold** are the exact names to use. Menu names below are current at the time of writing; if one has moved, look for the nearest equivalent (Supabase and Cloudflare rename menus from time to time).

## Checklist

1. **Create a Supabase project.** At supabase.com, choose New project. Name it `spec-studio`. Set a database password made of letters and digits only (no symbols, so it pastes into the connection string without trouble) and keep it somewhere safe (a password manager). For Region choose **West US (North California)**.

2. **Tell Supabase where the site lives.** In Supabase open Authentication, then URL Configuration.
   - Site URL: `https://spec-studio.pages.dev`
   - Redirect URLs: add `https://spec-studio.pages.dev/**`

   The app's sign-in links return to `https://spec-studio.pages.dev/`. If you add your own domain later, add it to both fields.

3. **Add a sign-in code to the email.** In Supabase open Authentication, then Emails, then Templates. Do this in **both** the **Magic Link** template and the **Confirm signup** template (a first-time sign-in with a new email address uses Confirm signup). In each, keep the existing `{{ .ConfirmationURL }}` link and add this line exactly under it: `Or type this code: {{ .Token }}`. Save each one.

   Then check the code's length: in Authentication, open the **Email** provider (under Sign In / Providers) and make sure **Email OTP Length** is **6**, which is the default. The app's code box takes exactly 6 digits, so a longer code could never be typed in.

4. **Give GitHub the public project settings.** In Supabase open Project Settings, then Data API (for the Project URL) and API Keys (for the keys). In GitHub open your repository, then Settings, then Secrets and variables, then Actions, then the **Variables** tab. Add two variables:
   - **`SUPABASE_URL`**: the Project URL.
   - **`SUPABASE_ANON_KEY`**: the **anon** key. Newer projects also show a "publishable" key that starts with `sb_publishable_`; that works too. These two values are public by design.

   Never copy the `service_role` key or any key that starts with `sb_secret_` anywhere. If one is used by mistake, the deploy stops with an error before anything is published.

5. **Give GitHub the database connection.** In Supabase click Connect and choose the **Session pooler** connection string (port 5432) and use only that one. Do **not** use the Transaction pooler (port 6543): the migration step needs a steady connection. Do not use the direct connection either: it does not work from GitHub. Replace the `[YOUR-PASSWORD]` part with the database password from step 1. In GitHub, on the **Secrets** tab of the same page, add a secret named **`SUPABASE_DB_URL`** with that string. It lives only in GitHub.

6. **Set up Cloudflare.**
   - In Cloudflare open Workers & Pages, then Create, then Pages, then Upload assets (direct upload). Name the project **`spec-studio`**. You can upload any small file just to create it; the deploy replaces it. Note the project's real address (`something.pages.dev`): if the name `spec-studio` was taken, Cloudflare adds a suffix. If it differs from `spec-studio.pages.dev`, go back to step 2 and use your real address there.
   - Your Account ID is in the right sidebar of the Workers & Pages overview. Add it in GitHub as the secret **`CLOUDFLARE_ACCOUNT_ID`**.
   - Create an API token: My Profile, then API Tokens, then Create Token, then Create Custom Token. Permission: **Account, Cloudflare Pages, Edit**. Under Account Resources, pick the right account. Add it in GitHub as the secret **`CLOUDFLARE_API_TOKEN`**.

7. **Run the deploy.** In GitHub open Actions, choose the **Deploy** workflow, and click Run workflow on `main`. It applies the database setup, builds the site and publishes it. A red error names whatever setting is missing; add it and run again. The site appears at `https://spec-studio.pages.dev`.

8. **Close sign-ups.** Open the site and sign in with your email (use the link, or type the code). Then in Supabase open Authentication, then Providers, then Email, and turn off **Allow new users to sign up**. Only you can get in from now on.

9. **Move your demo deals.** The demo you have been using is older than the Settings screen, so it can't export yet.
   - First have this version of the demo published at the **same address** as the old one. Your deals are saved in your browser under that address, so the same address still has them; a new address would start empty. (The demo was published as a private Claude artifact: ask for it to be updated at the same link, not published as a new one.)
   - Open the demo in the same browser you used before. Go to Settings and choose **Copy to clipboard** (or **Export all data**, which saves a file).
   - On the live site go to Settings, then **Import an export**, and paste (or choose the file). Importing the same export twice adds nothing twice.

10. **Put Spec Studio on the iPad's Home Screen.** On the iPad, open the live site in Safari, tap Share, then **Add to Home Screen**, and from now on open Spec Studio from that icon. Safari can clear a website's saved data after 7 days without a visit, and that includes edits that haven't synced yet; an app on the Home Screen is kept.

11. **Protect `main`.** Every push to `main` deploys, so only code that passed the checks should get there. In GitHub open your repository's Settings, then Branches (or Rules, then Rulesets), and add a rule for `main`: require a pull request, and require these status checks to pass before merging: **check**, **db** and **e2e** (the jobs of the CI workflow).

12. **Check it works.** Go through the go-live checklist with whoever is helping you.

## Good to know

- **Email limits.** Supabase's built-in email sender allows only a few emails per hour. That is fine for one owner. If sign-in emails stop arriving, wait an hour or add your own email service under Authentication, then Emails (custom SMTP).
- **Later deploys are automatic.** Every change merged to `main` deploys by itself.
- **No demo by accident.** If the two variables from step 4 are empty, the deploy refuses to run rather than publish the demo.
- **A custom address for Supabase.** The site is only allowed to talk to Supabase's own addresses (`*.supabase.co`). If you ever give your Supabase project a custom domain, add that domain to the `connect-src` part of the `Content-Security-Policy` line in `public/_headers`, both as `https://` and as `wss://`, or the app won't be able to reach it.
