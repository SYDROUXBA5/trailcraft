#!/bin/sh
# Certificates so phones on the LAN get a secure origin — which is not optional:
# iOS grants Geolocation only on an origin it fully trusts, and GPS is the whole
# point of carrying this into a field.
#
# Two certificates, not one:
#
#   ca.pem    a local authority, created once and long-lived. This is the one
#             you install on the phone. Because it outlives any address change,
#             reissuing the server certificate later needs nothing on the phone.
#   cert.pem  the server certificate, signed by that CA and reissued whenever
#             your router hands the Mac a different address.
#
# The previous version issued a single self-signed certificate with no
# extendedKeyUsage. iOS 13 and later reject those even when they are trusted, so
# it would have been installed and still refused.
#
# The phone fetches ca.pem over a connection nothing has vouched for yet, so
# the script ends by printing the authority's SHA-256 fingerprint. Compare it
# with the one the phone shows before you install or trust anything: anyone on
# the same Wi-Fi can mint a look-alike called "Trailcraft Local CA", but not
# one with this fingerprint.
set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"
CERTS="$DIR/certs"
mkdir -p "$CERTS"

LAN=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1)

# ── 1. The authority ────────────────────────────────────────────────────
# A new authority may only vouch for this Mac's own names: localhost, *.local
# and private or loopback addresses. If its key ever leaked, it still could not
# be used to impersonate a real website to a phone that trusts it. An authority
# made before this line existed carries no such limit; delete ca.pem and
# ca-key.pem and re-run if you want the limited one (and reinstall it on the
# phone, removing the old profile).
NAMES="permitted;DNS:localhost,permitted;DNS:local"
NAMES="$NAMES,permitted;IP:127.0.0.0/255.0.0.0,permitted;IP:10.0.0.0/255.0.0.0"
NAMES="$NAMES,permitted;IP:172.16.0.0/255.240.0.0,permitted;IP:192.168.0.0/255.255.0.0"
NAMES="$NAMES,permitted;IP:169.254.0.0/255.255.0.0"
if [ ! -f "$CERTS/ca.pem" ] || [ ! -f "$CERTS/ca-key.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "$CERTS/ca-key.pem" -out "$CERTS/ca.pem" \
    -subj "/CN=Trailcraft Local CA/O=Trailcraft" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "nameConstraints=critical,$NAMES" 2>/dev/null
  chmod 600 "$CERTS/ca-key.pem"
  echo "Created a local certificate authority (certs/ca.pem)."
  echo "Install it on your phone ONCE — see README, 'Trusting the certificate'."
else
  echo "Reusing the existing local authority (certs/ca.pem)."
fi

# ── 2. The server certificate ───────────────────────────────────────────
# iOS 13+ requires serverAuth, a subjectAltName, and at most 825 days.
openssl req -newkey rsa:2048 -nodes \
  -keyout "$CERTS/key.pem" -out "$CERTS/csr.pem" \
  -subj "/CN=trailcraft.local" 2>/dev/null

cat > "$CERTS/ext.cnf" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,DNS:trailcraft.local,IP:127.0.0.1,IP:$LAN
EOF

openssl x509 -req -in "$CERTS/csr.pem" \
  -CA "$CERTS/ca.pem" -CAkey "$CERTS/ca-key.pem" -CAcreateserial \
  -out "$CERTS/cert.pem" -days 800 -sha256 -extfile "$CERTS/ext.cnf" 2>/dev/null

rm -f "$CERTS/csr.pem" "$CERTS/ext.cnf"
chmod 600 "$CERTS/key.pem"

echo "Issued a server certificate for localhost and $LAN (valid 800 days)."
echo "Run npm run dev:lan, then on the phone open:  https://$LAN:2777/ca.crt"

# The same spaced pairs iOS shows under the certificate's More Details.
FP=$(openssl x509 -in "$CERTS/ca.pem" -noout -fingerprint -sha256 | sed 's/^[^=]*=//; s/:/ /g')
echo ""
echo "Authority fingerprint (SHA-256) — check the phone shows exactly this"
echo "before you install or trust it:"
echo "  $FP"
