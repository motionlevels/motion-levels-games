import { compileAuthoredContent } from "./authored-content.ts";

const check = process.argv.slice(2).includes("--check");
const format = process.argv.slice(2).includes("--format");
const compiled = await compileAuthoredContent({ check, format });
console.log(`${check ? "Validated" : format ? "Formatted and built" : "Built"} ${compiled.length} repository-authored games`);
