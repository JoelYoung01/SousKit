export interface HouseholdMember {
  user_id: number;
  role: "owner" | "member" | string;
  joined_on: string;
  display_name: string;
  email: string;
  avatar_url?: string | null;
}

export interface HouseholdInvite {
  id: number;
  email?: string | null;
  status: string;
  created_on: string;
  expires_on: string;
  invited_by_id: number;
  token?: string | null;
  invite_url?: string | null;
}

export interface Household {
  id: number;
  name: string;
  created_by_id: number;
  created_on: string;
  my_role: "owner" | "member" | string;
  member_count: number;
  max_members: number;
  members: HouseholdMember[];
  pending_invites: HouseholdInvite[];
}

export interface PendingHouseholdInvite {
  id: number;
  household_id: number;
  household_name: string;
  invited_by_name: string;
  token: string;
  invite_url?: string | null;
  created_on: string;
  expires_on: string;
}
