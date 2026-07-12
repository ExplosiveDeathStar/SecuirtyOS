/**
 * Stripe billing routes. The webhook router must be mounted before
 * express.json() so Stripe can verify the exact raw request body.
 */
import express, { Router } from "express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { billingService } from "../services/billingService.js";

export const billingWebhookRouter = Router();
export const billingRouter = Router();

billingWebhookRouter.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string") {
      res.status(400).json({ error: "Missing Stripe signature" });
      return;
    }
    try {
      const event = billingService.constructWebhook(req.body as Buffer, signature);
      await billingService.handleEvent(event);
      res.json({ received: true });
    } catch (err) {
      console.error("[stripe] webhook failed", err);
      res.status(400).json({ error: "Invalid Stripe webhook" });
    }
  },
);

billingRouter.get("/status", requireAuth, (req, res) => {
  res.json({
    configured: billingService.isConfigured(),
    user: req.user,
  });
});

billingRouter.post("/checkout", requireAuth, async (req, res) => {
  const parsed = z.object({ plan: z.enum(["monthly", "yearly"]) }).safeParse(req.body);
  if (!parsed.success || !req.user) {
    res.status(400).json({ error: "Invalid plan" });
    return;
  }
  try {
    res.json({ url: await billingService.createCheckout(req.user, parsed.data.plan) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not start checkout";
    res.status(503).json({ error: message });
  }
});

billingRouter.post("/portal", requireAuth, async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    res.json({ url: await billingService.createPortal(req.user) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not open billing portal";
    res.status(503).json({ error: message });
  }
});
