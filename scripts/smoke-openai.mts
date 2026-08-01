import { researchMarket, generateVariants, generateImage } from "../lib/openai.ts";
import type { Product } from "../lib/store.ts";

const product: Product = {
  name: "Cold-Pressed Coffee Concentrate",
  price: "$28.00",
  description: "A 32oz bottle of slow-steeped concentrate that makes 16 cups.",
};

const t0 = Date.now();

console.log("1. investigacion de mercado con busqueda web...");
const research = await researchMarket(product);
console.log("   comprador:", research.buyerProfile.slice(0, 120));
console.log("   angulos competencia:", research.competitorAngles.length);
console.log("   precio:", research.pricePositioning.slice(0, 100));
console.log("   fuentes citadas:", research.sources.length);
for (const s of research.sources.slice(0, 3)) console.log("     -", s.url.slice(0, 80));

console.log("\n2. generando 4 creativos con salida estructurada...");
const variants = await generateVariants(product, research);
for (const v of variants) {
  console.log(`   [${v.angle}] ${v.headline}`);
  console.log(`     ${v.body}`);
}

console.log("\n3. generando una imagen de prueba...");
const img = await generateImage(variants[0].imagePrompt);
console.log("   imagen:", img ? `${Math.round(img.length / 1024)} KB en base64` : "FALLO");

console.log(`\nlisto en ${((Date.now() - t0) / 1000).toFixed(1)}s`);
