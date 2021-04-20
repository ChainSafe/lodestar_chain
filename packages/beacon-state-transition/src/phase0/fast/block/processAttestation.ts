import {List} from "@chainsafe/ssz";
import {allForks, phase0, Root} from "@chainsafe/lodestar-types";
import {computeEpochAtSlot, getBlockRootAtSlot} from "../../../util";
import {CachedBeaconState} from "../../../fast";
import {isValidIndexedAttestation} from "./isValidIndexedAttestation";
import {IInclusionData} from "../../../fast/util/inclusionData";
import {IParticipationStatus} from "../../../fast/util/cachedEpochParticipation";

export function processAttestation(
  state: CachedBeaconState<phase0.BeaconState>,
  attestation: phase0.Attestation,
  verifySignature = true
): void {
  const {config, epochCtx} = state;
  const {MIN_ATTESTATION_INCLUSION_DELAY, SLOTS_PER_EPOCH} = config.params;
  const slot = state.slot;
  const data = attestation.data;
  const attIndex = data.index;
  const attSlot = data.slot;
  const targetEpoch = data.target.epoch;
  const committeeCount = epochCtx.getCommitteeCountAtSlot(attSlot);
  if (!(attIndex < committeeCount)) {
    throw new Error(
      "Attestation committee index not within current committee count: " +
        `committeeIndex=${attIndex} committeeCount=${committeeCount}`
    );
  }
  if (!(targetEpoch === epochCtx.previousShuffling.epoch || targetEpoch === epochCtx.currentShuffling.epoch)) {
    throw new Error(
      "Attestation target epoch not in previous or current epoch: " +
        `targetEpoch=${targetEpoch} currentEpoch=${epochCtx.currentShuffling.epoch}`
    );
  }
  const computedEpoch = computeEpochAtSlot(config, attSlot);
  if (!(targetEpoch === computedEpoch)) {
    throw new Error(
      "Attestation target epoch does not match epoch computed from slot: " +
        `targetEpoch=${targetEpoch} computedEpoch=${computedEpoch}`
    );
  }
  if (!(attSlot + MIN_ATTESTATION_INCLUSION_DELAY <= slot && slot <= attSlot + SLOTS_PER_EPOCH)) {
    throw new Error(
      "Attestation slot not within inclusion window: " +
        `slot=${attSlot} window=${attSlot + MIN_ATTESTATION_INCLUSION_DELAY}..${attSlot + SLOTS_PER_EPOCH}`
    );
  }

  const committee = epochCtx.getBeaconCommittee(attSlot, attIndex);
  if (attestation.aggregationBits.length !== committee.length) {
    throw new Error(
      "Attestation aggregation bits length does not match committee length: " +
        `aggregationBitsLength=${attestation.aggregationBits.length} committeeLength=${committee.length}`
    );
  }

  // An FFG vote (the source/target) is always for the previous or current epoch checkpoint
  // Downstream logic is relative to the previous or current checkpoint

  // These are part of the state
  let justifiedCheckpoint: phase0.Checkpoint, epochAttestations: List<phase0.PendingAttestation>;

  if (targetEpoch === epochCtx.currentShuffling.epoch) {
    // current
    justifiedCheckpoint = state.currentJustifiedCheckpoint;
    epochAttestations = state.currentEpochAttestations;
  } else {
    // previous
    justifiedCheckpoint = state.previousJustifiedCheckpoint;
    epochAttestations = state.previousEpochAttestations;
  }

  const isMatchingSource = config.types.phase0.Checkpoint.equals(data.source, justifiedCheckpoint);
  if (!isMatchingSource) {
    throw new Error(
      "Attestation source does not equal justified checkpoint: " +
        `source=${config.types.phase0.Checkpoint.toJson(data.source)} ` +
        `justifiedCheckpoint=${config.types.phase0.Checkpoint.toJson(justifiedCheckpoint)}`
    );
  }

  const indexedAttestation = epochCtx.getIndexedAttestation(attestation);
  if (
    !isValidIndexedAttestation(state as CachedBeaconState<allForks.BeaconState>, indexedAttestation, verifySignature)
  ) {
    throw new Error("Attestation is not valid");
  }

  const inclusionDelay = slot - attSlot;
  const proposerIndex = epochCtx.getBeaconProposer(slot);
  const pendingAttestation = {
    data: data,
    aggregationBits: attestation.aggregationBits,
    inclusionDelay,
    proposerIndex,
  };

  // This doesn't update the state, just state caches
  // It performs the function to altair's up-front participation tracking
  //processAttestationParticipation(state, epochParticipation, epochInclusion, pendingAttestation);

  // Add the PendingAttestation to the state
  // During epoch processing, we will rely on our participation cache to update balances, etc. instead of these attestations
  // However, we need to still include them here to maintain consensus (keep the same hashTreeRoot)
  epochAttestations.push(config.types.phase0.PendingAttestation.createTreeBackedFromStruct(pendingAttestation));
}

export function processAttestationParticipation(
  state: CachedBeaconState<phase0.BeaconState>,
  epochParticipation: IParticipationStatus[],
  epochInclusion: IInclusionData[],
  attestation: phase0.PendingAttestation,
  targetRoot: Root,
  isPreviousEpoch: boolean
): void {
  const {config, epochCtx} = state;
  const data = attestation.data;

  // The source and target votes are part of the FFG vote, the head vote is part of the fork choice vote
  // Both are tracked to properly incentivise validators
  //
  // The source vote always matches the justified checkpoint (else its invalid) (already checked)
  // The target vote should match the most recent checkpoint (eg: the first root of the epoch)
  // The head vote should match the root at the attestation slot (eg: the root at data.slot)
  const isMatchingTarget = config.types.Root.equals(data.target.root, targetRoot);
  // a timely head is only be set if the target is _also_ matching
  const isMatchingHead =
    config.types.Root.equals(data.beaconBlockRoot, getBlockRootAtSlot(config, state, data.slot)) && isMatchingTarget;

  // Retrieve the validator indices from the attestation participation bitfield
  const attestingIndices = epochCtx.getAttestingIndices(attestation.data, attestation.aggregationBits);

  // For each participant, update their participation and 'inclusion data'
  // In epoch processing, this participation info is used to calculate balance updates

  // In phase0, attestation participation is tracked, but not stored in the state
  // In altair and beyond, attestation participation is marked in the state

  // Inclusion data is whats necessary to calculate inclusion delay rewards at epoch processing time.
  // This is only necessary in phase0
  const inclusionDelay = attestation.inclusionDelay;
  const proposerIndex = attestation.proposerIndex;

  for (const index of attestingIndices) {
    const status = epochParticipation[index];
    const newStatus = {
      // a timely head is only be set if the target is _also_ matching
      timelyHead: isMatchingHead || status.timelyHead,
      timelySource: true,
      timelyTarget: isMatchingTarget || status.timelyTarget,
    };
    epochParticipation[index] = newStatus;

    // inclusion data is only relevant for the previous epoch
    if (isPreviousEpoch) {
      const inclusionData = epochInclusion[index];
      const isLowerInclusionDelay = !inclusionData.inclusionDelay || inclusionDelay < inclusionData.inclusionDelay;
      if (isLowerInclusionDelay) {
        epochInclusion[index] = {inclusionDelay, proposerIndex};
      }
    }
  }
}
