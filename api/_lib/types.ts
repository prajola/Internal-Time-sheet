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

/** Session payload signed into the cookie JWT. */
export interface SessionClaims {
  sub: string;                  // userId
  email: string;
  role: Role;
  iat: number;
  exp: number;
}

/** Short-lived magic-link claims. */
export interface MagicLinkClaims {
  email: string;                // lowercased
  nonce: string;                // random per-link
  iat: number;
  exp: number;
}
