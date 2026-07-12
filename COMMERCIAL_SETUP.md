# SecurityOS commercial setup

## 1. Platform owner

`ryan@loancater.com` is the platform owner. That account has full access and
does not require a paid subscription. Do not hard-code any other owner emails.

## 2. Stripe live billing

In Stripe live mode:

1. Create a product named **SecurityOS**.
2. Add a recurring Price for **$10 USD monthly**.
3. Add a recurring Price for **$100 USD yearly**.
4. Enable the Stripe Customer Portal.
5. Add a webhook endpoint:
   `https://YOUR_BACKEND/api/billing/webhook`
6. Subscribe it to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
7. Copy `backend/.env.example` to `backend/.env` and fill in:

```dotenv
SECURITYOS_APP_URL=https://YOUR_APP
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_MONTHLY_ID=price_...
STRIPE_PRICE_YEARLY_ID=price_...
```

Never commit `backend/.env`. Checkout fails closed when configuration is
missing; unpaid customers cannot access cameras, people, events, or media.

## 3. Supabase hybrid control plane

Supabase is not linked automatically because linking requires your Supabase
account and project reference.

Create a Supabase project, then from the repository root:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Add the project values to `backend/.env`:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

The migration in `supabase/migrations/001_control_plane.sql` stores cloud
accounts, sites, memberships, and local-agent registrations. Raw video,
camera passwords, face embeddings, and inference remain on the local agent.
The service-role key is backend-only.

## 4. Customer camera connectivity

The current camera wizard supports:

- Generic RTSP URLs
- Reolink direct RTSP
- Reolink through the local Neolink bridge
- Amcrest
- Dahua
- Hikvision
- UniFi Protect RTSP URLs
- Local webcams and screen sources

For broad commercial adoption, ship a signed SecurityOS Local Agent for macOS,
Windows, and Linux. It should discover ONVIF cameras on the LAN, offer known
brand presets, test credentials locally, and create an outbound encrypted
connection to the customer's Supabase site. Customers should never expose
camera RTSP ports to the public internet.
