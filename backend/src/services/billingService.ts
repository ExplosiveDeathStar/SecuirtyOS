/**
 * Stripe billing: Checkout, customer portal, and subscription webhooks.
 *
 * No payment secret is committed. Live billing becomes available only when
 * the required STRIPE_* variables are configured on the backend.
 */
import Stripe from "stripe";
import { config } from "../config.js";
import type { BillingStatus, SubscriptionPlan, User } from "../types.js";
import { authService } from "./authService.js";

let stripeClient: Stripe | null = null;

function stripe(): Stripe {
  if (!config.stripeSecretKey) {
    throw new Error("Stripe is not configured");
  }
  stripeClient ??= new Stripe(config.stripeSecretKey);
  return stripeClient;
}

function priceFor(plan: SubscriptionPlan): string {
  const price = plan === "yearly" ? config.stripeYearlyPriceId : config.stripeMonthlyPriceId;
  if (!price) throw new Error(`Stripe ${plan} price is not configured`);
  return price;
}

function configured(): boolean {
  return Boolean(
    config.stripeSecretKey &&
      config.stripeWebhookSecret &&
      config.stripeMonthlyPriceId &&
      config.stripeYearlyPriceId,
  );
}

function billingStatus(status: Stripe.Subscription.Status): BillingStatus {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due" || status === "unpaid" || status === "paused") return "past_due";
  if (status === "canceled") return "canceled";
  return "incomplete";
}

function currentPeriodEnd(subscription: Stripe.Subscription): string | null {
  const latest = Math.max(
    0,
    ...subscription.items.data.map((item) => item.current_period_end ?? 0),
  );
  return latest > 0 ? new Date(latest * 1000).toISOString() : null;
}

function planFromSubscription(subscription: Stripe.Subscription): SubscriptionPlan | undefined {
  const priceId = subscription.items.data[0]?.price.id;
  if (priceId === config.stripeYearlyPriceId) return "yearly";
  if (priceId === config.stripeMonthlyPriceId) return "monthly";
  return undefined;
}

async function ensureCustomer(user: User): Promise<string> {
  const billing = authService.getUserBilling(user.id);
  if (billing?.stripe_customer_id) return billing.stripe_customer_id;
  const customer = await stripe().customers.create({
    email: user.email,
    metadata: { securityosUserId: user.id },
  });
  authService.setStripeCustomer(user.id, customer.id);
  return customer.id;
}

function userIdForSubscription(subscription: Stripe.Subscription): string | null {
  return subscription.metadata.securityosUserId || null;
}

async function syncSubscription(subscription: Stripe.Subscription): Promise<void> {
  let userId = userIdForSubscription(subscription);
  if (!userId && typeof subscription.customer === "string") {
    userId = authService.getUserByStripeCustomer(subscription.customer)?.id ?? null;
  }
  if (!userId) return;
  authService.updateBilling({
    userId,
    status: billingStatus(subscription.status),
    subscriptionId: subscription.id,
    currentPeriodEnd: currentPeriodEnd(subscription),
    plan: planFromSubscription(subscription),
  });
}

export const billingService = {
  isConfigured: configured,

  async createCheckout(user: User, plan: SubscriptionPlan): Promise<string> {
    if (user.role === "owner") return `${config.appUrl}/`;
    const customer = await ensureCustomer(user);
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price: priceFor(plan), quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${config.appUrl}/?billing=success`,
      cancel_url: `${config.appUrl}/signup?billing=canceled`,
      client_reference_id: user.id,
      metadata: { securityosUserId: user.id, plan },
      subscription_data: {
        metadata: { securityosUserId: user.id, plan },
      },
    });
    if (!session.url) throw new Error("Stripe did not return a Checkout URL");
    return session.url;
  },

  async createPortal(user: User): Promise<string> {
    const customer = await ensureCustomer(user);
    const session = await stripe().billingPortal.sessions.create({
      customer,
      return_url: `${config.appUrl}/`,
    });
    return session.url;
  },

  constructWebhook(payload: Buffer, signature: string): Stripe.Event {
    if (!config.stripeWebhookSecret) throw new Error("Stripe webhook secret is not configured");
    return stripe().webhooks.constructEvent(payload, signature, config.stripeWebhookSecret);
  },

  async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (typeof session.subscription === "string") {
          await syncSubscription(await stripe().subscriptions.retrieve(session.subscription));
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(event.data.object);
        break;
      default:
        break;
    }
  },
};
