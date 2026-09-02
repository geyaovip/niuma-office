#!/usr/bin/env node
import { rmSync } from "node:fs";
import { resolve } from "node:path";

rmSync(resolve("dist/electron"), { recursive: true, force: true });
