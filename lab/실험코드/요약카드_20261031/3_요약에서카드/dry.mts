import path from "node:path"; import { pathToFileURL } from "node:url";
const { z } = await import(pathToFileURL(path.join(process.cwd(), "node_modules/zod/index.js")).href);
const { cardSchema } = await import(pathToFileURL(path.join(process.cwd(), "src/lib/study/gen/cards.ts")).href);
const { astraJsonSchema } = await import(pathToFileURL(path.join(process.cwd(), "src/lib/study/gen/astra.ts")).href);
const s = astraJsonSchema(z.object({ cards: z.array(cardSchema.extend({ covers: z.array(z.string()) })) }));
console.log(JSON.stringify(s).length, JSON.stringify(s).includes("covers"));
