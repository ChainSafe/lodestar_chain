import bls from "@chainsafe/bls";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks} from "@chainsafe/lodestar-types";
import {getDomain} from "./domain";
import {computeEpochAtSlot} from "./epoch";
import {computeSigningRoot} from "./signingRoot";

export function verifyBlockSignature(
  config: IBeaconConfig,
  state: allForks.BeaconState,
  signedBlock: allForks.SignedBeaconBlock
): boolean {
  const epochSig = computeEpochAtSlot(config, signedBlock.message.slot);
  const domain = getDomain(config, state, config.params.DOMAIN_BEACON_PROPOSER, epochSig);
  const blockType = config.getForkTypes(signedBlock.message.slot).BeaconBlock;
  const signingRoot = computeSigningRoot(config, blockType, signedBlock.message, domain);
  const proposer = state.validators[signedBlock.message.proposerIndex];
  return bls.verify(
    proposer.pubkey.valueOf() as Uint8Array,
    signingRoot,
    signedBlock.signature.valueOf() as Uint8Array
  );
}
