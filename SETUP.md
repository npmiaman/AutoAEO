# AutoAEO — local setup

A 10-minute path to a running app connected to a Shopify dev store.

## 1. Install + run

```bash
npm install
npm run db:push   # creates local.db and applies the schema
npm run dev
```

Open `http://localhost:3000`.

The `.env.local` was generated for you with `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`. The remaining values you need to fill in: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, and `ANTHROPIC_API_KEY`.

## 2. Create a Shopify Partner account (free)

1. Go to **https://partners.shopify.com/**
2. Sign up with your email — it's free, no business required.
3. You'll land in the Partner dashboard.

## 3. Create a development store

1. In the Partner dashboard sidebar → **Stores** → **Add store**.
2. Pick **Create development store** → **Create a store to test and build**.
3. Name it (e.g. `autoaeo-test`) and pick a region.
4. Click **Create development store**.
5. Once created, click into it and have Shopify auto-add some sample products (Settings → Products → Add sample data) so the agent has content to work with.

The store URL will be something like `autoaeo-test.myshopify.com`.

## 4. Create a Shopify Partner App

1. In the Partner dashboard sidebar → **Apps** → **Create app** → **Create app manually**.
2. Name: `AutoAEO (dev)`.
3. After it's created you'll see **Client ID** and **Client secret** under the **Configuration** tab — these are the values you copy.
4. Set the URLs in the app's **Configuration** tab:
   - **App URL**: `http://localhost:3000`
   - **Allowed redirection URL(s)**: `http://localhost:3000/api/shopify/callback`
5. Save.

## 5. Fill in `.env.local`

```env
SHOPIFY_API_KEY=<paste Client ID from step 4>
SHOPIFY_API_SECRET=<paste Client secret from step 4>
ANTHROPIC_API_KEY=<key from console.anthropic.com>
```

Restart `npm run dev` after editing `.env.local`.

## 6. Connect the dev store

1. Open `http://localhost:3000` → **Get started** → create your AutoAEO account.
2. On the dashboard, click **Connect Shopify store**.
3. Enter your dev store domain (e.g. `autoaeo-test.myshopify.com` or just `autoaeo-test`).
4. You'll be redirected to Shopify, see the install screen with the requested scopes, and click **Install**.
5. Shopify redirects back to AutoAEO and the store appears on your dashboard.

You're connected. The audit page is the launchpad for playbooks.

## Notes

- **Why a dev store first**: full Admin API access, $0/month, no real customers can buy. When you're ready, point AutoAEO at a real store by going through the same connect flow with that store's domain.
- **Going past localhost**: when you deploy AutoAEO somewhere public (Vercel, Fly, etc.), update both `NEXT_PUBLIC_APP_URL` in env and the **App URL** + **Allowed redirection URL** in your Partner app config. OAuth requires an exact match.
- **Rotating secrets**: regenerating `ENCRYPTION_KEY` invalidates all stored Shopify access tokens (users would need to reinstall). Don't do it unless you mean to.
- **Resetting the local DB**: `rm local.db && npm run db:push`.
