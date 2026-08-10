#!/bin/sh
set -eu

set -a
. "/Library/Application Support/EasyTier/moshi-net.env"
set +a

exec "__EASYTIER_CORE__"
