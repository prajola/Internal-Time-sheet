/**
 * Shared types across API + frontend.
 *
 * The frontend can import these via the `~lib/types` alias; the API
 * routes import via relative path. Both compile under the same tsconfig.
 */

export type Role = "ADMIN" | "EMPLOYEE";

export interface User {
  id: string;             // uuid
  email: string;          // unique, lowercased
  name: string;
  role: Role;
  active: boolean;
  createdAt: string;      // ISO
  invitedBy?: string;     // userId of inviter
  passwordHash?: string | null;   // bcrypt hash; null until first set
  passwordSetAt?: string | null;  // ISO — when password was first set or last changed
  sessionsRevokedAt?: string | null; // ISO — all sessions issued before this are invalid
}

export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "BLOCKED";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH";

export interface Task {
  id: string;
  title: string;
  description: string;
  assigneeId: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;       // ISO date (YYYY-MM-DD)
  createdAt: string;            // ISO datetime
  updatedAt: string;
  createdBy: string;            // userId
}

export interface TimeEntry {
  id: string;
  userId: string;
  taskId: string | null;
  description: string;
  startedAt: string;            // ISO datetime — when work began
  endedAt: string | null;       // null = currently clocked-in
  durationMinutes: number;      // computed once endedAt is set
  createdAt: string;
  updatedAt: string;
}

export interface Invitation {
  id: string;                   // also used as magic-link token suffix
  email: string;                // lowercased
  role: Role;
  invitedBy: string;            // userId
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
}

/**
 * In-app notification (the bell-icon list).
 *
 * Stored per-recipient so reads are cheap. Each one represents a single
 * event the user might want to see — task assigned to them, status
 * change on a task they created, account change applied by an admin,
 * etc. We keep the body small and link the user to wherever they should
 * land next via `link`.
 */
export type NotificationKind =
  | "task-assigned"
  | "task-updated"
  | "task-status-changed"
  | "task-deleted"
  | "account-role-changed"
  | "account-disabled"
  | "account-enabled"
  | "account-password-reset"
  | "account-force-signout"
  | "clock-in"
  | "clock-out"
  | "query-raised"
  | "query-responded"
  | "query-status-changed";

export interface Notification {
  id: string;
  userId: string;          // recipient — the inbox owner
  kind: NotificationKind;
  title: string;
  body: string;
  link?: string | null;    // optional href to navigate to on click
  taskId?: string | null;
  fromUserId?: string | null;
  fromUserName?: string | null;
  readAt?: string | null;  // ISO; null = unread
  createdAt: string;       // ISO
}

/**
 * Support query / help ticket raised by an employee.
 *
 * Employees create these from the "Raise a query" form (anything from
 * "can't log in" to "this task is blocked"). Admins see the full inbox
 * across all users, can change status, and post a single response.
 *
 * Kept deliberately simple — one round-trip Q+A (no chat thread). If
 * back-and-forth is needed, the employee raises a new query and links
 * to the prior one in the body.
 */
export type QueryCategory = "PORTAL" | "TECHNICAL" | "TASK" | "OTHER";
export type QueryStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

export interface SupportQuery {
  id: string;
  userId: string;                // who raised it
  userName: string;              // cached for display so the admin list doesn't have to join
  userEmail: string;             // cached for display
  category: QueryCategory;
  subject: string;
  body: string;
  status: QueryStatus;
  taskId: string | null;         // optional link to a related task
  createdAt: string;
  updatedAt: string;
  adminResponse: string;         // empty until admin responds
  respondedAt: string | null;
  respondedBy: string | null;    // admin userId
  respondedByName: string | null;
}

/** Session payload signed into the cookie JWT. */
export interface SessionClaims {
  sub: string;                  // userId
  email: string;
  role: Role;
  iat: number;
  exp: number;
}

/** Short-lived magic-link claims (kept for back-compat — unused). */
export interface MagicLinkClaims {
  email: string;
  nonce: string;
  iat: number;
  exp: number;
}

/** Password-setup / password-reset token claims. 24-hour TTL. */
export interface SetupTokenClaims {
  email: string;                // lowercased
  purpose: "setup" | "reset";   // copy hint only — same flow
  nonce: string;                // random per-link, single-use enforced
  iat: number;
  exp: number;
}
