import { truncateText } from './format.js';

export function summarizeComment(body: string): string {
  return truncateText(body, 140);
}
