import sinon from "sinon";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {expect} from "chai";
import {GossipEvent} from "../../../../../src/network/gossip/constants";
import {config} from "@chainsafe/lodestar-config/minimal";
import {generateEmptyProposerSlashing} from "../../../../utils/slashings";
import {handleIncomingProposerSlashing} from "../../../../../src/network/gossip/handlers/proposerSlashing";
import {testLogger} from "../../../../utils/logger";

describe("gossip handlers - proposerSlashing", function () {
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

  it("handle valid proposer slashing", function () {
    const proposerSlashing = generateEmptyProposerSlashing();
    handleIncomingProposerSlashing.bind(gossipStub)(proposerSlashing);

    expect(gossipStub.emit.withArgs(GossipEvent.PROPOSER_SLASHING, proposerSlashing).calledOnce).to.be.true;
  });
});