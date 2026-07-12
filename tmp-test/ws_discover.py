"""WS-Discovery probe to find ONVIF cameras (e.g. Reolink) on the LAN."""
import socket
import uuid

PROBE = f"""<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
            xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
            xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>uuid:{uuid.uuid4()}</w:MessageID>
    <w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </e:Body>
</e:Envelope>"""

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF,
                socket.inet_aton("10.201.41.33"))
sock.bind(("10.201.41.33", 0))
sock.settimeout(4)
sock.sendto(PROBE.encode(), ("239.255.255.250", 3702))

found = set()
while True:
    try:
        data, addr = sock.recvfrom(65535)
    except socket.timeout:
        break
    if addr[0] not in found:
        found.add(addr[0])
        body = data.decode(errors="replace")
        # Pull out the XAddrs (device service URLs) if present
        import re
        m = re.search(r"<[^>]*XAddrs[^>]*>(.*?)</[^>]*XAddrs[^>]*>", body)
        print(f"ONVIF device at {addr[0]}: {m.group(1) if m else '(no XAddrs)'}")

if not found:
    print("No ONVIF devices responded.")
