/**
 * PATCH  /api/time-entries/:id   — edit one entry. Admins anyone; users own only.
 * DELETE /api/time-entries/:id   — admin or owner.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth } from "../_lib/auth.js";
import {
  listEntriesForUser,
  listAllEntries,
  upsertEntry,
  removeEntry,
} from "../_lib/db.js";
import {
  nowIso,
  diffMinutes,
  readBody,
  ok,
  badRequest,
  notFound,
  methodNotAllowed,
} from "../_lib/helpers.js";
import { notifyAdmin, notifyUser } from "../_lib/notify.js";
import { accountUpdateEmail } from "../_lib/email.js";
import { findUserById } from "../_lib/db.js";

function appUrl(): string {
  return (process.env.APP_URL || "https://internal-time-sheet.vercel.app").replace(/\/$/, "");
}
import type { TimeEntry } from "../_lib/types.js";

interface PatchBody {
  taskId?: string | null;
  description?: string;
  startedAt?: string;
  endedAt?: string | null;
  /** Admin-only: acknowledge the clock-in or clock-out moment of this
   *  entry. Sets the corresponding fields on the entry and pings the
   *  entry's owner via the notification bell. Pass null to revoke. */
  ack?: "clock-in" | "clock-out" | null;
}

async function findEntry(id: string, viewerId: string, viewerIsAdmin: boolean): Promise<TimeEntry | null> {
  if (viewerIsAdmin) {
    const all = await listAllEntries();
    return all.find((e) => e.id === id) ?? null;
  }
  const mine = await listEntriesForUser(viewerId);
  return mine.find((e) => e.id === id) ?? null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = String(req.query.id || "");
  if (!id) return badRequest(res, "id required");

  const me = await requireAuth(req, res);
  if (!me) return;

  if (req.method === "PATCH") {
    const e = await findEntry(id, me.id, me.role === "ADMIN");
    if (!e) return notFound(res, "Entry not found");
    if (me.role !== "ADMIN" && e.userId !== me.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const body = readBody<PatchBody>(req);

    /* ── Admin acknowledgement path ──────────────────────────────
     *  Stamps clock-in / clock-out as acknowledged, then pings the
     *  entry's owner via notifyUser so the bell lights up in their
     *  portal. This is mutually exclusive with field edits: ack
     *  requests don't touch description / startedAt / etc., which
     *  keeps the audit trail clean. */
    if (body.ack !== undefined) {
      if (me.role !== "ADMIN") {
        res.status(403).json({ error: "Admin only" });
        return;
      }
      const now = nowIso();
      const next: TimeEntry = { ...e, updatedAt: now };
      let kind: "clock-in-acknowledged" | "clock-out-acknowledged" | null = null;
      let momentLabel = "";

      if (body.ack === "clock-in") {
        next.clockInAckedAt = now;
        next.clockInAckedBy = me.id;
        next.clockInAckedByName = me.name || me.email;
        kind = "clock-in-acknowledged";
        momentLabel = "clock-in";
      } else if (body.ack === "clock-out") {
        if (!e.endedAt) return badRequest(res, "Entry has not been clocked out yet");
        next.clockOutAckedAt = now;
        next.clockOutAckedBy = me.id;
        next.clockOutAckedByName = me.name || me.email;
        kind = "clock-out-acknowledged";
        momentLabel = "clock-out";
      } else if (body.ack === null) {
        // Revoke ack on both moments
        next.clockInAckedAt = null;
        next.clockInAckedBy = null;
        next.clockInAckedByName = null;
        next.clockOutAckedAt = null;
        next.clockOutAckedBy = null;
        next.clockOutAckedByName = null;
      } else {
        return badRequest(res, "Invalid ack value");
      }

      await upsertEntry(next);

      if (kind && next.userId !== me.id) {
        // Ping the entry's owner via the bell + email. Best-effort.
        try {
          const owner = await findUserById(next.userId);
          if (owner) {
            const startedDisplay = next.startedAt;
            const headline = kind === "clock-in-acknowledged"
              ? "Your clock-in was acknowledged"
              : "Your clock-out was acknowledged";
            const detail = kind === "clock-in-acknowledged"
              ? `Your clock-in at ${startedDisplay} has been reviewed and acknowledged by ${me.name || me.email}.`
              : `Your clock-out for the entry started at ${startedDisplay} has been reviewed and acknowledged by ${me.name || me.email}.`;
            const link = `${appUrl()}/timesheet`;
            const tpl = accountUpdateEmail({
              to: owner.email,
              recipientName: owner.name,
              actorName: me.name || me.email,
              headline,
              detail,
              appUrl: appUrl(),
              ctaLabel: "View timesheet",
              ctaHref: link,
            });
            await notifyUser({
              to: owner,
              kind,
              title: `${me.name || me.email} acknowledged your ${momentLabel}`,
              body: detail,
              link: "/timesheet",
              from: { id: me.id, name: me.name || me.email, email: me.email },
              email: { subject: tpl.subject, text: tpl.text, html: tpl.html },
            });
          }
        } catch (err) {
          console.warn("[time-entries] ack notify failed:", err);
        }
      }

      return ok(res, { entry: next });
    }

    const diff: Record<string, string> = {};
    const next: TimeEntry = { ...e, updatedAt: nowIso() };

    if (body.taskId !== undefined) {
      diff.taskId = `${e.taskId ?? "—"} → ${body.taskId ?? "—"}`;
      next.taskId = body.taskId;
    }
    if (typeof body.description === "string") {
      next.description = body.description.trim();
      diff.description = "updated";
    }
    if (body.startedAt) {
      diff.startedAt = `${e.startedAt} → ${body.startedAt}`;
      next.startedAt = body.startedAt;
    }
    if (body.endedAt !== undefined) {
      diff.endedAt = `${e.endedAt ?? "—"} → ${body.endedAt ?? "—"}`;
      next.endedAt = body.endedAt;
    }
    next.durationMinutes = next.endedAt ? diffMinutes(next.startedAt, next.endedAt) : 0;

    if (Object.keys(diff).length === 0) return badRequest(res, "No allowed changes");

    await upsertEntry(next);

    await notifyAdmin({
      subject: "Time entry updated",
      summary: `${me.name} updated a time entry.`,
      details: {
        EntryId: e.id,
        ...diff,
        Started: next.startedAt,
        Ended: next.endedAt ?? "(in progress)",
        Minutes: next.durationMinutes,
      },
      byUser: me,
    });

    return ok(res, { entry: next });
  }

  if (req.method === "DELETE") {
    const e = await findEntry(id, me.id, me.role === "ADMIN");
    if (!e) return notFound(res, "Entry not found");
    if (me.role !== "ADMIN" && e.userId !== me.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    await removeEntry(e.userId, e.id);
    await notifyAdmin({
      subject: "Time entry deleted",
      summary: `${me.name} deleted a time entry.`,
      details: { EntryId: e.id, Started: e.startedAt, Ended: e.endedAt ?? "—" },
      byUser: me,
    });
    return ok(res, { success: true });
  }

  return methodNotAllowed(res);
}
