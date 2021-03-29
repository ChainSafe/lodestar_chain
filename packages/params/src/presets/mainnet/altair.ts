/* eslint-disable @typescript-eslint/naming-convention */

export const altairJson = {
  CONFIG_NAME: "mainnet",

  // 2**10 (=1,024)
  SYNC_COMMITTEE_SIZE: 1024,
  // 2**6 (=64)
  SYNC_COMMITTEE_PUBKEY_AGGREGATES_SIZE: 64,

  EPOCHS_PER_SYNC_COMMITTEE_PERIOD: 256,

  DOMAIN_SYNC_COMMITTEE: "0x07000000",
  ALTAIR_FORK_VERSION: "0x01000000",
  HF1_INACTIVITY_PENALTY_QUOTIENT: 50331648,
  HF1_MIN_SLASHING_PENALTY_QUOTIENT: 64,
  HF1_PROPORTIONAL_SLASHING_MULTIPLIER: 2,
  ALTAIR_FORK_SLOT: "0xffffffffffffffff",
};
