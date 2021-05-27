import {ContainerType} from "@chainsafe/ssz";
import {mapValues} from "@chainsafe/lodestar-utils";
import {ForkName, IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0, allForks, Slot, Root} from "@chainsafe/lodestar-types";
import {
  RoutesData,
  ReturnTypes,
  ArrayOf,
  ContainerData,
  RouteReqTypeGenerator,
  Schema,
  WithVersion,
  reqOnlyBody,
  TypeJson,
} from "../../utils";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type BlockId = "head" | "genesis" | "finalized" | string | number;

export type BlockHeaderResponse = {
  root: Root;
  canonical: boolean;
  header: phase0.SignedBeaconBlockHeader;
};

export type Api = {
  /**
   * Get block
   * Returns the complete `SignedBeaconBlock` for a given block ID.
   * Depending on the `Accept` header it can be returned either as JSON or SSZ-serialized bytes.
   *
   * @param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlock(blockId: BlockId): Promise<{data: allForks.SignedBeaconBlock}>;

  /**
   * Get block
   * Retrieves block details for given block id.
   * @param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlockV2(blockId: BlockId): Promise<{data: allForks.SignedBeaconBlock; version: ForkName}>;

  /**
   * Get block attestations
   * Retrieves attestation included in requested block.
   * @param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlockAttestations(blockId: BlockId): Promise<{data: phase0.Attestation[]}>;

  /**
   * Get block header
   * Retrieves block header for given block id.
   * @param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlockHeader(blockId: BlockId): Promise<{data: BlockHeaderResponse}>;

  /**
   * Get block headers
   * Retrieves block headers matching given query. By default it will fetch current head slot blocks.
   * @param slot
   * @param parentRoot
   */
  getBlockHeaders(filters: Partial<{slot: Slot; parentRoot: string}>): Promise<{data: BlockHeaderResponse[]}>;

  /**
   * Get block root
   * Retrieves hashTreeRoot of BeaconBlock/BeaconBlockHeader
   * @param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlockRoot(blockId: BlockId): Promise<{data: Root}>;

  /**
   * Publish a signed block.
   * Instructs the beacon node to broadcast a newly signed beacon block to the beacon network,
   * to be included in the beacon chain. The beacon node is not required to validate the signed
   * `BeaconBlock`, and a successful response (20X) only indicates that the broadcast has been
   * successful. The beacon node is expected to integrate the new block into its state, and
   * therefore validate the block internally, however blocks which fail the validation are still
   * broadcast but a different status code is returned (202)
   *
   * @param requestBody The `SignedBeaconBlock` object composed of `BeaconBlock` object (produced by beacon node) and validator signature.
   * @returns any The block was validated successfully and has been broadcast. It has also been integrated into the beacon node's database.
   */
  publishBlock(block: allForks.SignedBeaconBlock): Promise<void>;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getBlock: {url: "/eth/v1/beacon/blocks/:blockId", method: "GET"},
  getBlockV2: {url: "/eth/v2/beacon/blocks/:blockId", method: "GET"},
  getBlockAttestations: {url: "/eth/v1/beacon/blocks/:blockId/attestations", method: "GET"},
  getBlockHeader: {url: "/eth/v1/beacon/headers/:blockId", method: "GET"},
  getBlockHeaders: {url: "/eth/v1/beacon/headers", method: "GET"},
  getBlockRoot: {url: "/eth/v1/beacon/blocks/:blockId/root", method: "GET"},
  publishBlock: {url: "/eth/v1/beacon/blocks", method: "POST"},
};

/* eslint-disable @typescript-eslint/naming-convention */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function getReqSerializers(config: IBeaconConfig) {
  const t = mapValues(routesData, () => (arg: unknown) => arg) as RouteReqTypeGenerator<Api>;

  const blockIdOnlyReq = t.getBlock<{params: {blockId: string | number}}>({
    writeReq: (blockId) => ({params: {blockId}}),
    parseReq: ({params}) => [params.blockId],
    schema: {params: {blockId: Schema.StringRequired}},
  });

  // Compute block type from JSON payload. See https://github.com/ethereum/eth2.0-APIs/pull/142
  const getSignedBeaconBlockType = (data: allForks.SignedBeaconBlock): ContainerType<allForks.SignedBeaconBlock> =>
    config.getForkTypes(data.message.slot).SignedBeaconBlock;
  const AllForksSignedBeaconBlock: TypeJson<allForks.SignedBeaconBlock> = {
    toJson: (data, opts) => getSignedBeaconBlockType(data).toJson(data, opts),
    fromJson: (data, opts) =>
      getSignedBeaconBlockType((data as unknown) as allForks.SignedBeaconBlock).fromJson(data, opts),
  };

  return {
    getBlock: blockIdOnlyReq,
    getBlockV2: blockIdOnlyReq,
    getBlockAttestations: blockIdOnlyReq,
    getBlockHeader: blockIdOnlyReq,
    getBlockHeaders: t.getBlockHeaders<{query: {slot?: number; parent_root?: string}}>({
      writeReq: (filters) => ({query: {slot: filters?.slot, parent_root: filters?.parentRoot}}),
      parseReq: ({query}) => [{slot: query?.slot, parentRoot: query?.parent_root}],
      schema: {query: {slot: Schema.Uint, parent_root: Schema.String}},
    }),
    getBlockRoot: blockIdOnlyReq,
    publishBlock: reqOnlyBody(AllForksSignedBeaconBlock, Schema.Object),
  };
}

export type ReqTypes = {
  [K in keyof ReturnType<typeof getReqSerializers>]: ReturnType<ReturnType<typeof getReqSerializers>[K]["writeReq"]>;
};

export function getReturnTypes(config: IBeaconConfig): ReturnTypes<Api> {
  const BeaconHeaderResType = new ContainerType<BlockHeaderResponse>({
    fields: {
      root: config.types.Root,
      canonical: config.types.Boolean,
      header: config.types.phase0.SignedBeaconBlockHeader,
    },
  });

  return {
    getBlock: ContainerData(config.types.phase0.SignedBeaconBlock),
    getBlockV2: WithVersion((fork) => config.types[fork].SignedBeaconBlock),
    getBlockAttestations: ContainerData(ArrayOf(config.types.phase0.Attestation)),
    getBlockHeader: ContainerData(BeaconHeaderResType),
    getBlockHeaders: ContainerData(ArrayOf(BeaconHeaderResType)),
    getBlockRoot: ContainerData(config.types.Root),
  };
}
