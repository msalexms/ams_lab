#!/bin/sh
# Arranca como root solo para dejar /data (y las copias) a nombre del usuario «node»; luego la app corre sin privilegios.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$AMS_LAB_DATA" ${AMS_LAB_COPIAS:+"$AMS_LAB_COPIAS"}
  chown -R node:node "$AMS_LAB_DATA" ${AMS_LAB_COPIAS:+"$AMS_LAB_COPIAS"}
  exec su-exec node "$@"
fi
exec "$@"
