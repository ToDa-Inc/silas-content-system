import { randomBytes } from "crypto";

/**
 * Prefixed opaque IDs (Signalcore-style): `prefix` + base64url(random bytes).
 * Matches `backend/core/id_generator.py` (length=8 bytes after prefix).
 *
 * `profiles.id` / `organization_members.user_id` stay UUID (Supabase Auth); all other app-owned PKs use these.
 */

function generateKey(lengthBytes: number, prefix: string): string {
  const key = randomBytes(lengthBytes).toString("base64url").replace(/=+$/g, "");
  return `${prefix}${key}`;
}

export function newOrgId(): string {
  return generateKey(8, "org_");
}

export function newClientId(): string {
  return generateKey(8, "cli_");
}

export function newMemberId(): string {
  return generateKey(8, "mbr_");
}

export function newJobId(): string {
  return generateKey(8, "job_");
}

export function newCompetitorId(): string {
  return generateKey(8, "cmp_");
}

export function newReelId(): string {
  return generateKey(8, "srl_");
}

export function newBaselineId(): string {
  return generateKey(8, "cbl_");
}

/** @deprecated Use newOrgId / newClientId / newMemberId as appropriate. */
export function newPrimaryKey(): string {
  return newOrgId();
}
