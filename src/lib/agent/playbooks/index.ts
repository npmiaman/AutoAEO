import type { Playbook } from "../types";
import { machineLayerPlaybook } from "./machine-layer";
import { schemaMarkupPlaybook } from "./schema-markup";
import { adaptiveMachineLayerPlaybook } from "./adaptive-machine-layer";

export const PLAYBOOKS: Playbook[] = [
  machineLayerPlaybook,
  schemaMarkupPlaybook,
  adaptiveMachineLayerPlaybook,
];

export function getPlaybook(id: string): Playbook | undefined {
  return PLAYBOOKS.find((p) => p.id === id);
}
