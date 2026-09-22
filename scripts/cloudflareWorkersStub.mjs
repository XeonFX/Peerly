// Plain-Node vitest (vitest.config.ts) runs worker/index.test.mjs outside the
// actual Workers runtime, so `cloudflare:workers` does not exist as a
// resolvable module. That test only exercises `allowedAuthParent` and the
// Google auth bridge handler — it never instantiates a Durable Object class
// — so a minimal stand-in for the base class is enough to let the import
// graph resolve. Real behavior is covered by the vitest-pool-workers suite
// (npm run test:workers), which runs against the actual runtime.
export class DurableObject {
  constructor(ctx, env) {
    this.ctx = ctx
    this.env = env
  }
}
