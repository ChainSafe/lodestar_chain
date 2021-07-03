import {allForks, phase0} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "../../../chain";
import {IBeaconDb} from "../../../db";
import {onBeaconBlocksByRange} from "./beaconBlocksByRange";
import {onBeaconBlocksByRoot} from "./beaconBlocksByRoot";

export interface IReqRespHandler {
  onStatus(): AsyncIterable<phase0.Status>;
  onBeaconBlocksByRange(req: phase0.BeaconBlocksByRangeRequest): AsyncIterable<allForks.SignedBeaconBlock>;
  onBeaconBlocksByRoot(req: phase0.BeaconBlocksByRootRequest): AsyncIterable<allForks.SignedBeaconBlock>;
}

/**
 * The ReqRespHandler module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export function getReqRespHandlers({db, chain}: {db: IBeaconDb; chain: IBeaconChain}): IReqRespHandler {
  return {
    async *onStatus() {
      yield chain.getStatus();
    },

    async *onBeaconBlocksByRange(req) {
      yield* onBeaconBlocksByRange(req, chain, db);
    },

    async *onBeaconBlocksByRoot(req) {
      yield* onBeaconBlocksByRoot(req, chain, db);
    },
  };
}
