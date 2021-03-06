import {altair, ssz} from "@chainsafe/lodestar-types";
import {expect} from "chai";
import {SyncContributionAndProofPool} from "../../../../src/chain/opPools";
import {generateContributionAndProof} from "../../../utils/contributionAndProof";

describe("chain / opPools / SyncContributionAndProofPool", function () {
  let cache: SyncContributionAndProofPool;
  const beaconBlockRoot = Buffer.alloc(32, 1);
  const slot = 10;
  const contributionAndProof: altair.ContributionAndProof = generateContributionAndProof({
    contribution: {slot, beaconBlockRoot},
  });

  beforeEach(() => {
    cache = new SyncContributionAndProofPool();
    cache.add(contributionAndProof);
  });

  it("should return SyncCommitteeContribution list based on same slot and block root", () => {
    const newContributionAndProof = generateContributionAndProof({
      aggregatorIndex: contributionAndProof.aggregatorIndex + 1,
      contribution: {slot, beaconBlockRoot},
    });
    cache.add(newContributionAndProof);
    const aggregate = cache.getAggregate(slot, beaconBlockRoot);
    expect(ssz.altair.SyncAggregate.equals(aggregate, ssz.altair.SyncAggregate.defaultValue())).to.be.false;
    // TODO Test it's correct. Modify the contributions above so they have 1 bit set to true
    expect(aggregate.syncCommitteeBits.length).to.be.equal(32);
  });
});
