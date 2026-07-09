export interface FontIdentity {
  family: string;
  weight: number;
}

/** Stable, collision-free key for a font family + weight identity. */
export function fontIdentityKey(identity: FontIdentity): string {
  return JSON.stringify([identity.family, identity.weight]);
}
