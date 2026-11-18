// ¿Puede listen(port) en :: (como node listen(0)) coexistir con un 0.0.0.0:<port> ajeno, y quién recibe 127.0.0.1?
import { createServer } from 'node:http';
import net from 'node:net';
const port = Number(process.argv[2]);
const srv = createServer((_, r) => r.end('own-server'));
srv.on('error', (e) => {
  console.log('bind ::', port, '->', e.code);
  process.exit(0);
});
srv.listen(port, () => {
  console.log('bind OK', JSON.stringify(srv.address()));
  const t0 = Date.now();
  const s = net.connect({ host: '127.0.0.1', port, timeout: 8000 });
  s.on('connect', () => {
    console.log('tcp connect 127.0.0.1 OK en', Date.now() - t0, 'ms');
    s.write('GET / HTTP/1.0\r\n\r\n');
  });
  s.on('data', (d) => {
    console.log('resp:', String(d).split('\r\n')[0], '| propio?', String(d).includes('own-server'));
    s.destroy();
    srv.close();
  });
  s.on('timeout', () => {
    console.log('sin respuesta tras', Date.now() - t0, 'ms');
    s.destroy();
    srv.close();
  });
  s.on('error', (e) => {
    console.log('error', e.code, 'tras', Date.now() - t0, 'ms');
    srv.close();
  });
});
