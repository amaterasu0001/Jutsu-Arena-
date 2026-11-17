// Runs before `npm run dev` (the "predev" script).
//
// If a dev server is already running for this project, starting another one is
// not just pointless (port 5173 is taken, so it exits) - on the way it rebuilds
// Vite's shared dependency cache in node_modules/.vite/deps and deletes the files
// the running server is still serving. On Windows this happens whenever the two
// were launched from paths that differ only in case (e.g. "d:\" vs "D:\"),
// because Vite's cache key includes its own install path. The running server then
// answers 504 for those modules and features loaded on demand (hand tracking)
// fail. So refuse to start while the port is in use.
import net from 'node:net';

const PORT = 5173;

function isListening(host) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: PORT });
    socket.setTimeout(800);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

const busy = (await Promise.all(['127.0.0.1', '::1'].map(isListening))).some(Boolean);
if (busy) {
  console.error(
    `\n  Port ${PORT} is already in use - the frontend is probably already running.\n` +
      `  Open http://localhost:${PORT} or close the other dev server first.\n` +
      `  (Not starting a second one: it would rebuild the shared Vite cache under the running server.)\n`,
  );
  process.exit(1);
}
