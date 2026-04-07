#!/usr/bin/env node
import process from "node:process";
import { run } from "../src/cli/app.js";

run(process.argv)
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(String(e?.stack ?? e?.message ?? e));
    process.exit(1);
  });
