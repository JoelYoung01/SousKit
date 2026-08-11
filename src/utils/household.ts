import type { Household, HouseholdInvite, PendingHouseholdInvite } from "@/types";
import { del, get, patch, post } from "./api";

export function fetchHousehold(): Promise<Household> {
  return get<Household>("/household/");
}

export function renameHousehold(name: string): Promise<Household> {
  return patch<Household>("/household/", { name });
}

export function leaveHousehold(): Promise<Household> {
  return post<Household>("/household/leave/");
}

export function removeHouseholdMember(userId: number): Promise<void> {
  return del(`/household/members/${userId}/`);
}

/** Create a single-use join link / QR invite. */
export function inviteToHousehold(): Promise<HouseholdInvite> {
  return post<HouseholdInvite>("/household/invites/", {});
}

export function revokeHouseholdInvite(inviteId: number): Promise<void> {
  return del(`/household/invites/${inviteId}/`);
}

export function acceptHouseholdInvite(token: string): Promise<Household> {
  return post<Household>("/household/invites/accept/", { token });
}

export function fetchPendingHouseholdInvites(): Promise<PendingHouseholdInvite[]> {
  return get<PendingHouseholdInvite[]>("/household/invites/pending/");
}
