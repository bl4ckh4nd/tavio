import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const compose = readFileSync(resolve(process.cwd(), 'deploy/docker-compose.deploy.yml'), 'utf8');

describe('VPS stack', () => {
  it('runs only LiveKit, because Convex Cloud and Cloudflare Workers host the rest', () => {
    const services = compose.slice(0, compose.indexOf('\nvolumes:')).match(/^ {2}[a-z-]+(?=:$)/gm)?.map((name) => name.trim());

    expect(services).toEqual(['livekit', 'livekit-egress', 'redis']);
  });
});

describe('deployed LiveKit stack', () => {
  it('keeps the supported LiveKit versions and internal egress ICE candidate', () => {
    // 1.13.10 refuses TCP relays over TURN and relays to this host only on media ports (livekit#4992).
    expect(compose).toContain('image: livekit/livekit-server:v1.13.11');
    expect(compose).toContain('image: livekit/egress:v1.15.0');

    const livekitService = compose.slice(
      compose.indexOf('\n  livekit:\n'),
      compose.indexOf('\n  livekit-egress:\n'),
    );
    const rtcConfig = livekitService.slice(
      livekitService.indexOf('        rtc:\n'),
      livekitService.indexOf('      LIVEKIT_KEYS:'),
    );

    // A port range holds about five people; everyone after that falls back to TCP.
    expect(rtcConfig).toMatch(/udp_port:\s*7882/);
    expect(rtcConfig).not.toMatch(/port_range_/);
    expect(rtcConfig).toMatch(/use_external_ip:\s*true/);
    expect(rtcConfig).toMatch(/advertise_internal_ip:\s*true/);
    expect(rtcConfig).toMatch(/skip_external_ip_validation:\s*true/);

    // TURN/TLS on 443 through Traefik, relaying to the internal candidate (hairpin to the public IP is dropped).
    expect(rtcConfig).toMatch(/turn:\n\s+enabled:\s*true/);
    expect(rtcConfig).toMatch(/external_tls:\s*true/);
    // Relays may reach this stack's network, so nothing on it may be open without a password.
    expect(rtcConfig).toContain('allow_restricted_peer_cidrs:\n            - ${TURN_PEER_CIDR:?TURN_PEER_CIDR is required}');
    expect(livekitService).toContain('traefik.tcp.routers.tavio-turn.rule=HostSNI(`${TURN_DOMAIN:?TURN_DOMAIN is required}`)');
    // The certificate's host and the host TURN announces are the same.
    expect(rtcConfig).toContain('domain: ${TURN_DOMAIN:?TURN_DOMAIN is required}');
    expect(livekitService).toContain('traefik.tcp.services.tavio-turn.loadbalancer.server.port=5349');

    // A swapped-out SFU stalls every call at once.
    expect(livekitService).toMatch(/mem_limit: 512m\n\s+memswap_limit: 512m/);
    const redisService = compose.slice(compose.indexOf('\n  redis:\n'));
    expect(redisService).toMatch(/memswap_limit: 256m/);

    // TURN relays can reach Redis on the stack's network: it only answers with the password.
    const password = '${REDIS_PASSWORD:?REDIS_PASSWORD is required}';
    expect(redisService).toContain(`"--requirepass", "${password}"`);
    expect(redisService).toContain('redis-cli -a \\"$$REDIS_PASSWORD\\" --no-auth-warning ping | grep -q PONG');
    // Quoted, so a # or : in the password does not cut it short in the YAML.
    expect(livekitService).toContain(`password: '${password}'`);
    expect(compose.slice(compose.indexOf('\n  livekit-egress:\n'), compose.indexOf('\n  redis:\n'))).toContain(`password: '${password}'`);

    const egressService = compose.slice(compose.indexOf('\n  livekit-egress:\n'));
    expect(egressService).toContain('ws_url: ws://livekit:7880');
    expect(egressService).not.toMatch(/ws_url:\s*\$\{LIVEKIT_HOST/);
    expect(egressService).toContain('--headless --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=0');
    expect(egressService).toContain("grep -F 'DevTools listening'");
    expect(egressService).toContain('command -v gst-inspect-1.0');
    expect(egressService).toContain('egress gstreamer prewarm=%s');
    expect(egressService).toContain('egress chrome prewarm=%s');
    expect(egressService).toMatch(/while \[ "\$\$gst_attempt" -lt 30 \]; do/);
    expect(egressService).toMatch(/while \[ "\$\$attempt" -lt 60 \]; do/);
    expect(egressService.indexOf('--headless')).toBeLessThan(egressService.indexOf('exec /entrypoint.sh'));
    expect(egressService).toContain('mem_limit: 2g');
  });
});
