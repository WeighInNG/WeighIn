import { rpc } from "@stellar/stellar-sdk";

async function run() {
  const server = new rpc.Server("http://localhost:8000/rpc", { allowHttp: true });
  const network = await server.getNetwork();
  console.log(network);
}
run();
