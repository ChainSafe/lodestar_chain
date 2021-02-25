import sinon from "sinon";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {handleIncomingAggregateAndProof} from "../../../../../src/network/gossip/handlers/aggregateAndProof";
import {phase0} from "@chainsafe/lodestar-types";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {expect} from "chai";
import {GossipEvent} from "../../../../../src/network/gossip/constants";
import {config} from "@chainsafe/lodestar-config/minimal";
import {testLogger} from "../../../../utils/logger";

describe("gossip handlers - aggregate and proof", function () {
  const sandbox = sinon.createSandbox();

  let gossipStub: any;

  beforeEach(function () {
    gossipStub = sandbox.createStubInstance(Gossip);
    gossipStub.logger = testLogger();
    gossipStub.config = config;
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("handle valid message", function () {
    const aggregate: phase0.AggregateAndProof = {
      aggregatorIndex: 0,
      selectionProof: Buffer.alloc(0),
      aggregate: generateEmptyAttestation(),
    };

    const signedAggregate: phase0.SignedAggregateAndProof = {
      message: aggregate,
      signature: Buffer.alloc(96),
    };

    handleIncomingAggregateAndProof.bind(gossipStub)(signedAggregate);

    expect(gossipStub.emit.withArgs(GossipEvent.AGGREGATE_AND_PROOF, signedAggregate).calledOnce).to.be.true;
  });
});