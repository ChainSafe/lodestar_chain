import {BeaconState} from "@chainsafe/lodestar-types";
import {EpochContext} from "./epochContext";
import {IEpochProcess} from "./epochProcess";

export * from "./attestation";
export * from "./attesterStatus";
export * from "./block";
export * from "./epochContext";
export * from "./epochProcess";
export * from "./epochShuffling";
export * from "./epochStakeSummary";
export * from "./flatValidator";
export * from "./interface";

/**
 * Exchange Interface of StateContext
 */
export interface IStateContext {
  state: BeaconState;
  epochCtx: EpochContext;
  epochProcess?: IEpochProcess;
}
