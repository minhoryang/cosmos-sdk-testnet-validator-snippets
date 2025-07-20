let prevTime = null;

const _delta = (block_id, block_time) => {
  const currTime = new Date(block_time); // NOTE: nanoseconds are ignored.
  if (prevTime !== null) {
    const delta = currTime - prevTime;
    console.log(`${block_id} -- ${delta} ms`);
  }
  prevTime = currTime;
};

const run = (height, end) => {
  return fetch(`http://localhost:26657/block?height=${height}`)
    .then((response) => response.json())
    .then((data) => {
      _delta(height, data.result.block.header.time);
      if (height + 1 !== end) {
        return run(height + 1, end);
      }
    })
    .catch((error) => {
      console.error("Error fetching block data:", error);
    });
};

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log("Usage: bun run block_time_delta.js <start_block_height>");
} else {
  const start = parseInt(args[0]);
  run(start, start + 100);
}
