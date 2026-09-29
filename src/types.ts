export type Role = "ADMIN" | "EMPLOYEE";
export type TaskStatus = "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt: string;
  invitedBy?: string | null;
  passwordHash?: string | null;     // never sent over the wire; server strips it
  passwordSetAt?: string | null;    // ISO — null means user hasn't set a password yet
  sessionsRevokedAt?: string | null;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  assigneeId: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface TimeEntry {
  id: string;
  userId: string;
  taskId: string | null;
  description: string;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number;
  createdAt: string;
  updatedAt: string;
  /** Admin acknowledgement of the clock-in / clock-out moments. */
  clockInAckedAt?: string | null;
  clockInAckedBy?: string | null;
  clockInAckedByName?: string | null;
  clockOutAckedAt?: string | null;
  clockOutAckedBy?: string | null;
  clockOutAckedByName?: string | null;
}

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
  | "clock-in-acknowledged"
  | "clock-out-acknowledged"
  | "query-raised"
  | "query-responded"
  | "query-status-changed"
  | "holiday-requested"
  | "holiday-approved"
  | "holiday-rejected"
  | "holiday-cancelled";

export interface Notification {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link?: string | null;
  taskId?: string | null;
  fromUserId?: string | null;
  fromUserName?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string | null;
}

export type QueryCategory = "PORTAL" | "TECHNICAL" | "TASK" | "OTHER";
export type QueryStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

export interface SupportQuery {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  category: QueryCategory;
  subject: string;
  body: string;
  status: QueryStatus;
  taskId: string | null;
  createdAt: string;
  updatedAt: string;
  adminResponse: string;
  respondedAt: string | null;
  respondedBy: string | null;
  respondedByName: string | null;
}

/**
 * Two categories of time off, distinguished by `holidayCategory()`:
 *   planned  — ANNUAL, UNPAID      → "holiday"
 *   unplanned — SICK, EMERGENCY, OTHER → "absence"
 * Both follow the same request/approve flow; the split only
 * changes how they are labelled and counted.
 */
export type HolidayKind =
  | "ANNUAL" | "UNPAID"                 // planned holiday
  | "SICK" | "EMERGENCY" | "OTHER";     // unplanned absence
export type HolidayStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface Holiday {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  startDate: string;        // YYYY-MM-DD, inclusive
  endDate: string;          // YYYY-MM-DD, inclusive
  halfDay: boolean;
  kind: HolidayKind;
  reason: string;
  status: HolidayStatus;
  days: number;             // working days (0.5 for a half day)
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decisionNote: string;
}
