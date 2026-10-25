import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const command = process.platform === 'win32' ? 'cmd.exe' : 'npx';
const args = process.platform === 'win32'
  ? ['/d', '/c', 'npx', '-y', 'rea-agents@6.7.0', 'mcp']
  : ['-y', 'rea-agents@6.7.0', 'mcp'];
const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const lines = createInterface({ input: child.stdout });
let diagnostic = '';
let listed = false;
child.stderr.on('data', chunk => { diagnostic += chunk.toString(); });

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

const timeout = setTimeout(() => {
  child.kill();
  process.stderr.write(`REA MCP handshake timed out. ${diagnostic.slice(-1000)}\n`);
  process.exitCode = 1;
}, 30000);

send({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'reconstruction-kit-check', version: '0.1.0' } }
});

try {
  for await (const line of lines) {
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.id === 1) {
      if (message.error) throw new Error(`REA initialize failed: ${JSON.stringify(message.error)}`);
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    }
    if (message.id === 2) {
      if (message.error) throw new Error(`REA tools/list failed: ${JSON.stringify(message.error)}`);
      const count = message.result?.tools?.length ?? 0;
      if (count === 0) throw new Error('REA returned no tools');
      process.stdout.write(`${JSON.stringify({ server: 'rea-agents@6.7.0', tool_count: count })}\n`);
      listed = true;
      break;
    }
  }
} finally {
  clearTimeout(timeout);
  child.stdin.end();
  if (!listed) child.kill();
}

if (!listed && !process.exitCode) throw new Error(`REA closed before tools/list. ${diagnostic.slice(-1000)}`);
