# Going live: owner setup guide

This guide takes Spec Studio from the demo (saved only in one browser) to a live site where your deals are saved online and you sign in with an emailed link. You do it once. It takes about 30 minutes and needs no coding.

**Read this first: never paste a secret value into a chat, an issue, a commit or a document.** GitHub stores your secrets, and the deploy workflow reads them by name. Nobody, including Claude, ever needs to see them.

You will use three websites: Supabase (the database and sign-in), Cloudflare (hosts the site) and GitHub (runs the deploy). The words in **bold** are the exact names to use.

## Checklist

1. **Create a Supabase project.** At supabase.com, choose New project. Name it `spec-studio`. Set a database password and keep it somewhere safe (a password manager). For Region choose **West US (North California)**.

2. **Tell Supabase where the site lives.** In Supabase open Authentication, then URL Configuration.
   - Site URL: `https://spec-studio.pages.dev`
   - Redirect URLs: add `https://spec-studio.pages.dev/**`

   The app's sign-in links return to `https://spec-studio.pages.dev/`. If you add your own domain later, add it to both fields.

3. **Add a sign-in code to the email.** In Supabase open Authentication, then Email Templates, then **Magic Link**. Keep the existing `{{ .ConfirmationURL }}` link. Under it add this line exactly: `Or type this code: {{ .Token }}`. Save.

4. **Give GitHub the public project settings.** In Supabase open Project Settings, then API. In GitHub open your repository, then Settings, then Secrets and variables, then Actions, then the **Variables** tab. Add two variables:
   - **`SUPABASE_URL`**: the Project URL.
   - **`SUPABASE_ANON_KEY`**: the **anon** key. Newer projects also show a "publishable" key that starts with `sb_publishable_`; that works too. These two values are public by design.

   Never copy the `service_role` key or any key that starts with `sb_secret_` anywhere. If one is used by mistake, the deploy stops with an error before anything is published.

5. **Give GitHub the database connection.** In Supabase click Connect and choose the **Session pooler** string (port 5432). The direct connection also works. Do **not** use the Transaction pooler (port 6543): the migration step needs a steady connection. Replace the `[YOUR-PASSWORD]` part with the database password from step 1. In GitHub, on the **Secrets** tab of the same page, add a secret named **`SUPABASE_DB_URL`** with that string. It lives only in GitHub.

6. **Set up Cloudflare.**
   - In Cloudflare open Workers & Pages, then Create, then Pages, then Upload assets (direct upload). Name the project **`spec-studio`**. You can upload any small file just to create it; the deploy replaces it.
   - Your Account ID is in the right sidebar of the Workers & Pages overview. Add it in GitHub as the secret **`CLOUDFLARE_ACCOUNT_ID`**.
   - Create an API token: My Profile, then API Tokens, then Create Token, then Create Custom Token. Permission: **Account, Cloudflare Pages, Edit**. Add it in GitHub as the secret **`CLOUDFLARE_API_TOKEN`**.

7. **Run the deploy.** In GitHub open Actions, choose the **Deploy** workflow, and click Run workflow on `main`. It applies the database setup, builds the site and publishes it. A red error names whatever setting is missing; add it and run again. The site appears at `https://spec-studio.pages.dev`.

8. **Close sign-ups.** Open the site and sign in with your email (use the link, or type the code). Then in Supabase open Authentication, then Providers, then Email, and turn off **Allow new users to sign up**. Only you can get in from now on.

9. **Move your demo deals.** Open the old demo site, go to Settings, and choose **Export all data** (Copy). On the live site go to Settings, choose **Import an export**, and paste.

10. **Check it works.** Go through the go-live checklist with whoever is helping you.

## Good to know

- **Email limits.** Supabase's built-in email sender allows only a few emails per hour. That is fine for one owner. If sign-in emails stop arriving, wait an hour or add your own email service under Authentication, then Emails (custom SMTP).
- **Later deploys are automatic.** Every change merged to `main` deploys by itself.
- **No demo by accident.** If the two variables from step 4 are empty, the deploy refuses to run rather than publish the demo.
