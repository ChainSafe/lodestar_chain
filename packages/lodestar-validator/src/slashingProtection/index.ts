import {BLSPubkey, SlashingProtectionBlock, SlashingProtectionAttestation} from "@chainsafe/lodestar-types";
import {checkAndInsertBlockProposal, SlashingProtectionBlockRepository} from "./block";
import {checkAndInsertAttestation, SlashingProtectionAttestationRepository} from "./attestation";
import {DatabaseService, IDatabaseApiOptions} from "@chainsafe/lodestar-db";
import {ISlashingProtection} from "./interface";
import {SlashingProtectionManager} from "./manager";

export {InvalidAttestationError, InvalidAttestationErrorCode} from "./attestation";
export {InvalidBlockError, InvalidBlockErrorCode} from "./block";
export {InterchangeError, InterchangeErrorErrorCode} from "./interchange";
export {ISlashingProtection, SlashingProtectionManager};

export class SlashingProtection extends DatabaseService implements ISlashingProtection {
  private blockRepository: SlashingProtectionBlockRepository;
  private attestationRepository: SlashingProtectionAttestationRepository;

  constructor(opts: IDatabaseApiOptions) {
    super(opts);
    this.blockRepository = new SlashingProtectionBlockRepository(this.config, this.db);
    this.attestationRepository = new SlashingProtectionAttestationRepository(this.config, this.db);
  }

  public async checkAndInsertBlockProposal(pubKey: BLSPubkey, block: SlashingProtectionBlock): Promise<void> {
    await checkAndInsertBlockProposal(pubKey, block, this.blockRepository);
  }

  public async checkAndInsertAttestation(pubKey: BLSPubkey, attestation: SlashingProtectionAttestation): Promise<void> {
    await checkAndInsertAttestation(pubKey, attestation, this.attestationRepository);
  }
}