#!/usr/bin/env node
// Compatibility entry point: English shares the same templates as Chinese.
import { buildSite } from './gen-site-pages.mjs';
buildSite([true]);
