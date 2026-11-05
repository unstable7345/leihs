#!/usr/bin/env bash
# Creates the ES256 key pair shared by leihs and the bridge.
set -euo pipefail

target_dir="${1:?usage: generate-keys.sh <directory>}"
private_key="$target_dir/private.pem"
public_key="$target_dir/public.pem"

if [[ -e "$private_key" ]]; then
  echo "$private_key already exists: not overwriting it" >&2
  exit 1
fi

(umask 077 && openssl ecparam -name prime256v1 -genkey -noout -out "$private_key")
openssl ec -in "$private_key" -pubout -out "$public_key" 2>/dev/null
echo "Created $private_key and $public_key"
