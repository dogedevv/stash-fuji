import { BigInt } from "@graphprotocol/graph-ts";
import { Stash, Transfer } from "../generated/Stash/Stash";
import { Holder, EventTransfer } from "../generated/schema";

export const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";

const REBASE_PERIOD = 900;

/**
 * Get number of elapsed epochs since `start` till `end`
 * @constructor
 * @param {Number} start - unix timestamp in seconds
 * @param {number} end - unix timestamp in seconds
 * @return {Number} Number of elapsed epochs
 */
function getNumberOfElapsedEpochs(
  start: u32,
  end: u32,
  rebasePeriod: u32
): u32 {
  const elapsedBlocks = (end - (end % rebasePeriod) - start) / rebasePeriod;
  return elapsedBlocks;
}

function cummulateTotalEarnedAndBalanceForHolder(
  holder: Holder,
  atTimestamp: BigInt,
  rebaseRate: BigInt,
  rateDecimal: u32
): void {
  const numberOfElapsedEpochs: number = getNumberOfElapsedEpochs(
    holder.lastTransferAtEpochTimestamp.toU32(),
    atTimestamp.toU32(),
    REBASE_PERIOD
  );

  for (let i = 0; i < numberOfElapsedEpochs; i++) {
    const previousBalance: BigInt = holder.cummulativeBalance;
    const rateDecimals: BigInt = BigInt.fromU32(10 ** rateDecimal);

    holder.cummulativeBalance = holder.cummulativeBalance
      .times(rateDecimals.plus(rebaseRate))
      .div(rateDecimals);

    holder.totalEarned = holder.totalEarned.plus(
      holder.cummulativeBalance.minus(previousBalance)
    );
  }

  // update last transfer at epoch's timestamp
  holder.lastTransferAtEpochTimestamp = holder.lastTransferAtEpochTimestamp.plus(
    BigInt.fromU32(u32(numberOfElapsedEpochs)).times(
      BigInt.fromU32(REBASE_PERIOD)
    )
  );
}

enum HolderSide {
  Sender,
  Receiver,
}

function updateHolder(
  holder: Holder,
  timestamp: BigInt,
  rebaseRate: BigInt,
  baseRateDecimal: u32,
  rebaseStartTime: BigInt,
  value: BigInt,
  side: HolderSide
): void {
  if (holder.lastTransferAtEpochTimestamp != BigInt.zero()) {
    cummulateTotalEarnedAndBalanceForHolder(
      holder,
      timestamp,
      rebaseRate,
      baseRateDecimal
      // <u32>contract.RATE_DECIMALS()
    );
  } else {
    holder.lastTransferAtEpochTimestamp = BigInt.fromU32(
      timestamp.toU32() -
        ((timestamp.toU32() - rebaseStartTime.toU32()) % REBASE_PERIOD)
    );
  }

  if (side == HolderSide.Receiver) {
    holder.cummulativeBalance = holder.cummulativeBalance.plus(value);
    holder.balance = holder.balance.plus(value);
  } else if (side == HolderSide.Sender) {
    holder.cummulativeBalance =
      holder.cummulativeBalance.minus(value) < BigInt.zero()
        ? BigInt.zero()
        : holder.cummulativeBalance.minus(value);
    holder.balance =
      holder.balance.minus(value) < BigInt.zero()
        ? BigInt.zero()
        : holder.balance.minus(value);
  }
}

export function handleTransfer(event: Transfer): void {
  let contract = Stash.bind(event.address);
  let rebaseStartTime = contract.initRebaseStartTime();
  let rebaseRate = contract.getRebaseRate();

  let ev = new EventTransfer(event.transaction.hash.toHexString());

  let from = event.params.from;

  const timestamp: BigInt = event.block.timestamp;
  let to = event.params.to;
  let holderTo = Holder.load(to.toHexString());
  if (holderTo == null) {
    holderTo = new Holder(to.toHexString());
  }

  if (event.params.to.toHex() != ADDRESS_ZERO) {
    updateHolder(
      holderTo,
      timestamp,
      rebaseRate,
      <u32>contract.RATE_DECIMALS(),
      rebaseStartTime,
      event.params.value,
      HolderSide.Receiver
    );
  }

  holderTo.save();

  let holderFrom = Holder.load(from.toHexString());
  if (holderFrom == null) {
    holderFrom = new Holder(from.toHexString());
  }

  if (event.params.from.toHex() != ADDRESS_ZERO) {
    updateHolder(
      holderFrom,
      timestamp,
      rebaseRate,
      <u32>contract.RATE_DECIMALS(),
      rebaseStartTime,
      event.params.value,
      HolderSide.Sender
    );
  }

  holderFrom.save();

  ev.emitter = event.address;
  ev.transaction = event.transaction.hash;
  ev.timestamp = event.block.timestamp;
  ev.contract = event.address;
  ev.value = event.params.value;
  ev.valueExact = event.params.value;
  ev.from = event.params.from;
  ev.to = event.params.to;

  ev.save();
}
