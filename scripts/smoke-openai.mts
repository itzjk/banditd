import {
  researchMarket,
  generateVariants,
  generateImage,
  startBudget,
  failureBody,
} from "../lib/openai.ts";
import type { Product } from "../lib/store.ts";

const product: Product = {
  name: "Cold-Pressed Coffee Concentrate",
  price: "$28.00",
  description: "A 32oz bottle of slow-steeped concentrate that makes 16 cups.",
};

const t0 = Date.now();
const lap = (from: number) => `${((Date.now() - from) / 1000).toFixed(1)}s`;

console.log("1. investigacion de mercado con busqueda web...");
const t1 = Date.now();
const research = await researchMarket(product, startBudget("Market research", 100000)).catch(
  (e: unknown) => {
    console.log("   RENDIDO en", lap(t1), JSON.stringify(failureBody(e).body));
    process.exit(1);
  },
);
console.log("   comprador:", research.buyerProfile.slice(0, 120));
console.log("   angulos competencia:", research.competitorAngles.length);
console.log("   precio:", research.pricePositioning.slice(0, 100));
console.log("   fuentes citadas:", research.sources.length);
for (const s of research.sources.slice(0, 3)) console.log("     -", s.url.slice(0, 80));
console.log("   tiempo:", lap(t1));

console.log("\n2. generando 4 creativos con salida estructurada...");
const t2 = Date.now();
const variants = await generateVariants(
  product,
  research,
  startBudget("Creative writing", 70000),
).catch((e: unknown) => {
  console.log("   RENDIDO en", lap(t2), JSON.stringify(failureBody(e).body));
  process.exit(1);
});
for (const v of variants) {
  console.log(`   [${v.angle}] ${v.headline}`);
  console.log(`     ${v.body}`);
}
console.log("   tiempo:", lap(t2));

console.log("\n3. generando una imagen de prueba...");
const t3 = Date.now();
const img = await generateImage(variants[0].imagePrompt, startBudget("Image render", 90000));
console.log("   imagen:", img ? `${Math.round(img.length / 1024)} KB en base64` : "SIN IMAGEN");
console.log("   tiempo:", lap(t3));

console.log(`\nlisto en ${lap(t0)}`);
