import { compileAuthoredContent } from "./authored-content.ts";

const check = process.argv.slice(2).includes("--check");
const compiled = await compileAuthoredContent({ check });
console.log(`${check ? "Validated" : "Built"} ${compiled.length} repository-authored games`);
