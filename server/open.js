import { spawn } from 'node:child_process';

/** The OS command that opens a URL in the default browser. */
export function browserCommand(url, platform = process.platform) {
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]];
  if (platform === 'darwin') return ['open', [url]];
  return ['xdg-open', [url]];
}

/**
 * Best-effort: open `url` in the default browser. Never throws and never crashes the process.
 * A missing opener (e.g. no xdg-open on a headless Linux box) is reported asynchronously through
 * the child's 'error' event, so a try/catch around spawn() alone is not enough.
 */
export function openBrowser(url, { command = browserCommand(url), onError = () => {} } = {}) {
  const [cmd, args] = command;
  let child;
  try {
    child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  } catch (err) {
    onError(err);
    return null;
  }
  child.on('error', onError);
  child.unref();
  return child;
}
