import {Epoch, Number64, phase0, Slot, Root, ssz} from "@chainsafe/lodestar-types";
import {ContainerType, Json, Type} from "@chainsafe/ssz";
import {jsonOpts, RouteDef, TypeJson} from "../utils";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export enum EventType {
  /**
   * The node has finished processing, resulting in a new head. previous_duty_dependent_root is
   * `get_block_root_at_slot(state, compute_start_slot_at_epoch(epoch - 1) - 1)` and
   * current_duty_dependent_root is `get_block_root_at_slot(state, compute_start_slot_at_epoch(epoch) - 1)`.
   * Both dependent roots use the genesis block root in the case of underflow.
   */
  head = "head",
  /** The node has received a valid block (from P2P or API) */
  block = "block",
  /** The node has received a valid attestation (from P2P or API) */
  attestation = "attestation",
  /** The node has received a valid voluntary exit (from P2P or API) */
  voluntaryExit = "voluntary_exit",
  /** Finalized checkpoint has been updated */
  finalizedCheckpoint = "finalized_checkpoint",
  /** The node has reorganized its chain */
  chainReorg = "chain_reorg",
}

export type EventData = {
  [EventType.head]: {
    slot: Slot;
    block: Root;
    state: Root;
    epochTransition: boolean;
    previousDutyDependentRoot: Root;
    currentDutyDependentRoot: Root;
  };
  [EventType.block]: {slot: Slot; block: Root};
  [EventType.attestation]: phase0.Attestation;
  [EventType.voluntaryExit]: phase0.SignedVoluntaryExit;
  [EventType.finalizedCheckpoint]: {block: Root; state: Root; epoch: Epoch};
  [EventType.chainReorg]: {
    slot: Slot;
    depth: Number64;
    oldHeadBlock: Root;
    newHeadBlock: Root;
    oldHeadState: Root;
    newHeadState: Root;
    epoch: Epoch;
  };
};

export type BeaconEvent = {[K in EventType]: {type: K; message: EventData[K]}}[EventType];

export type Api = {
  /**
   * Subscribe to beacon node events
   * Provides endpoint to subscribe to beacon node Server-Sent-Events stream.
   * Consumers should use [eventsource](https://html.spec.whatwg.org/multipage/server-sent-events.html#the-eventsource-interface)
   * implementation to listen on those events.
   *
   * @param topics Event types to subscribe to
   * @returns Opened SSE stream.
   */
  eventstream(topics: EventType[], signal: AbortSignal, onEvent: (event: BeaconEvent) => void): void;
};

export const routesData: {[K in keyof Api]: RouteDef} = {
  eventstream: {url: "/eth/v1/events", method: "GET"},
};

export type ReqTypes = {
  eventstream: {
    query: {topics: EventType[]};
  };
};

// It doesn't make sense to define a getReqSerializers() here given the exotic argument of eventstream()
// The request is very simple: (topics) => {query: {topics}}, and the test will ensure compatibility server - client

export function getTypeByEvent(): {[K in EventType]: Type<EventData[K]>} {
  return {
    [EventType.head]: new ContainerType<EventData[EventType.head]>({
      fields: {
        slot: ssz.Slot,
        block: ssz.Root,
        state: ssz.Root,
        epochTransition: ssz.Boolean,
        previousDutyDependentRoot: ssz.Root,
        currentDutyDependentRoot: ssz.Root,
      },
    }),

    [EventType.block]: new ContainerType<EventData[EventType.block]>({
      fields: {
        slot: ssz.Slot,
        block: ssz.Root,
      },
    }),

    [EventType.attestation]: ssz.phase0.Attestation,
    [EventType.voluntaryExit]: ssz.phase0.SignedVoluntaryExit,

    [EventType.finalizedCheckpoint]: new ContainerType<EventData[EventType.finalizedCheckpoint]>({
      fields: {
        block: ssz.Root,
        state: ssz.Root,
        epoch: ssz.Epoch,
      },
    }),

    [EventType.chainReorg]: new ContainerType<EventData[EventType.chainReorg]>({
      fields: {
        slot: ssz.Slot,
        depth: ssz.Number64,
        oldHeadBlock: ssz.Root,
        newHeadBlock: ssz.Root,
        oldHeadState: ssz.Root,
        newHeadState: ssz.Root,
        epoch: ssz.Epoch,
      },
    }),
  };
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function getEventSerdes() {
  const typeByEvent = getTypeByEvent();

  return {
    toJson: (event: BeaconEvent): Json => {
      const eventType = typeByEvent[event.type] as TypeJson<BeaconEvent["message"]>;
      return eventType.toJson(event.message, jsonOpts);
    },
    fromJson: (type: EventType, data: Json): BeaconEvent["message"] => {
      const eventType = typeByEvent[type] as TypeJson<BeaconEvent["message"]>;
      return eventType.fromJson(data, jsonOpts);
    },
  };
}
