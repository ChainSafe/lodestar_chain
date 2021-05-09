import {SecretKey} from "@chainsafe/bls";
import {
  computeEpochAtSlot,
  computeSyncPeriodAtSlot,
  interopSecretKey,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {toHexString, TreeBacked} from "@chainsafe/ssz";
import {altair, BLSPubkey, Epoch, Root, Slot, SyncPeriod} from "@chainsafe/lodestar-types";
import {FinalizedCheckpointData, LightClientUpdater, LightClientUpdaterDb} from "../src/server/LightClientUpdater";
import {toBlockHeader} from "../src/utils/utils";
import {getSyncAggregateSigningRoot, signAndAggregate} from "./utils";
import {startLightclientApiServer, IStateRegen, ServerOpts} from "./lightclientApiServer";

type SyncCommitteeKeys = {
  sks: SecretKey[];
  pks: BLSPubkey[];
};

export class LightclientMockServer {
  private readonly lightClientUpdater: LightClientUpdater;
  private readonly stateRegen: MockStateRegen;

  // Mock chain state
  private readonly syncCommitteesKeys = new Map<SyncPeriod, SyncCommitteeKeys>();
  private readonly checkpoints = new Map<Epoch, {block: altair.BeaconBlock; state: altair.BeaconState}>();
  private readonly stateCache = new Map<string, TreeBacked<altair.BeaconState>>();
  private finalizedCheckpoint: altair.Checkpoint | null = null;
  private prevBlock: altair.BeaconBlock | null = null;

  constructor(private readonly config: IBeaconConfig, private readonly genesisValidatorsRoot: Root) {
    const db = getLightClientUpdaterDb();
    this.lightClientUpdater = new LightClientUpdater(config, db);
    this.stateRegen = new MockStateRegen(this.stateCache);
  }

  async startApiServer(opts: ServerOpts): Promise<void> {
    await startLightclientApiServer(opts, {
      config: this.config,
      lightClientUpdater: this.lightClientUpdater,
      stateRegen: this.stateRegen,
    });
  }

  createNewBlock(slot: Slot): void {
    // Create a block and postState
    const block = this.config.types.altair.BeaconBlock.defaultValue();
    const state = this.config.types.altair.BeaconState.defaultTreeBacked();
    block.slot = slot;
    state.slot = slot;

    // Set committeeKeys to static set
    const currentSyncPeriod = computeSyncPeriodAtSlot(this.config, slot);
    state.currentSyncCommittee.pubkeys = this.getSyncCommittee(currentSyncPeriod).pks;
    state.nextSyncCommittee.pubkeys = this.getSyncCommittee(currentSyncPeriod + 1).pks;
    console.log({
      currentSyncPeriod,
      currentSyncCommittee: this.getSyncCommittee(currentSyncPeriod).pks.map(toHexString),
      nextSyncCommittee: this.getSyncCommittee(currentSyncPeriod + 1).pks.map(toHexString),
    });

    // Point to rolling finalized state
    if (this.finalizedCheckpoint) {
      state.finalizedCheckpoint = this.finalizedCheckpoint;
    }

    // Add sync aggregate signing over last block
    if (this.prevBlock) {
      const attestedBlock = toBlockHeader(this.config, this.prevBlock);
      const attestedBlockRoot = this.config.types.altair.BeaconBlock.hashTreeRoot(this.prevBlock);
      state.blockRoots[(slot - 1) % this.config.params.SLOTS_PER_HISTORICAL_ROOT] = attestedBlockRoot;
      const forkVersion = state.fork.currentVersion;
      const signingRoot = getSyncAggregateSigningRoot(
        this.config,
        this.genesisValidatorsRoot,
        forkVersion,
        attestedBlock
      );
      block.body.syncAggregate = signAndAggregate(signingRoot, this.getSyncCommittee(currentSyncPeriod).sks);
    }

    block.stateRoot = this.config.types.altair.BeaconState.hashTreeRoot(state);

    // Store new prevBlock
    this.prevBlock = block;

    // Simulate finalizing a state
    if ((slot + 1) % this.config.params.SLOTS_PER_EPOCH === 0) {
      this.checkpoints.set(computeEpochAtSlot(this.config, slot + 1), {block, state});
      this.stateCache.set(toHexString(state.hashTreeRoot()), state);

      const finalizedEpoch = computeEpochAtSlot(this.config, slot) - 2;
      const finalizedData = this.checkpoints.get(finalizedEpoch);
      if (finalizedData) {
        this.finalizedCheckpoint = {
          epoch: finalizedEpoch,
          root: this.config.types.altair.BeaconBlock.hashTreeRoot(finalizedData.block),
        };

        // Feed new finalized block and state to the LightClientUpdater
        this.lightClientUpdater.onFinalized(
          this.finalizedCheckpoint,
          finalizedData.block,
          this.config.types.altair.BeaconState.createTreeBackedFromStruct(finalizedData.state)
        );
      }

      // Prune old checkpoints
      for (const oldEpoch of this.checkpoints.keys()) {
        // Keep current finalized checkpoint and previous
        if (oldEpoch < finalizedEpoch - 1) {
          this.checkpoints.delete(oldEpoch);
        }
      }

      // Prune old states
      for (const [key, oldState] of this.stateCache.entries()) {
        if (computeEpochAtSlot(this.config, oldState.slot) < finalizedEpoch - 1) {
          this.stateCache.delete(key);
        }
      }
    }

    // Feed new block and state to the LightClientUpdater
    this.lightClientUpdater.onHead(block, this.config.types.altair.BeaconState.createTreeBackedFromStruct(state));
  }

  private getSyncCommittee(period: SyncPeriod): SyncCommitteeKeys {
    let syncCommitteeKeys = this.syncCommitteesKeys.get(period);
    if (!syncCommitteeKeys) {
      const fromIndex = period * this.config.params.SYNC_COMMITTEE_SIZE;
      const toIndex = (period + 1) * this.config.params.SYNC_COMMITTEE_SIZE;
      const sks: SecretKey[] = [];
      for (let i = fromIndex; i < toIndex; i++) {
        sks.push(interopSecretKey(i));
      }
      syncCommitteeKeys = {sks, pks: sks.map((sk) => sk.toPublicKey().toBytes())};
      this.syncCommitteesKeys.set(period, syncCommitteeKeys);
    }
    return syncCommitteeKeys;
  }
}

/**
 * Mock state regen that only checks an in-memory cache
 */
class MockStateRegen implements IStateRegen {
  constructor(private readonly stateCache: Map<string, TreeBacked<altair.BeaconState>>) {}

  async getStateByRoot(stateRoot: string): Promise<TreeBacked<altair.BeaconState>> {
    const state = this.stateCache.get(stateRoot);
    if (!state) throw Error(`State not available ${stateRoot}`);
    return state;
  }
}

function getLightClientUpdaterDb(): LightClientUpdaterDb {
  const lightclientFinalizedCheckpoint = new Map<Epoch, FinalizedCheckpointData>();
  const bestUpdatePerCommitteePeriod = new Map<number, altair.LightClientUpdate>();
  let latestFinalizedUpdate: altair.LightClientUpdate | null = null;
  let latestNonFinalizedUpdate: altair.LightClientUpdate | null = null;
  return {
    lightclientFinalizedCheckpoint: {
      put: (key, data) => lightclientFinalizedCheckpoint.set(key, data),
      get: (key) => lightclientFinalizedCheckpoint.get(key) ?? null,
    },
    bestUpdatePerCommitteePeriod: {
      put: (key, data) => bestUpdatePerCommitteePeriod.set(key, data),
      get: (key) => bestUpdatePerCommitteePeriod.get(key) ?? null,
    },
    latestFinalizedUpdate: {
      put: (data) => (latestFinalizedUpdate = data),
      get: () => latestFinalizedUpdate,
    },
    latestNonFinalizedUpdate: {
      put: (data) => (latestNonFinalizedUpdate = data),
      get: () => latestNonFinalizedUpdate,
    },
  };
}
