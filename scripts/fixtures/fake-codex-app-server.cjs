/* eslint-disable @typescript-eslint/no-require-imports */
const readline = require("node:readline");

const mode = process.argv[2] || "timeout";
const input = readline.createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialized") return;
  if (message.method === "initialize") {
    send({ id: message.id, result: {} });
    return;
  }
  if (message.method === "thread/start") {
    send({ id: message.id, result: { thread: { id: "thread-test" } } });
    return;
  }
  if (message.method === "thread/name/set") {
    send({ id: message.id, result: {} });
    return;
  }
  if (message.method === "turn/start") {
    send({ id: message.id, result: { turn: { id: "turn-test" } } });
    if (mode === "exit") setTimeout(() => process.exit(17), 10);
    return;
  }
  if (message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
    send({
      method: "turn/completed",
      params: {
        threadId: "thread-test",
        turn: { id: "turn-test", status: "interrupted", error: null },
      },
    });
  }
});
