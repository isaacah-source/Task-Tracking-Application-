import type { ExternalContact, ExternalOrganization, ProjectInvolvement, RelationshipTracker } from "./adapter";

/** Sample contacts using the tracker's real relationship types. All names are fictional. */
export const MOCK_CONTACTS: ExternalContact[] = [
  { externalId: "C-1001", name: "Sample Reviewer A", title: "Senior Fellow", organization: "Sample University Lab", relationshipType: "Research/Institutional Partners", email: "reviewer.a@example.org" },
  { externalId: "C-1002", name: "Sample Staffer B", title: "Professional Staff", organization: "Sample Senate Committee", relationshipType: "Congress", email: "staffer.b@example.org" },
  { externalId: "C-1003", name: "Sample Policy Lead C", title: "Head of Policy", organization: "Sample AI Lab", relationshipType: "AI Labs", email: "policy.c@example.org" },
  { externalId: "C-1004", name: "Sample Editor", title: "Opinion Editor", organization: "Sample Daily", relationshipType: "Media", email: "editor@example.org" },
  { externalId: "C-1005", name: "Sample Official D", title: "Director", organization: "Sample Defense Office", relationshipType: "Policy/NatSec/Gov", email: "official.d@example.org" },
  { externalId: "C-1006", name: "Sample Reporter E", title: "Technology Reporter", organization: "Sample Wire", relationshipType: "Media", email: "reporter.e@example.org" },
  { externalId: "C-1007", name: "Sample Diplomat F", title: "Counselor", organization: "Sample Embassy", relationshipType: "International Gov/Diplomatic", email: "diplomat.f@example.org" },
  { externalId: "C-1008", name: "Sample Engineer G", title: "Security Lead", organization: "Sample Cloud Co.", relationshipType: "AI Labs", email: "engineer.g@example.org" },
];

export const MOCK_ORGANIZATIONS: ExternalOrganization[] = [
  { externalId: "O-2001", name: "Sample Defense Office", relationshipType: "Policy/NatSec/Gov" },
  { externalId: "O-2002", name: "Sample AI Lab", relationshipType: "AI Labs" },
  { externalId: "O-2003", name: "Sample University Lab", relationshipType: "Research/Institutional Partners" },
  { externalId: "O-2004", name: "Sample Daily", relationshipType: "Media" },
];

/** In-memory stand-in for the Relationship Tracker. Remembers what was pushed to it. */
export class MockRelationshipTracker implements RelationshipTracker {
  readonly name = "Relationship Tracker (mock)";
  /** Latest involvement per contact+project, as the tracker would hold it. */
  readonly received = new Map<string, ProjectInvolvement>();

  constructor(
    private contacts: ExternalContact[] = MOCK_CONTACTS,
    private organizations: ExternalOrganization[] = MOCK_ORGANIZATIONS,
  ) {}

  async listContacts() {
    return structuredClone(this.contacts);
  }

  async listOrganizations() {
    return structuredClone(this.organizations);
  }

  async pushInvolvement(items: ProjectInvolvement[]) {
    for (const i of items) this.received.set(`${i.externalId}:${i.projectId}`, { ...i });
    return { accepted: items.length };
  }

  /** Test helper: simulate someone renaming a contact in the tracker. */
  rename(externalId: string, name: string, organization?: string) {
    const c = this.contacts.find((x) => x.externalId === externalId);
    if (c) {
      c.name = name;
      if (organization) c.organization = organization;
    }
  }
}
