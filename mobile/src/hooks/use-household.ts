import {
  acceptHouseholdInvite,
  fetchHousehold,
  fetchPendingHouseholdInvites,
  inviteToHousehold,
  leaveHousehold,
  removeHouseholdMember,
  renameHousehold,
  revokeHouseholdInvite
} from "@/api/household";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export const householdKeys = {
  me: ["household", "me"] as const,
  pendingInvites: ["household", "pending-invites"] as const
};

export function useHousehold() {
  return useQuery({
    queryKey: householdKeys.me,
    queryFn: fetchHousehold
  });
}

export function usePendingHouseholdInvites() {
  return useQuery({
    queryKey: householdKeys.pendingInvites,
    queryFn: fetchPendingHouseholdInvites
  });
}

export function useHouseholdMutations() {
  const queryClient = useQueryClient();
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["household"] });
    await queryClient.invalidateQueries({ queryKey: ["recipes"] });
    await queryClient.invalidateQueries({ queryKey: ["plans"] });
    await queryClient.invalidateQueries({ queryKey: ["grocery"] });
  };

  return {
    rename: useMutation({
      mutationFn: renameHousehold,
      onSuccess: invalidate
    }),
    leave: useMutation({
      mutationFn: leaveHousehold,
      onSuccess: invalidate
    }),
    removeMember: useMutation({
      mutationFn: removeHouseholdMember,
      onSuccess: invalidate
    }),
    invite: useMutation({
      mutationFn: () => inviteToHousehold(),
      onSuccess: invalidate
    }),
    revokeInvite: useMutation({
      mutationFn: revokeHouseholdInvite,
      onSuccess: invalidate
    }),
    acceptInvite: useMutation({
      mutationFn: acceptHouseholdInvite,
      onSuccess: invalidate
    })
  };
}
