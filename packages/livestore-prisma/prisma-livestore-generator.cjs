#!/usr/bin/env node
// CommonJS entry point Prisma invokes. It dynamically imports the ESM
// generator built to dist/generator.js, which starts the
// @prisma/generator-helper handler and listens on stdin.
import("./dist/generator.js").catch((error) => {
  console.error(error);
  process.exit(1);
});
