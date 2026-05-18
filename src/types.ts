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
