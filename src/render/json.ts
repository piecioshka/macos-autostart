import type { CollectResult } from '../types.js';

export function renderJson(result: CollectResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
