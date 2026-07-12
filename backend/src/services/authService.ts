/**
 * Auth Service — local email/password accounts and session cookies.
 *
 * This is enough for a commercial MVP: users can sign up, choose a plan,
 * log in, and keep a secure HTTP-only session. Actual payment collection
 * should be wired through Stripe Checkout + webhooks next.
 */
import crypto from "node:crypto";
import { getDb } from "../db/index.js";
import type { BillingStatus, SubscriptionPlan, User, UserRole } from "../types.js";

const SESSION_TTL_DAYS = 30;
const PASSWORD_KEY_LEN = 64;
const PLATFORM_OWNER_EMAIL = "ryan@loancater.com";

interface UserRow {
  id: string;
  email: string;
  site_id: string;
  password_hash: string;
  plan: SubscriptionPlan;
  role: UserRole;
  billing_status: BillingStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = crypto.scryptSync(password, salt, PASSWORD_KEY_LEN).toString("hex");
  return `scrypt:${salt}:${key}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [, salt, expectedHex] = stored.split(":");
  if (!salt || !expectedHex) return false;
  const actual = crypto.scryptSync(password, salt, PASSWORD_KEY_LEN);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    siteId: row.site_id,
    plan: row.plan,
    role: row.role,
    billingStatus: row.billing_status,
    currentPeriodEnd: row.current_period_end,
    createdAt: row.created_at,
  };
}

function sessionExpiry(): string {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000).toISOString();
}

export const authService = {
  createUser(input: { email: string; password: string; plan: SubscriptionPlan }): { user: User; token: string } {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const email = normalizeEmail(input.email);
    const passwordHash = hashPassword(input.password);
    const owner = email === PLATFORM_OWNER_EMAIL;
    const siteId = owner ? "legacy-site" : crypto.randomUUID();

    db.transaction(() => {
      if (!owner) {
        db.prepare(`INSERT INTO sites (id, name, created_by, created_at) VALUES (?, ?, ?, ?)`)
          .run(siteId, "My Site", id, now);
      }
      db.prepare(
        `INSERT INTO users (id, email, password_hash, plan, role, billing_status, site_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        email,
        passwordHash,
        input.plan,
        owner ? "owner" : "customer",
        owner ? "active" : "incomplete",
        siteId,
        now,
        now,
      );
    })();

    const user = this.getUser(id);
    if (!user) throw new Error("User creation failed");
    return { user, token: this.createSession(id) };
  },

  login(input: { email: string; password: string }): { user: User; token: string } | null {
    const row = getDb()
      .prepare(`SELECT * FROM users WHERE email = ?`)
      .get(normalizeEmail(input.email)) as UserRow | undefined;
    if (!row || !verifyPassword(input.password, row.password_hash)) return null;
    return { user: toUser(row), token: this.createSession(row.id) };
  },

  createSession(userId: string): string {
    const token = crypto.randomBytes(32).toString("base64url");
    getDb()
      .prepare(`INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`)
      .run(crypto.randomUUID(), userId, hashSessionToken(token), new Date().toISOString(), sessionExpiry());
    return token;
  },

  userForToken(token: string | null | undefined): User | null {
    if (!token) return null;
    const row = getDb()
      .prepare(
        `SELECT u.*
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(hashSessionToken(token), new Date().toISOString()) as UserRow | undefined;
    return row ? toUser(row) : null;
  },

  logout(token: string | null | undefined): void {
    if (!token) return;
    getDb().prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashSessionToken(token));
  },

  getUser(id: string): User | null {
    const row = getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
    return row ? toUser(row) : null;
  },

  getUserBilling(id: string): UserRow | null {
    return (getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined) ?? null;
  },

  getUserByStripeCustomer(customerId: string): User | null {
    const row = getDb()
      .prepare(`SELECT * FROM users WHERE stripe_customer_id = ?`)
      .get(customerId) as UserRow | undefined;
    return row ? toUser(row) : null;
  },

  setStripeCustomer(userId: string, customerId: string): void {
    getDb()
      .prepare(`UPDATE users SET stripe_customer_id = ?, updated_at = ? WHERE id = ?`)
      .run(customerId, new Date().toISOString(), userId);
  },

  updateBilling(input: {
    userId: string;
    status: BillingStatus;
    subscriptionId?: string | null;
    currentPeriodEnd?: string | null;
    plan?: SubscriptionPlan;
  }): void {
    const row = this.getUserBilling(input.userId);
    if (!row || row.role === "owner") return;
    getDb()
      .prepare(
        `UPDATE users
         SET billing_status = ?, stripe_subscription_id = ?, current_period_end = ?,
             plan = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.status,
        input.subscriptionId === undefined ? row.stripe_subscription_id : input.subscriptionId,
        input.currentPeriodEnd === undefined ? row.current_period_end : input.currentPeriodEnd,
        input.plan ?? row.plan,
        new Date().toISOString(),
        input.userId,
      );
  },
};
