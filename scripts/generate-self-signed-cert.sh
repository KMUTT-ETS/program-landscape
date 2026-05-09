#!/usr/bin/env bash
# Generates the self-signed TLS cert that the KKU reverse proxy
# re-encrypts to. Run once during prod-server setup; re-run when the
# cert approaches expiry (default 10 years).
#
# Usage:
#   sudo ./scripts/generate-self-signed-cert.sh
#
# Output:
#   /opt/program-landscape/certs/fullchain.pem
#   /opt/program-landscape/certs/privkey.pem
#
# After generation, share the SHA-256 fingerprint with the KKU network
# team — they can pin it via `proxy_ssl_trusted_certificate` +
# `proxy_ssl_verify on` on their end for stronger-than-verify-off.

set -euo pipefail

CERT_DIR="${CERT_DIR:-/opt/program-landscape/certs}"
DOMAIN="${DOMAIN:-program-landscape.kku.ac.th}"
DAYS="${DAYS:-3650}"  # 10 years

# Require root so we can chown into /opt.
if [ "${EUID}" -ne 0 ] && ! command -v sudo >/dev/null 2>&1; then
  echo "This script must be run as root (or with sudo available)." >&2
  exit 1
fi

SUDO=""
if [ "${EUID}" -ne 0 ]; then
  SUDO="sudo"
fi

${SUDO} mkdir -p "${CERT_DIR}"
${SUDO} chmod 755 "${CERT_DIR}"

# Don't silently overwrite an existing cert — operator should rotate
# deliberately.
if [ -f "${CERT_DIR}/fullchain.pem" ] || [ -f "${CERT_DIR}/privkey.pem" ]; then
  echo "ERROR: cert already exists at ${CERT_DIR}/" >&2
  echo "Delete fullchain.pem + privkey.pem first, or set CERT_DIR to a different path." >&2
  exit 1
fi

echo "Generating ${DAYS}-day self-signed cert for CN=${DOMAIN} ..."
${SUDO} openssl req -x509 -newkey rsa:4096 -sha256 \
  -days "${DAYS}" \
  -nodes \
  -keyout "${CERT_DIR}/privkey.pem" \
  -out "${CERT_DIR}/fullchain.pem" \
  -subj "/C=TH/ST=Khon Kaen/L=Khon Kaen/O=Khon Kaen University/OU=Office of Vice President for Education and Digital/CN=${DOMAIN}" \
  -addext "subjectAltName=DNS:${DOMAIN},DNS:localhost,IP:127.0.0.1"

${SUDO} chmod 600 "${CERT_DIR}/privkey.pem"
${SUDO} chmod 644 "${CERT_DIR}/fullchain.pem"

# ── Fingerprint capture ──────────────────────────────────────────────
# Write a stable, parseable fingerprint file alongside the cert. KKU
# network team reads this file out-of-band to configure cert pinning
# on the upstream proxy (`proxy_ssl_trusted_certificate` +
# `proxy_ssl_verify on`). Format is intentionally machine-readable.
FINGERPRINT_FILE="${CERT_DIR}/fingerprint.txt"
{
  echo "# Program Landscape self-signed cert fingerprint"
  echo "# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# Subject:   CN=${DOMAIN}"
  echo "# Validity:  ${DAYS} days"
  echo "# Algorithm: RSA-4096, SHA-256"
  echo
  ${SUDO} openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -fingerprint -sha256 \
    | sed 's/SHA256 Fingerprint=/SHA256 Fingerprint = /'
  ${SUDO} openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -fingerprint -sha1 \
    | sed 's/SHA1 Fingerprint=/SHA1 Fingerprint = /'
  echo
  echo "# Subject + expiry:"
  ${SUDO} openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -subject -enddate
} | ${SUDO} tee "${FINGERPRINT_FILE}" >/dev/null
${SUDO} chmod 644 "${FINGERPRINT_FILE}"

echo
echo "Cert generated:"
${SUDO} ls -l "${CERT_DIR}"
echo
echo "Fingerprint summary written to ${FINGERPRINT_FILE}:"
${SUDO} cat "${FINGERPRINT_FILE}"
