// Runs the two-way sync. Pull: refresh names and organizations on linked contacts from the
// tracker. Push: send every project-contact link (and any removed since last time) to the
// tracker so it can show which FSI projects involve each contact.

import type { DataSet, ID, RelationshipLink } from "@/domain/types";
import { STATUS_LABELS } from "@/domain/types";
import type { ProjectInvolvement, RelationshipTracker } from "./adapter";

export interface SyncResult {
  updated: number;
  pushed: number;
  missing: string[];
  at: string;
}

/** Where this app lives, for links back to a project. Empty in tests. */
export function appBaseUrl(): string {
  return typeof window === "undefined" ? "" : new URL(import.meta.env.BASE_URL, window.location.origin).href;
}

export function involvementFor(data: DataSet, links: RelationshipLink[] = data.relationshipLinks, baseUrl = appBaseUrl()): ProjectInvolvement[] {
  return links.map((l) => {
    const p = data.projects.find((x) => x.id === l.projectId);
    const owner = data.people.find((x) => x.id === p?.ownerId);
    return {
      externalId: l.externalId,
      contactName: l.name,
      projectUrl: baseUrl ? `${baseUrl}projects/${l.projectId}` : "",
      projectId: l.projectId,
      projectTitle: p?.title ?? "",
      projectStatus: p ? STATUS_LABELS[p.status] : "",
      ownerEmail: owner?.email ?? "",
      role: l.note,
      active: true,
    };
  });
}

export async function syncRelationships(
  tracker: RelationshipTracker,
  data: DataSet,
  save: (id: ID, patch: Partial<RelationshipLink>) => Promise<void>,
  removed: ProjectInvolvement[] = [],
  now: () => Date = () => new Date(),
): Promise<SyncResult> {
  const at = now().toISOString();
  const [contacts, orgs] = await Promise.all([tracker.listContacts(), tracker.listOrganizations()]);
  const byId = new Map<string, { name: string; organization: string }>([
    ...contacts.map((c) => [c.externalId, { name: c.name, organization: c.organization }] as const),
    ...orgs.map((o) => [o.externalId, { name: o.name, organization: o.name }] as const),
  ]);

  let updated = 0;
  const missing: string[] = [];
  for (const link of data.relationshipLinks) {
    const src = byId.get(link.externalId);
    if (!src) {
      missing.push(link.name);
      continue;
    }
    const patch: Partial<RelationshipLink> = { syncedAt: at };
    if (src.name !== link.name) patch.name = src.name;
    if (src.organization !== link.organization) patch.organization = src.organization;
    if (patch.name || patch.organization) updated++;
    await save(link.id, patch);
  }

  const push = [...involvementFor(data), ...removed.map((r) => ({ ...r, active: false }))];
  const { accepted } = await tracker.pushInvolvement(push);
  return { updated, pushed: accepted, missing, at };
}

/**
 * Sends involvement changes to the tracker right away. If the tracker cannot be reached, the
 * changes wait in `queue` and go out with the next sync. Returns whether they were sent.
 */
export async function pushNow(tracker: RelationshipTracker, items: ProjectInvolvement[], queue: ProjectInvolvement[]): Promise<boolean> {
  try {
    await tracker.pushInvolvement(items);
    return true;
  } catch {
    queue.push(...items);
    return false;
  }
}
