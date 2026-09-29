/**
 * GET  /api/holidays — list leave requests.
 *                      Employee → only their own. Admin → everyone's.
 *                      Optional filters: ?from=YYYY-MM-DD&to=YYYY-MM-DD,
 *                      ?month=YYYY-MM, ?userId= (admin only), ?status=
 *
 * POST /api/holidays — body { action } variants:
 *     { action: "request", startDate, endDate, kind, reason, halfDay? }
 *         Any signed-in user books time off. Lands as PENDING and
 *         notifies every active admin.
 *
 *     { action: "approve", id, note? }
 *         Admin only. Stamps decidedAt/By and notifies the owner
 *         (bell + email).
 *
 *     { action: "reject", id, note }
 *         Admin only. Requires a note so the employee knows why.
 *
 *     { action: "cancel", id }
 *         Owner (while PENDING, or APPROVED and not yet started) or
 *         admin at any time. Notifies the other side.
 *
 *     { action: "delete", id }
 *         Owner or admin. Removes the record outright.
 *
 * Combined into one route to stay under Vercel Hobby's serverless
 * function cap — same reasoning as /api/queries.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth } from "./_lib/auth.js";
import {
  listHolidays,
  listHolidaysForUser,
  findHoliday,
  upsertHoliday,
  removeHoliday,
  listUsers,
  findUserById,
} from "./_lib/db.js";
import {
  readBody, ok, badRequest, methodNotAllowed, nowIso, uuid,
} from "./_lib/helpers.js";
import { notifyUser } from "./_lib/notify.js";
import { accountUpdateEmail } from "./_lib/email.js";
import type { Holiday, HolidayKind, HolidayStatus, User } from "./_lib/types.js";

const VALID_KINDS: HolidayKind[] = ["ANNUAL", "UNPAID", "SICK", "EMERGENCY", "OTHER"];

/** Planned leave reads as a "holiday"; the rest as an "absence". */
function categoryOf(kind: HolidayKind): "holiday" | "absence" {
  return kind === "ANNUAL" || kind === "UNPAID" ? "holiday" : "absence";
}
const VALID_STATUSES: HolidayStatus[] = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];

/** Longest span we'll accept in one request — a guard against typos. */
const MAX_SPAN_DAYS = 90;

const KIND_LABEL: Record<HolidayKind, string> = {
  ANNUAL: "Annual leave",
  UNPAID: "Unpaid leave",
  SICK: "Sick",
  EMERGENCY: "Emergency / personal",
  OTHER: "Other absence",
};

function appUrl(): string {
  return (process.env.APP_URL || "https://kubegraf.io/timesheet").replace(/\/$/, "");
}

/* ── Date helpers ─────────────────────────────────────────────
 * Everything here works on plain YYYY-MM-DD strings, parsed as UTC
 * midnight. Using UTC keeps the working-day count identical no matter
 * which timezone the serverless function happens to run in — a local
 * `new Date("2026-09-23")` would shift the weekday for anyone west of
 * UTC and silently miscount weekends.
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function isValidYmd(s: unknown): s is string {
  if (typeof s !== "string" || !YMD.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (isNaN(d.getTime())) return false;
  // Round-trip guard so "2026-02-31" is rejected rather than rolled over.
  return d.toISOString().slice(0, 10) === s;
}

function daysBetweenInclusive(startYmd: string, endYmd: string): number {
  const a = Date.parse(`${startYmd}T00:00:00Z`);
  const b = Date.parse(`${endYmd}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Working days (Mon–Fri) in an inclusive YYYY-MM-DD range. */
