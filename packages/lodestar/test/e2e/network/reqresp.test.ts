import sinon from "sinon";
import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {AbortController} from "abort-controller";
import PeerId from "peer-id";
import {config} from "@chainsafe/lodestar-config/minimal";
import {sleep as _sleep} from "@chainsafe/lodestar-utils";
import {phase0} from "@chainsafe/lodestar-types";
import {createPeerId, IReqRespOptions, Network, prettyPrintPeerId} from "../../../src/network";
import {INetworkOptions} from "../../../src/network/options";
import {Method, Encoding} from "../../../src/network/reqresp/types";
import {IReqRespHandler} from "../../../src/network/reqresp/handlers";
import {RequestError, RequestErrorCode} from "../../../src/network/reqresp/request";
import {IRequestErrorMetadata} from "../../../src/network/reqresp/request/errors";
import {testLogger} from "../../utils/logger";
import {MockBeaconChain} from "../../utils/mocks/chain/chain";
import {createNode} from "../../utils/network";
import {generateState} from "../../utils/state";
import {arrToSource, generateEmptySignedBlocks} from "../../unit/network/reqresp/utils";
import {generateEmptySignedBlock} from "../../utils/block";
import {expectRejectedWithLodestarError} from "../../utils/errors";
import {connect, onPeerConnect} from "../../utils/network";
import {StubbedBeaconDb} from "../../utils/stub";

chai.use(chaiAsPromised);

/* eslint-disable require-yield, @typescript-eslint/naming-convention */

