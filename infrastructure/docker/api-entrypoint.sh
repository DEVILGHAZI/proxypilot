#!/bin/sh
set -eu
pnpm --filter @proxypilot/database migrate
exec pnpm --filter @proxypilot/api start
