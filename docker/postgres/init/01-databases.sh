#!/bin/bash
# Legt die Datenbanken der Anwendung und von Keycloak mit eigenen Benutzern an.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
  CREATE USER sweet3d WITH PASSWORD '${SWEET3D_DB_PASSWORD}';
  CREATE DATABASE sweet3d OWNER sweet3d;
  CREATE USER keycloak WITH PASSWORD '${KEYCLOAK_DB_PASSWORD}';
  CREATE DATABASE keycloak OWNER keycloak;
EOSQL

# Eigene Datenbank für die Backend-Tests (./mvnw test)
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -c "CREATE DATABASE sweet3d_test OWNER sweet3d;"