describe("network / ReqResp", function () {
  if (this.timeout() < 5000) this.timeout(5000);

  const multiaddr = "/ip4/127.0.0.1/tcp/0";
  const networkOptsDefault: INetworkOptions = {
    maxPeers: 1,
    targetPeers: 1,
    bootMultiaddrs: [],
    localMultiaddrs: [],
  };
  const state = generateState();
  const chain = new MockBeaconChain({genesisTime: 0, chainId: 0, networkId: BigInt(0), state, config});
  const db = new StubbedBeaconDb(sinon);

  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  let controller: AbortController;
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());
  async function sleep(ms: number): Promise<void> {
    await _sleep(ms, controller.signal);
  }

  async function createAndConnectPeers(
    reqRespHandlerPartial?: Partial<IReqRespHandler>,
    reqRespOpts?: IReqRespOptions
  ): Promise<[Network, Network]> {
    const controller = new AbortController();
    const peerIdB = await createPeerId();
    const [libp2pA, libp2pB] = await Promise.all([createNode(multiaddr), createNode(multiaddr, peerIdB)]);

    // eslint-disable-next-line
    const notImplemented = async function* <T>(): AsyncIterable<T> {
      throw Error("not implemented");
    };
    const reqRespHandler: IReqRespHandler = {
      onStatus: notImplemented,
      onBeaconBlocksByRange: notImplemented,
      onBeaconBlocksByRoot: notImplemented,
      ...reqRespHandlerPartial,
    };
    const opts = {...networkOptsDefault, ...reqRespOpts};
    const modules = {config, db, chain, reqRespHandler, signal: controller.signal, metrics: null};
    const netA = new Network(opts, {...modules, libp2p: libp2pA, logger: testLogger("A")});
    const netB = new Network(opts, {...modules, libp2p: libp2pB, logger: testLogger("B")});
    await Promise.all([netA.start(), netB.start()]);

    const connected = Promise.all([onPeerConnect(netA), onPeerConnect(netB)]);
    await connect(netA, netB.peerId, netB.localMultiaddrs);
    await connected;

    afterEachCallbacks.push(async () => {
      chain.close();
      controller.abort();
      await Promise.all([netA.stop(), netB.stop()]);
    });

    return [netA, netB];
  }

  it("should send/receive a ping message", async function () {
    const [netA, netB] = await createAndConnectPeers();

    // Modify the metadata to make the seqNumber non-zero
    netB.metadata.attnets = [];
    netB.metadata.attnets = [];
    const expectedPong = netB.metadata.seqNumber;
    expect(expectedPong.toString()).to.deep.equal("2", "seqNumber");

    const pong = await netA.reqResp.ping(netB.peerId);
    expect(pong.toString()).to.deep.equal(expectedPong.toString(), "Wrong response body");
  });

  it("should send/receive a metadata message", async function () {
    const [netA, netB] = await createAndConnectPeers();

    const metadataBody = {
      seqNumber: netB.metadata.seqNumber,
      attnets: netB.metadata.attnets,
    };

    const metadata = await netA.reqResp.metadata(netB.peerId);
    expect(metadata).to.deep.equal(metadataBody, "Wrong response body");
  });

  it("should send/receive a status message", async function () {
    const status: phase0.Status = {
      forkDigest: Buffer.alloc(4, 0),
      finalizedRoot: Buffer.alloc(32, 0),
      finalizedEpoch: 0,
      headRoot: Buffer.alloc(32, 0),
      headSlot: 0,
    };
    const statusNetA: phase0.Status = {...status, finalizedEpoch: 1};
    const statusNetB: phase0.Status = {...status, finalizedEpoch: 2};

    const [netA, netB] = await createAndConnectPeers({
      onStatus: async function* onRequest() {
        yield statusNetB;
      },
    });

    const receivedStatus = await netA.reqResp.status(netB.peerId, statusNetA);
    expect(receivedStatus).to.deep.equal(statusNetB, "Wrong response body");
  });

  it("should send/receive signed blocks", async function () {
    const req: phase0.BeaconBlocksByRangeRequest = {startSlot: 0, step: 1, count: 2};
    const blocks: phase0.SignedBeaconBlock[] = [];
    for (let slot = req.startSlot; slot < req.count; slot++) {
      const block = generateEmptySignedBlock();
      block.message.slot = slot;
      blocks.push(block);
    }

    const [netA, netB] = await createAndConnectPeers({
      onBeaconBlocksByRange: async function* () {
        yield* arrToSource(blocks);
      },
    });

    const returnedBlocks = await netA.reqResp.beaconBlocksByRange(netB.peerId, req);

    if (!returnedBlocks) throw Error("Returned null");
    expect(returnedBlocks).to.have.length(req.count, "Wrong returnedBlocks lenght");

    for (const [i, returnedBlock] of returnedBlocks.entries()) {
      expect(config.types.phase0.SignedBeaconBlock.equals(returnedBlock, blocks[i])).to.equal(
        true,
        `Wrong returnedBlock[${i}]`
      );
    }
  });

  it("should handle a server error", async function () {
    const testErrorMessage = "TEST_EXAMPLE_ERROR_1234";
    const [netA, netB] = await createAndConnectPeers({
      onBeaconBlocksByRange: async function* onRequest() {
        throw Error(testErrorMessage);
      },
    });

    await expectRejectedWithLodestarError(
      netA.reqResp.beaconBlocksByRange(netB.peerId, {startSlot: 0, step: 1, count: 3}),
      new RequestError(
        {code: RequestErrorCode.SERVER_ERROR, errorMessage: testErrorMessage},
        formatMetadata(Method.BeaconBlocksByRange, Encoding.SSZ_SNAPPY, netB.peerId)
      )
    );
  });

  it("should handle a server error after emitting two blocks", async function () {
    const testErrorMessage = "TEST_EXAMPLE_ERROR_1234";

    const [netA, netB] = await createAndConnectPeers({
      onBeaconBlocksByRange: async function* onRequest() {
        yield* arrToSource(generateEmptySignedBlocks(2));
        throw Error(testErrorMessage);
      },
    });

    await expectRejectedWithLodestarError(
      netA.reqResp.beaconBlocksByRange(netB.peerId, {startSlot: 0, step: 1, count: 3}),
      new RequestError(
        {code: RequestErrorCode.SERVER_ERROR, errorMessage: testErrorMessage},
        formatMetadata(Method.BeaconBlocksByRange, Encoding.SSZ_SNAPPY, netB.peerId)
      )
    );
  });

  it("trigger a TTFB_TIMEOUT error", async function () {
    const TTFB_TIMEOUT = 250;

    const [netA, netB] = await createAndConnectPeers(
      {
        onBeaconBlocksByRange: async function* onRequest() {
          // Wait for too long before sending first response chunk
          await sleep(TTFB_TIMEOUT * 10);
          yield generateEmptySignedBlock();
        },
      },
      {TTFB_TIMEOUT}
    );

    await expectRejectedWithLodestarError(
      netA.reqResp.beaconBlocksByRange(netB.peerId, {startSlot: 0, step: 1, count: 1}),
      new RequestError(
        {code: RequestErrorCode.TTFB_TIMEOUT},
        formatMetadata(Method.BeaconBlocksByRange, Encoding.SSZ_SNAPPY, netB.peerId)
      )
    );
  });

  it("trigger a RESP_TIMEOUT error", async function () {
    const RESP_TIMEOUT = 250;

    const [netA, netB] = await createAndConnectPeers(
      {
        onBeaconBlocksByRange: async function* onRequest() {
          yield generateEmptySignedBlock();
          // Wait for too long before sending second response chunk
          await sleep(RESP_TIMEOUT * 5);
          yield generateEmptySignedBlock();
        },
      },
      {RESP_TIMEOUT}
    );

    await expectRejectedWithLodestarError(
      netA.reqResp.beaconBlocksByRange(netB.peerId, {startSlot: 0, step: 1, count: 2}),
      new RequestError(
        {code: RequestErrorCode.RESP_TIMEOUT},
        formatMetadata(Method.BeaconBlocksByRange, Encoding.SSZ_SNAPPY, netB.peerId)
      )
    );
  });

  it("Sleep infinite on first byte", async function () {
    const [netA, netB] = await createAndConnectPeers(
      {
        onBeaconBlocksByRange: async function* onRequest() {
          await sleep(100000000);
        },
      },
      {RESP_TIMEOUT: 250, TTFB_TIMEOUT: 250}
    );

    await expectRejectedWithLodestarError(
      netA.reqResp.beaconBlocksByRange(netB.peerId, {startSlot: 0, step: 1, count: 2}),
      new RequestError(
        {code: RequestErrorCode.TTFB_TIMEOUT},
        formatMetadata(Method.BeaconBlocksByRange, Encoding.SSZ_SNAPPY, netB.peerId)
      )
    );
  });

  it("Sleep infinite on second response chunk", async function () {
    const [netA, netB] = await createAndConnectPeers(
      {
        onBeaconBlocksByRange: async function* onRequest() {
          yield generateEmptySignedBlock();
          await sleep(100000000);
        },
      },
      {RESP_TIMEOUT: 250, TTFB_TIMEOUT: 250}
    );

    await expectRejectedWithLodestarError(
      netA.reqResp.beaconBlocksByRange(netB.peerId, {startSlot: 0, step: 1, count: 2}),
      new RequestError(
        {code: RequestErrorCode.RESP_TIMEOUT},
        formatMetadata(Method.BeaconBlocksByRange, Encoding.SSZ_SNAPPY, netB.peerId)
      )
    );
  });
});

/** Helper to reduce code-duplication */
function formatMetadata(method: Method, encoding: Encoding, peer: PeerId): IRequestErrorMetadata {
  return {method, encoding, peer: prettyPrintPeerId(peer)};
}
