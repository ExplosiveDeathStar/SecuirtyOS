/**
 * Auth routes: signup, login, logout, and current user.
 */
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { ZodError, z } from "zod";
import { authService } from "../services/authService.js";
import type { SubscriptionPlan, User } from "../types.js";

const SESSION_COOKIE = "securityos_session";
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 3600;

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((part) => {
      const [rawKey, ...rawValue] = part.trim().split("=");
      return [rawKey ?? "", decodeURIComponent(rawValue.join("="))];
    }),
  );
}

function sessionToken(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

function setSessionCookie(res: Response, token: string): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}${secure}`,
  );
}

function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

const planSchema = z.enum(["monthly", "yearly"]);

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  plan: planSchema.default("monthly"),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const authRouter = Router();

authRouter.post("/signup", (req, res) => {
  try {
    const parsed = signupSchema.parse(req.body);
    const result = authService.createUser({
      email: parsed.email,
      password: parsed.password,
      plan: parsed.plan as SubscriptionPlan,
    });
    setSessionCookie(res, result.token);
    res.status(201).json({ user: result.user });
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({ error: err.issues[0]?.message ?? "Invalid input" });
      return;
    }
    const message = err instanceof Error && err.message.includes("UNIQUE")
      ? "An account with that email already exists"
      : "Could not create account";
    res.status(400).json({ error: message });
  }
});

authRouter.post("/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const result = authService.login(parsed.data);
  if (!result) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  setSessionCookie(res, result.token);
  res.json({ user: result.user });
});

authRouter.post("/logout", (req, res) => {
  authService.logout(sessionToken(req));
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", (req, res) => {
  const user = authService.userForToken(sessionToken(req));
  res.json({ user });
});

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = authService.userForToken(sessionToken(req));
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  req.user = user;
  next();
}

/** Owners always have access; customers must have an active Stripe subscription. */
export function requirePaidAccess(req: Request, res: Response, next: NextFunction): void {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (user.role === "owner" || user.billingStatus === "active") {
    next();
    return;
  }
  res.status(402).json({
    error: "An active subscription is required",
    billingStatus: user.billingStatus,
  });
}
