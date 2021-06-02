import {allForks} from "@chainsafe/lodestar-types";
import {computeEpochAtSlot, computeSigningRoot, getDomain} from "../../util";
import {ISignatureSet, SignatureSetType, verifySignatureSet} from "../../util/signatureSets";
import {CachedBeaconState} from "../util";

export function verifyProposerSignature(
  state: CachedBeaconState<allForks.BeaconState>,
  signedBlock: allForks.SignedBeaconBlock
): boolean {
  const signatureSet = getProposerSignatureSet(state, signedBlock);
  return verifySignatureSet(signatureSet);
}

export function getProposerSignatureSet(
  state: CachedBeaconState<allForks.BeaconState>,
  signedBlock: allForks.SignedBeaconBlock
): ISignatureSet {
  const {config, epochCtx} = state;
  const epochSig = computeEpochAtSlot(config, signedBlock.message.slot);
  const domain = getDomain(config, state, config.params.DOMAIN_BEACON_PROPOSER, epochSig);

  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[signedBlock.message.proposerIndex],
    signingRoot: computeSigningRoot(
      config,
      config.getForkTypes(signedBlock.message.slot).BeaconBlock,
      signedBlock.message,
      domain
    ),
    signature: signedBlock.signature.valueOf() as Uint8Array,
  };
}
