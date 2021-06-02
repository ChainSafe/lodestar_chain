import {verifyAggregate} from "@chainsafe/bls";
import {altair, ssz} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";
import {DOMAIN_SYNC_COMMITTEE} from "@chainsafe/lodestar-params";

import {
  computeEpochAtSlot,
  computeSigningRoot,
  getBlockRootAtSlot,
  getDomain,
  increaseBalance,
  zipIndexesInBitList,
} from "../../util";
import {CachedBeaconState} from "../../allForks/util";
import {BitList, isTreeBacked, TreeBacked} from "@chainsafe/ssz";

export function processSyncCommittee(
  state: CachedBeaconState<altair.BeaconState>,
  aggregate: altair.SyncAggregate,
  verifySignatures = true
): void {
  const {epochCtx} = state;
  const {syncParticipantReward, syncProposerReward} = epochCtx;
  const previousSlot = Math.max(state.slot, 1) - 1;
  const committeeIndices = state.currSyncCommitteeIndexes;
  // the only time aggregate is not a TreeBacked is when producing a new block
  const participantIndices = isTreeBacked(aggregate)
    ? zipIndexesInBitList(
        committeeIndices,
        aggregate.syncCommitteeBits as TreeBacked<BitList>,
        ssz.altair.SyncCommitteeBits
      )
    : committeeIndices.filter((index) => !!aggregate.syncCommitteeBits[index]);
  const participantPubkeys = participantIndices.map((validatorIndex) => state.validators[validatorIndex].pubkey);
  const domain = getDomain(state, DOMAIN_SYNC_COMMITTEE, computeEpochAtSlot(previousSlot));
  const signingRoot = computeSigningRoot(ssz.Root, getBlockRootAtSlot(state, previousSlot), domain);
  // different from the spec but not sure how to get through signature verification for default/empty SyncAggregate in the spec test
  if (verifySignatures && participantIndices.length > 0) {
    assert.true(
      verifyAggregate(
        participantPubkeys.map((pubkey) => pubkey.valueOf() as Uint8Array),
        signingRoot,
        aggregate.syncCommitteeSignature.valueOf() as Uint8Array
      ),
      "Sync committee signature invalid"
    );
  }

  const proposerIndex = epochCtx.getBeaconProposer(state.slot);
  for (const participantIndex of participantIndices) {
    increaseBalance(state, participantIndex, syncParticipantReward);
  }
  increaseBalance(state, proposerIndex, syncProposerReward * BigInt(participantIndices.length));
}
