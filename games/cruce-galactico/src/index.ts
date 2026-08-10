// Product/browser entrypoint stays lean. Agent harnesses, headless regression
// tooling, replay helpers and fixtures remain available through named
// subpaths and are not pulled into the playground's eager game registry.
export * from "./product.ts";
