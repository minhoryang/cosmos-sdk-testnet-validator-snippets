// $ bun run monitoring_validator_block_status_and_participation_via_ws.js ws://localhost:26657/websocket
//
// This script monitors the block status and validator participation via WebSocket connection to a Tendermint node.
// [bun](https://bun.com/) is required to run this script, because it connects to WebSocket faster than node.js.
//
// TODO: expectation: this agent should be running on multiple nodes for same validator and restart automatically on failure.
// TODO: expectation: external beaconing for liveness tracking of this agent. (such as https://healthchecks.io/)

const DESIGNATED_BLOCK_TIME_DELTA_IN_MS = 500;
const _BLOCK_TIME_DELTA_BUFFER_IN_MS = DESIGNATED_BLOCK_TIME_DELTA_IN_MS * 1.05;
const _BLOCK_JUGGLING_TIMEOUT_IN_MS = DESIGNATED_BLOCK_TIME_DELTA_IN_MS * 1.95;

const _STATUS_CMD = `{"jsonrpc":"2.0","method":"status","id":"0"}`;
const _SUBSCRIBE_CMD = `{"jsonrpc":"2.0","method":"subscribe","id":"1","params":{"query":"tm.event='NewBlock'"}}}`;

const monitoring = (wsUrl, alertFn) => {
  const ws = new WebSocket(wsUrl);
  ws.addEventListener("open", () => {
    ws.send(_STATUS_CMD);
    ws.send(_SUBSCRIBE_CMD);
  });

  const newBlockJuggling = (previousBlockHeight, previousLastStr) => {
    return setTimeout(() => {
      alertFn(`No new block received for a while (${previousBlockHeight}: ${previousLastStr}), warning...`);
    }, _BLOCK_JUGGLING_TIMEOUT_IN_MS);
  };

  let _blockReceivedJuggling;
  let _blockReceivedLast;
  let _validatorAddress;
  ws.addEventListener("message", (event) => {
    const obj = JSON.parse(event.data);
    if (obj.id === "1" && obj.result.data) {
      // NOTE: subscribe(NewBlock)

      const block = obj.result.data.value.block;

      if (_blockReceivedJuggling) clearTimeout(_blockReceivedJuggling);
      _blockReceivedJuggling = newBlockJuggling(block.header.height, block.header.time);

      if (block.last_commit.signatures.filter(sig => sig.validator_address === _validatorAddress).length === 0) {
        alertFn(`Validator ${_validatorAddress} did not sign block ${block.header.height}.`);
      }

      const blockTime = new Date(block.header.time);
      const blockTimeDelta = blockTime - _blockReceivedLast;
      console.log(`Received new block: ${block.header.height} at ${block.header.time} (+${blockTimeDelta} ms)`);
      if (_blockReceivedLast && blockTimeDelta > _BLOCK_TIME_DELTA_BUFFER_IN_MS) {
        alertFn(`Block time delta ${blockTimeDelta} is later than ${_BLOCK_TIME_DELTA_BUFFER_IN_MS} ms.`);
      }

      _blockReceivedLast = blockTime;
    } else if (obj.id === "0") {
      // NOTE: status(), received first.
      _validatorAddress = obj.result.validator_info.address;
      console.log(`Validator address: ${_validatorAddress}`);
      if (obj.result.validator_info.voting_power === "0") {
        alertFn(`Validator ${_validatorAddress} is not participating in the consensus.`);
      }
      if (obj.result.sync_info.catching_up) {
        alertFn(`Validator ${_validatorAddress} is catching up.`);
        ws.send(_STATUS_CMD);
      }
    }
  });

  ws.addEventListener("close", () => {
    process.exit(1);
  });

  ws.addEventListener("error", (err) => {
    // FIXME: sentry.captureException(err);
    console.error(err);
    process.exit(1);
  });
};

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(
    "Usage: bun run monitoring_validator_block_status_and_participation_via_ws.js <websocket_rpc_url> (alert_webhook_url)",
  );
  process.exit(1);
} else {
  const wsUrl = args[0];
  if (!wsUrl.startsWith("ws://") && !wsUrl.startsWith("wss://")) {
    console.error(`Wrong WebSocket URL: ${wsUrl}`);
    process.exit(1);
  }
  let alert = console.warn;
  if (args.length > 1) {
    const alertWebhookUrl = args[1];
    if (!alertWebhookUrl.startsWith("http://") && !alertWebhookUrl.startsWith("https://")) {
      console.error(`Wrong alert webhook URL: ${alertWebhookUrl}`);
      process.exit(1);
    }
    alert = (msg) => {
      console.warn(msg);
      // FIXME: implement here for your own alerting system. (such as Telegram, Discord, etc.)
      // Here is for slack webhook's example. (or https://webhook.site/)
      fetch(alertWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: msg }),
      }).catch((error) => {
        console.error("Error sending alert:", error);
        process.exit(1);
      });
    };
  }
  monitoring(wsUrl, alert);
}
