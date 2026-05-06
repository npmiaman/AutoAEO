import type { Playbook } from "../types";
import { machineLayerPlaybook } from "./machine-layer";
import { schemaMarkupPlaybook } from "./schema-markup";
import { adaptiveMachineLayerPlaybook } from "./adaptive-machine-layer";
import { siteCrawlAuditPlaybook } from "./site-crawl-audit";
import { internalLinkingPlaybook } from "./internal-linking";
import { descriptionRewriterPlaybook } from "./description-rewriter";
import { altTextGeneratorPlaybook } from "./alt-text-generator";
import { faqGeneratorPlaybook } from "./faq-generator";

// Ordered roughly by the GEO funnel:
//   1. Technical GEO (Pillar 1) — Discovery / Access
//   2. Content GEO   (Pillar 2) — Understanding / Inclusion
export const PLAYBOOKS: Playbook[] = [
  // Pillar 1 — Technical GEO
  siteCrawlAuditPlaybook,
  machineLayerPlaybook,
  schemaMarkupPlaybook,
  internalLinkingPlaybook,
  // Pillar 2 — Content GEO
  descriptionRewriterPlaybook,
  altTextGeneratorPlaybook,
  faqGeneratorPlaybook,
  adaptiveMachineLayerPlaybook,
];

export function getPlaybook(id: string): Playbook | undefined {
  return PLAYBOOKS.find((p) => p.id === id);
}
