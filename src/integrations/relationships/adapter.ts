// Two-way link with FSI's Relationship Tracker (a separate app). This app pulls contacts and
// organizations from the tracker, and pushes back which projects each contact is involved
// in. The tracker has no API yet, so everything here goes through this interface; the mock
// in mock.ts stands in until a real adapter is written.

import type { RelationshipGroup } from "@/domain/types";

export interface ExternalContact {
  /** The tracker's Unique ID. */
  externalId: string;
  name: string;
  title: string;
  organization: string;
  /** Relationship Type as the tracker records it (for example "Policy/NatSec/Gov"). */
  relationshipType: string;
  email: string;
}

export interface ExternalOrganization {
  externalId: string;
  name: string;
  relationshipType: string;
}

/** What this app tells the tracker about one contact's involvement in one project. */
export interface ProjectInvolvement {
  externalId: string;
  projectId: string;
  projectTitle: string;
  projectStatus: string;
  ownerEmail: string;
  role: string;
  /** False when the contact was unlinked from the project. */
  active: boolean;
}

export interface RelationshipTracker {
  readonly name: string;
  listContacts(): Promise<ExternalContact[]>;
  listOrganizations(): Promise<ExternalOrganization[]>;
  pushInvolvement(items: ProjectInvolvement[]): Promise<{ accepted: number }>;
}

/**
 * Maps the tracker's relationship types onto this app's four groups. Types with no clear
 * group (Fellows, Board, Donors/Funders, ...) return null, and the person linking the
 * contact chooses the group.
 */
export function groupForType(relationshipType: string): RelationshipGroup | null {
  const t = relationshipType.toLowerCase();
  if (/policy|natsec|gov|congress|diplomatic/.test(t)) return "government";
  if (/ai labs|industry|company|corporate/.test(t)) return "industry";
  if (/research|institutional|academ|university|think tank/.test(t)) return "research";
  if (/media|press|journalis/.test(t)) return "media";
  return null;
}
