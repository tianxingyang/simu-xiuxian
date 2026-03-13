#!/usr/bin/env bash
cd "$(dirname "${BASH_SOURCE[0]}")" && exec npx tsx cli.ts "$@"
