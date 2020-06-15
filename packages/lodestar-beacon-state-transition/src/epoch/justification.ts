/**
 * @module chain/stateTransition/epoch
 */

import {BeaconState} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {GENESIS_EPOCH} from "../constants";
import {getBlockRoot, getCurrentEpoch, getPreviousEpoch, getTotalActiveBalance} from "../util";

import {getAttestingBalance, getMatchingTargetAttestations} from "./util";


export function processJustificationAndFinalization(
  config: IBeaconConfig,
  state: BeaconState
): void {
  const currentEpoch = getCurrentEpoch(config, state);
  if(currentEpoch <= GENESIS_EPOCH + 1n) {
    return;
  }
  const previousEpoch = getPreviousEpoch(config, state);
  const oldPreviousJustifiedCheckpoint = state.previousJustifiedCheckpoint;
  const oldCurrentJustifiedCheckpoint = state.currentJustifiedCheckpoint;
  const bits = state.justificationBits;

  // Process justifications
  state.previousJustifiedCheckpoint = state.currentJustifiedCheckpoint;
  // Rotate the justification bitfield up one epoch to make room for the current epoch
  for (let i = bits.length - 1; i >= 1; i--) {
    bits[i] = bits[i-1];
  }
  bits[0] = false;
  const totalActiveBalance = getTotalActiveBalance(config, state);

  // If the previous epoch gets justified, fill the second last bit
  const previousEpochMatchingTargetBalance =
    getAttestingBalance(config, state, getMatchingTargetAttestations(config, state, previousEpoch));
  if (previousEpochMatchingTargetBalance * 3n >= (totalActiveBalance * 2n)) {
    state.currentJustifiedCheckpoint = {
      epoch: previousEpoch,
      root: getBlockRoot(config, state, previousEpoch),
    };
    bits[1] = true;
  }
  // If the current epoch gets justified, fill the last bit
  const currentEpochMatchingTargetBalance =
    getAttestingBalance(config, state, getMatchingTargetAttestations(config, state, currentEpoch));
  if (currentEpochMatchingTargetBalance * 3n >= (totalActiveBalance * 2n)) {
    state.currentJustifiedCheckpoint = {
      epoch: currentEpoch,
      root: getBlockRoot(config, state, currentEpoch),
    };
    bits[0] = true;
  }
  state.justificationBits = bits;

  // Process finalizations
  // The 2nd/3rd/4th most recent epochs are all justified, the 2nd using the 4th as source
  if (
    bits[1] && bits[2] && bits[3] &&
    oldPreviousJustifiedCheckpoint.epoch + 3n === currentEpoch
  ) {
    state.finalizedCheckpoint = oldPreviousJustifiedCheckpoint;
  }
  // The 2nd/3rd most recent epochs are both justified, the 2nd using the 3rd as source
  if (
    bits[1] && bits[2] &&
    oldPreviousJustifiedCheckpoint.epoch + 2n === currentEpoch
  ) {
    state.finalizedCheckpoint = oldPreviousJustifiedCheckpoint;
  }
  // The 1st/2nd/3rd most recent epochs are all justified, the 1st using the 3rd as source
  if (
    bits[0] && bits[1] && bits[2] &&
    oldCurrentJustifiedCheckpoint.epoch + 2n === currentEpoch
  ) {
    state.finalizedCheckpoint = oldCurrentJustifiedCheckpoint;
  }
  // The 1st/2nd most recent epochs are both justified, the 1st using the 2nd as source
  if (
    bits[0] && bits[1] &&
    oldCurrentJustifiedCheckpoint.epoch + 1n === currentEpoch
  ) {
    state.finalizedCheckpoint = oldCurrentJustifiedCheckpoint;
  }
}
