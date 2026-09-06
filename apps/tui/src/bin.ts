#!/usr/bin/env node

import { entry } from "./main.ts";

process.exitCode = await entry(process.argv.slice(2));
