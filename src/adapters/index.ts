import type { SiteAdapter } from './types';
import { deepseekAdapter } from './deepseek';
import { doubaoAdapter } from './doubao';

export const adapters: SiteAdapter[] = [doubaoAdapter, deepseekAdapter];

export function pickAdapter(url: URL): SiteAdapter | null {
  return adapters.find((a) => a.matches(url)) ?? null;
}

