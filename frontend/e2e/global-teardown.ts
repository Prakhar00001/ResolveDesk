import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export default async function teardown() {
  const runDir = process.env.RESOLVEDESK_E2E_RUN_DIR;
  if (!runDir) throw new Error("Missing E2E runtime directory");
  const exists = () => access(runDir).then(() => true, () => false);
  if (!(await exists())) return;
  await writeFile(path.join(runDir, "shutdown"), "stop\n");
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!(await exists())) return;
    await delay(100);
  }
  throw new Error(`E2E backend did not shut down and remove its database: ${runDir}`);
}
