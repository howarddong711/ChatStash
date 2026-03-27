import type { SiteAdapter } from './types';
import { deepseekAdapter } from './deepseek';
import { doubaoAdapter } from './doubao';
import { glmAdapter } from './glm';
import { kimiAdapter } from './kimi';

export const adapters: SiteAdapter[] = [doubaoAdapter, deepseekAdapter, kimiAdapter, glmAdapter];

export function pickAdapter(url: URL): SiteAdapter | null {
  return adapters.find((a) => a.matches(url)) ?? null;
}
