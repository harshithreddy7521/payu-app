import "dotenv/config";
import { prisma } from "./lib/prisma.js";
import { issueBills, dispatchReminders } from "./lib/automation.js";
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    for (const org of await prisma.organisation.findMany({
      where: { status: "ACTIVE" },
    }))
      await issueBills(org.id);
    await dispatchReminders();
  } catch (error) {
    console.error("Automation cycle failed", error);
  } finally {
    running = false;
  }
}
await tick();
const timer = setInterval(tick, 30000);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(timer);
    void prisma.$disconnect().then(() => process.exit(0));
  });
console.log("Billing and reminder worker running (Asia/Kolkata)");
