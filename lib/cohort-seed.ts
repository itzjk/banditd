export interface SeedableCreative {
  id: string;
  arm: { impressions: number; clicks: number };
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function cohortSeed(cohort: SeedableCreative[]): number {
  let hash = FNV_OFFSET;
  for (const c of cohort) {
    const token = `${c.id}:${c.arm.impressions}:${c.arm.clicks}|`;
    for (let i = 0; i < token.length; i++) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, FNV_PRIME);
    }
  }
  return hash >>> 0;
}
