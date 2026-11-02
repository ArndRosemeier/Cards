import { startMockHub } from "./mockhub.ts";
const h = await startMockHub(Number(process.env.PORT ?? 9911));
console.log("mock hub on", h.url);
setInterval(() => {}, 1 << 30);
