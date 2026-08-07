import { truncateText } from './format.js';

export function buildPushPayload(title: string): { title: string } {
  return { title: truncateText(title, 40) };
}
