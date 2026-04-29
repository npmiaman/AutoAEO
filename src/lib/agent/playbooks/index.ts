import type { Playbook } from "../types";
import { machineLayerPlaybook } from "./machine-layer";

export const PLAYBOOKS: Playbook[] = [machineLayerPlaybook];

export function getPlaybook(id: string): Playbook | undefined {
  return PLAYBOOKS.find((p) => p.id === id);
}
