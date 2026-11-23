#!/bin/sh
# Arranca como root solo para dejar /data (y las copias) a nombre del usuario «node»; luego la app corre sin privilegios.
set -e
if [ "$(id -u)" = "0" ]; then
  _DATA="${CIRCUITBIN_DATA:-${AMS_LAB_DATA:-/data}}"
  _COPIAS="${CIRCUITBIN_COPIAS:-${AMS_LAB_COPIAS:-}}"
  mkdir -p "$_DATA" ${_COPIAS:+"$_COPIAS"}
  chown -R node:node "$_DATA" ${_COPIAS:+"$_COPIAS"}
  exec su-exec node "$@"
fi
exec "$@"
