import {expect, assert} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";
import Libp2p from "libp2p";
import {InMessage} from "libp2p-interfaces/src/pubsub";
import {ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {AbortController} from "@chainsafe/abort-controller";
import {config} from "@chainsafe/lodestar-config/default";
import {ForkName} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";

import {
  Eth2Gossipsub,
  stringifyGossipTopic,
  GossipType,
  GossipValidationError,
  encodeMessageData,
  GossipEncoding,
} from "../../../../src/network/gossip";

import {generateEmptySignedBlock} from "../../../utils/block";
import {createNode} from "../../../utils/network";
import {testLogger} from "../../../utils/logger";
import {ForkDigestContext} from "../../../../src/util/forkDigestContext";
import {GossipValidatorFns} from "../../../../src/network/gossip/validation/validatorFns";

describe("network / gossip / validation", function () {
  const logger = testLogger();
  const metrics = null;
  const gossipType = GossipType.beacon_block;

  let message: InMessage;
  let topicString: string;
  let libp2p: Libp2p;
  let forkDigestContext: SinonStubbedInstance<ForkDigestContext>;

  let controller: AbortController;
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  beforeEach(async function () {
    forkDigestContext = sinon.createStubInstance(ForkDigestContext);
    forkDigestContext.forkName2ForkDigest.returns(Buffer.alloc(4, 1));
    forkDigestContext.forkDigest2ForkName.returns(ForkName.phase0);

    const signedBlock = generateEmptySignedBlock();
    topicString = stringifyGossipTopic(forkDigestContext, {type: gossipType, fork: ForkName.phase0});
    message = {
      data: encodeMessageData(GossipEncoding.ssz_snappy, ssz.phase0.SignedBeaconBlock.serialize(signedBlock)),
      receivedFrom: "0",
      topicIDs: [topicString],
    };

    const multiaddr = "/ip4/127.0.0.1/tcp/0";
    libp2p = await createNode(multiaddr);
  });

  it("should throw on failed validation", async () => {
    const gossipHandlersPartial: Partial<GossipValidatorFns> = {
      [gossipType]: async () => {
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);
      },
    };

    const gossipSub = new Eth2Gossipsub({
      config,
      gossipHandlers: gossipHandlersPartial as GossipValidatorFns,
      logger,
      forkDigestContext,
      libp2p,
      metrics,
      signal: controller.signal,
    });

    try {
      await gossipSub.validate(message);
      assert.fail("Expect error here");
    } catch (e) {
      expect((e as GossipValidationError).code).to.be.equal(ERR_TOPIC_VALIDATOR_REJECT);
    }
  });

  it("should not throw on successful validation", async () => {
    const gossipHandlersPartial: Partial<GossipValidatorFns> = {
      [gossipType]: async () => {
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);
      },
    };

    const gossipSub = new Eth2Gossipsub({
      config,
      gossipHandlers: gossipHandlersPartial as GossipValidatorFns,
      logger,
      forkDigestContext,
      libp2p,
      metrics,
      signal: controller.signal,
    });

    await gossipSub.validate(message);
    // no error means pass validation
  });
});