function countWorkingDays(startYmd: string, endYmd: string): number {
  let count = 0;
  const cur = new Date(`${startYmd}T00:00:00Z`);
  const end = Date.parse(`${endYmd}T00:00:00Z`);
  while (cur.getTime() <= end) {
    const dow = cur.getUTCDay(); // 0 Sun … 6 Sat
    if (dow !== 0 && dow !== 6) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

/** Two inclusive ranges overlap when each starts on or before the other ends. */
function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** A request still "holds" a slot unless it was rejected or cancelled. */
function isLive(h: Holiday): boolean {
  return h.status === "PENDING" || h.status === "APPROVED";
}

function describeRange(h: Holiday): string {
  if (h.startDate === h.endDate) {
    return h.halfDay ? `${h.startDate} (half day)` : h.startDate;
  }
  return `${h.startDate} → ${h.endDate}`;
}

/** Ping every active admin except the actor. Never blocks the mutation. */
async function pingAdmins(opts: {
  actor: User;
  kind: "holiday-requested" | "holiday-cancelled";
  title: string;
  body: string;
}): Promise<void> {
  const admins = (await listUsers()).filter(
    (u) => u.role === "ADMIN" && u.active && u.id !== opts.actor.id,
  );
  await Promise.all(
    admins.map((a) =>
      notifyUser({
        to: a,
        kind: opts.kind,
        title: opts.title,
        body: opts.body,
        link: "/planner",
        from: { id: opts.actor.id, name: opts.actor.name, email: opts.actor.email },
      }).catch((err) => console.warn("[holidays] admin ping failed:", err)),
    ),
  );
}

interface PostBody {
  action?: "request" | "approve" | "reject" | "cancel" | "delete";
  id?: string;
  startDate?: string;
  endDate?: string;
  kind?: HolidayKind;
  reason?: string;
  halfDay?: boolean;
  note?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const me = await requireAuth(req, res);
  if (!me) return;

  /* ── GET — list ────────────────────────────────────────────── */
  if (req.method === "GET") {
    let items = me.role === "ADMIN" ? await listHolidays() : await listHolidaysForUser(me.id);

    // userId is admin-only; employees are already scoped to themselves.
    const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
    if (userId && me.role === "ADMIN") items = items.filter((h) => h.userId === userId);

    const month = typeof req.query.month === "string" ? req.query.month : undefined;
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;

    // Range filters match anything that *touches* the window, so a
    // holiday spanning a month boundary shows up in both months.
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const first = `${month}-01`;
      const lastDay = new Date(Date.parse(`${first}T00:00:00Z`));
      lastDay.setUTCMonth(lastDay.getUTCMonth() + 1);
      lastDay.setUTCDate(0);
      const last = lastDay.toISOString().slice(0, 10);
      items = items.filter((h) => rangesOverlap(h.startDate, h.endDate, first, last));
    }
    if (from && isValidYmd(from)) items = items.filter((h) => h.endDate >= from);
    if (to && isValidYmd(to)) items = items.filter((h) => h.startDate <= to);
    if (status && VALID_STATUSES.includes(status as HolidayStatus)) {
      items = items.filter((h) => h.status === status);
    }

    return ok(res, { holidays: items });
  }

  if (req.method !== "POST") return methodNotAllowed(res);

  const body = readBody<PostBody>(req);

  /* ── request — any signed-in user ──────────────────────────── */
  if (body.action === "request") {
    const { startDate, endDate } = body;
    if (!isValidYmd(startDate)) return badRequest(res, "startDate must be a valid YYYY-MM-DD date");
    if (!isValidYmd(endDate)) return badRequest(res, "endDate must be a valid YYYY-MM-DD date");
    if (endDate < startDate) return badRequest(res, "endDate can't be before startDate");
    if (daysBetweenInclusive(startDate, endDate) > MAX_SPAN_DAYS) {
      return badRequest(res, `A single request can't span more than ${MAX_SPAN_DAYS} days`);
    }
    if (!body.kind || !VALID_KINDS.includes(body.kind)) {
      return badRequest(res, "kind must be one of ANNUAL/SICK/UNPAID/OTHER");
    }

    const halfDay = body.halfDay === true && startDate === endDate;
    const workingDays = countWorkingDays(startDate, endDate);
    if (workingDays === 0) {
      return badRequest(res, "That range is all weekend — pick at least one working day");
    }

    // Reject double-booking against the user's own live requests.
    const mine = await listHolidaysForUser(me.id);
    const clash = mine.find(
      (h) => isLive(h) && rangesOverlap(startDate, endDate, h.startDate, h.endDate),
    );
    if (clash) {
      return badRequest(
        res,
        `That overlaps a ${clash.status.toLowerCase()} request you already have (${describeRange(clash)})`,
      );
    }

    const now = nowIso();
    const h: Holiday = {
      id: uuid(),
      userId: me.id,
      userName: me.name || "",
      userEmail: me.email,
      startDate,
      endDate,
      halfDay,
      kind: body.kind,
      reason: (body.reason || "").trim().slice(0, 500),
      status: "PENDING",
      days: halfDay ? 0.5 : workingDays,
      createdAt: now,
      updatedAt: now,
      decidedAt: null,
      decidedBy: null,
      decidedByName: null,
      decisionNote: "",
    };
    await upsertHoliday(h);

    await pingAdmins({
      actor: me,
      kind: "holiday-requested",
      title: `${categoryOf(h.kind) === "holiday" ? "Holiday" : "Absence"} request — ${h.userName || h.userEmail}`,
      body: `${KIND_LABEL[h.kind]} · ${describeRange(h)} · ${h.days} day${h.days === 1 ? "" : "s"}`,
    });

    return ok(res, { holiday: h }, 201);
  }

  /* ── approve / reject — admin only ─────────────────────────── */
  if (body.action === "approve" || body.action === "reject") {
    if (me.role !== "ADMIN") return res.status(403).json({ error: "Admin only" });
    if (!body.id) return badRequest(res, "id required");

    const approving = body.action === "approve";
    if (!approving && !body.note?.trim()) {
      return badRequest(res, "A reason is required when rejecting a request");
    }

    const h = await findHoliday(body.id);
    if (!h) return badRequest(res, "Request not found");
    if (h.status === "CANCELLED") {
      return badRequest(res, "That request was cancelled — nothing to decide");
    }

    const now = nowIso();
    h.status = approving ? "APPROVED" : "REJECTED";
    h.decidedAt = now;
    h.decidedBy = me.id;
    h.decidedByName = me.name || me.email;
    h.decisionNote = (body.note || "").trim().slice(0, 500);
    h.updatedAt = now;
    await upsertHoliday(h);

    const owner = await findUserById(h.userId);
    if (owner) {
      const noun = categoryOf(h.kind);
      const headline = approving
        ? `Your ${noun} request was approved`
        : `Your ${noun} request was declined`;
      const detail =
        `${KIND_LABEL[h.kind]} · ${describeRange(h)} (${h.days} day${h.days === 1 ? "" : "s"}) ` +
        `was ${approving ? "approved" : "declined"} by ${h.decidedByName}.` +
        (h.decisionNote ? ` Note: ${h.decisionNote}` : "");

      await notifyUser({
        to: owner,
        kind: approving ? "holiday-approved" : "holiday-rejected",
        title: headline,
        body: detail,
        link: "/my-planner",
        from: { id: me.id, name: me.name, email: me.email },
        email: accountUpdateEmail({
          to: owner.email,
          recipientName: owner.name,
          actorName: h.decidedByName || me.email,
          headline,
          detail,
          appUrl: appUrl(),
          ctaLabel: "Open my planner",
          ctaHref: `${appUrl()}/my-planner`,
        }),
      });
    }

    return ok(res, { holiday: h });
  }

  /* ── cancel — owner (before it starts) or admin ────────────── */
  if (body.action === "cancel") {
    if (!body.id) return badRequest(res, "id required");
    const h = await findHoliday(body.id);
    if (!h) return badRequest(res, "Request not found");

    const isOwner = h.userId === me.id;
    const isAdmin = me.role === "ADMIN";
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: "You can only cancel your own requests" });
    }
    if (h.status === "CANCELLED") return ok(res, { holiday: h }); // idempotent
    if (h.status === "REJECTED") {
      return badRequest(res, "That request was already declined");
    }
    // An employee can withdraw their own booking right up to the day it
    // starts; once it's underway only an admin can unwind it.
    if (isOwner && !isAdmin && h.startDate < nowIso().slice(0, 10)) {
      return badRequest(res, "That holiday has already started — ask an admin to cancel it");
    }

    const now = nowIso();
    const wasApproved = h.status === "APPROVED";
    h.status = "CANCELLED";
    h.updatedAt = now;
    if (isAdmin && !isOwner) {
      h.decidedAt = now;
      h.decidedBy = me.id;
      h.decidedByName = me.name || me.email;
      h.decisionNote = (body.note || "").trim().slice(0, 500);
    }
    await upsertHoliday(h);

    if (isOwner) {
      // Employee withdrew — let the admins know the slot is free again.
      await pingAdmins({
        actor: me,
        kind: "holiday-cancelled",
        title: `${categoryOf(h.kind) === "holiday" ? "Holiday" : "Absence"} cancelled — ${h.userName || h.userEmail}`,
        body: `${KIND_LABEL[h.kind]} · ${describeRange(h)}${wasApproved ? " (was approved)" : ""}`,
      });
    } else {
      // Admin unwound someone else's booking — tell the owner.
      const owner = await findUserById(h.userId);
      if (owner) {
        const detail =
          `${KIND_LABEL[h.kind]} · ${describeRange(h)} was cancelled by ${h.decidedByName}.` +
          (h.decisionNote ? ` Note: ${h.decisionNote}` : "");
        await notifyUser({
          to: owner,
          kind: "holiday-cancelled",
          title: `Your ${categoryOf(h.kind)} request was cancelled`,
          body: detail,
          link: "/my-planner",
          from: { id: me.id, name: me.name, email: me.email },
          email: accountUpdateEmail({
            to: owner.email,
            recipientName: owner.name,
            actorName: h.decidedByName || me.email,
            headline: `Your ${categoryOf(h.kind)} request was cancelled`,
            detail,
            appUrl: appUrl(),
            ctaLabel: "Open my planner",
            ctaHref: `${appUrl()}/my-planner`,
          }),
        });
      }
    }

    return ok(res, { holiday: h });
  }

  /* ── delete — owner or admin ───────────────────────────────── */
  if (body.action === "delete") {
    if (!body.id) return badRequest(res, "id required");
    const h = await findHoliday(body.id);
    if (!h) return ok(res, { success: true }); // idempotent
    if (h.userId !== me.id && me.role !== "ADMIN") {
      return res.status(403).json({ error: "You can only delete your own requests" });
    }
    await removeHoliday(body.id);
    return ok(res, { success: true });
  }

  return badRequest(res, "Unknown action");
}
